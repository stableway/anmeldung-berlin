const fs = require("fs");
const puppeteer = require("puppeteer-extra");
const Promise = require("bluebird");
const winston = require("winston");
const constants = require("./constants.json");
const config = require("./config.json");

puppeteer.use(require("puppeteer-extra-plugin-stealth")());

const CALENDAR_SELECTOR = ".calendar-table";
const CALENDAR_WAIT_TIMEOUT_MS = 10 * 1000;

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.printf(
      (info) =>
        `${info.timestamp} ${info.level}: ${info.message}` +
        (info.splat !== undefined ? `${info.splat}` : " ")
    )
  ),
  transports: [new winston.transports.Console()],
  level: config.debug ? "debug" : "info",
});

(async () => {
  logger.info("---- Get a Berlin.de Appointment ------");
  logger.info(`Starting: ${timestamp()}`);
  logger.info(`Config file: ${JSON.stringify(config, null, 2)}`);

  let hasBooked = false;
  while (!hasBooked) {
    hasBooked = await bookTermin();
    if (hasBooked) {
      logger.info("Booking successful!");
    } else {
      logger.info("Booking did not succeed.");
      logger.info(
        `Waiting ${config.waitSeconds} seconds until next attempt ...`
      );
      await sleep(config.waitSeconds * 1000);
    }
  }
  logger.info(`Ending at ${timestamp()}`);
})();

function timestamp() {
  return new Date(Date.now()).toUTCString();
}

async function bookTermin() {
  const startTime = timestamp();
  let browser;

  try {
    const browserArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
    if (process.env.PROXY_URL) {
      browserArgs.push(`--proxy-server=${process.env.PROXY_URL}`);
    }
    browser = await puppeteer.launch({
      headless: !config.debug,
      slowMo: config.debug ? 500 : undefined,
      args: browserArgs,
    });

    const dateURLs = await withPage(browser)(async (page) => {
      const calendarURL = getCalendarURL(config);
      logger.info("Navigating to the appointment calendar");
      logger.debug(`Calendar URL: ${calendarURL}`);
      await page.goto(calendarURL, { waitUntil: "domcontentloaded" });
      await page
        .waitForSelector(CALENDAR_SELECTOR, {
          timeout: CALENDAR_WAIT_TIMEOUT_MS,
        })
        .catch(async (e) => {
          await page.$eval("h1", async (el) => {
            if (el.innerText === "Zu viele Zugriffe") {
              logger.error(
                `Blocked for too many attempts! Waiting for ${config.coolOffSeconds} seconds ...`
              );
              await sleep(config.coolOffSeconds * 1000);
            }
          });
          throw e;
        });
      const dateURLsPage1 = await getDateURLs(page);
      await paginateCalendar(page);
      const dateURLsPage2 = await getDateURLs(page);
      const dateURLs = [...new Set(dateURLsPage1.concat(dateURLsPage2))];
      logger.info(`Found ${dateURLs.length} appointment dates.`);
      const filteredDateURLs = filterURLsBetweenDates(dateURLs, config);
      logger.info(
        `Found ${filteredDateURLs.length} appointment dates within the configured date range.`
      );
      return filteredDateURLs;
    });
    // If no date has available appointments, go into waiting mode.
    if (dateURLs.length === 0) return false;

    // Get all timeslot booking page URLs for each available date in parallel.
    let appointmentURLs = [].concat.apply(
      [],
      await Promise.map(
        dateURLs,
        async (url) => {
          // Go to each date URL and extract appointment URLs
          return await withPage(browser)(async (page) => {
            logger.info(`Getting appointments for ${url}`);
            await page.goto(url, { waitUntil: "domcontentloaded" });
            const urls = await getAppointmentURLs(page);
            logger.info(`Found ${urls.length} appointments for ${url}`);
            const filteredURLs = filterURLsBetweenTimes(urls, config);
            logger.info(
              `Found ${filteredURLs.length} appointments within the configured time range for ${url}`
            );
            return filteredURLs;
          }).catch((e) => {
            // If one URL fails, just return [] and go ahead with the URLs you could find.
            logger.error(`Get appointments failed for ${url} - ${e.message}`);
            return [];
          });
        },
        { concurrency: config.concurrency || 3 }
      )
    );
    // If no appointments were found for any date, go into waiting mode.
    if (appointmentURLs.length === 0) return false;

    const chunkSize = config.concurrency || 3;
    for (let i = 0; i < appointmentURLs.length; i += chunkSize) {
      const urls = appointmentURLs.slice(i, i + chunkSize);
      // Get the first booking page that renders the input form
      const promises = [];
      for (let i = 0; i < urls.length; ++i) {
        const url = urls[i];
        promises.push(
          withPage(browser, { alwaysClosePage: false })(async (page) => {
            logger.info(`Retrieving booking page for ${url}`);
            await page.goto(url, { waitUntil: "domcontentloaded" });

            const alreadyTaken = await page.$eval(
              "h1",
              (title) =>
                title.innerText.trim() === "Bitte entschuldigen Sie den Fehler"
            );
            if (alreadyTaken === true)
              throw new Error(`Too slow! ${url} was already taken.`);

            logger.info(`Waiting for booking form to render for ${url}`);
            await Promise.all([
              page.waitForSelector("input#familyName"),
              page.waitForSelector("input#email"),
              page.waitForSelector("input#emailequality"),
              page.waitForSelector('select[name="surveyAccepted"]'),
              page.waitForSelector("input#agbgelesen"),
              page.waitForSelector("button#register_submit.btn"),
            ]);
            return page;
          })
        );
      }
      const bookingPage = await Promise.any(promises).catch();
      // If no booking pages render, then go into waiting mode.
      if (bookingPage === undefined) continue;

      const bookingPageURL = bookingPage.url();
      try {
        logger.info(
          `Filling out form with configured data at ${bookingPageURL}`
        );
        await Promise.all([
          bookingPage.$eval(
            "input#familyName",
            (el, config) => (el.value = config.name),
            config
          ),
          bookingPage.$eval(
            "input#email",
            (el, config) => (el.value = config.email),
            config
          ),
          bookingPage.$eval(
            "input#emailequality",
            (el, config) => (el.value = config.email),
            config
          ),
          bookingPage.select(
            'select[name="surveyAccepted"]',
            config.takeSurvey ? "1" : "0"
          ),
          bookingPage.$eval("input#agbgelesen", (el) => (el.checked = true)),
        ]).catch((e) => {
          logger.error(
            `Writing essential information failed. Cancelling form submission - ${e.message}`
          );
          throw e;
        });

        // The note feature is not available for every location.
        if (!config.note) {
          logger.info(
            "Writing the configured note if the feature is available ..."
          );
          await bookingPage
            .waitForSelector("textarea[name=amendment]", { timeout: 5 * 1000 })
            .then((handle) => handle.type(config.note))
            .catch((e) =>
              logger.warn(
                `Write note failed. Continuing with booking with no note - ${e.message}`
              )
            );
        }

        // Telephone entry is not available for every location.
        logger.info("Looking for the telephone input ...");
        const telephoneHandle = await bookingPage
          .waitForSelector("input#telephone", { timeout: 5 * 1000 })
          .catch((e) => {
            logger.warn(
              `Did not find telephone input. Continuing with booking without providing a contact number - ${e.message}`
            );
            return;
          });
        if (telephoneHandle !== undefined) {
          logger.info("Writing configured telephone number into form ...");
          await bookingPage
            .$eval(
              "input#telephone",
              (el, config) => (el.value = config.phone),
              config
            )
            .catch((e) => {
              logger.error(
                `Writing phone number failed. Cancelling form submission - ${e.message}`
              );
              throw e;
            });
        }

        logger.info("Submitting form");
        await bookingPage.hover("button#register_submit.btn");
        await Promise.all([
          bookingPage.waitForNavigation({ timeout: 30 * 1000 }),
          bookingPage.click("button#register_submit.btn"),
        ]).catch(async (e) => {
          logger.warn(`Retrying submitting form - ${e.message}`);
          await Promise.all([
            bookingPage.waitForNavigation({ timeout: 30 * 1000 }),
            bookingPage.click("button#register_submit.btn"),
          ]);
        });

        try {
          // TODO: validate the booking confirmation rather than just waiting 10 seconds.
          logger.info("Waiting 10 seconds for booking result to render ...");
          await bookingPage.waitForTimeout(10 * 1000);

          logger.info("Saving booking info to files ...");
          await Promise.allSettled([
            fs.writeFile(
              `./output/booking-${startTime}.json`,
              JSON.stringify({ bookedAt: startTime }, null, 2),
              (err) => {
                if (err) throw err;
                logger.info("The booking has been saved!");
              }
            ),
            bookingPage.screenshot({
              path: `./output/booking-${startTime}.png`,
              fullPage: true,
            }),
          ]);
        } catch (e) {
          logger.error(
            `Error thrown during booking confirmation. Exiting. Check your config.email address for booking info: ${e.message}`
          );
        }

        logger.info("Success!!!");
        return true;
      } catch (e) {
        logger.error(
          `Booking appointment failed for ${bookingPageURL}. Trying the next appointment now - ${e.message}`
        );
      }
    }
  } catch (e) {
    logger.error(e.message);
    return false;
  } finally {
    if (browser !== undefined) await browser.close();
  }
}

const withPage =
  (browser, options = { alwaysClosePage: true }) =>
  async (fn) => {
    // set alwaysClosePage to false if you return the Page. Otherwise true to avoid memory leaks.
    const page = await browser.newPage();
    try {
      return await fn(page);
    } catch (e) {
      logger.error(e);
      // If error, always close page
      if (!(await page.isClosed())) await page.close();
      throw e;
    } finally {
      if (options.alwaysClosePage && !(await page.isClosed()))
        await page.close();
    }
  };

function getCalendarURL({ service, allLocations, locations }) {
  let url = constants.entryUrl;
  url += constants.services[service] + "%2F";
  url += "&anliegen[]=";
  url += constants.services[service];
  url += "&dienstleisterlist=";
  if (allLocations === true) {
    for (const location in constants.locations) {
      url += constants.locations[location] + ",";
    }
  } else {
    for (let i = 0; i < locations.length; i++) {
      url += constants.locations[locations[i]] + ",";
    }
  }
  url = url.slice(0, url.length - 1);
  return url;
}

async function getDateURLs(page) {
  // Selector might not be there so don't bother waiting for it.
  const urls = await page.$$eval("td.buchbar > a", (els) =>
    els.map((el) => el.href).filter((href) => !!href)
  );
  logger.debug(`Got date URLs: ${JSON.stringify(urls, null, 2)}`);
  return urls;
}

async function paginateCalendar(page) {
  const NEXT_BUTTON_SELECTOR = "th.next";
  await page.waitForSelector(NEXT_BUTTON_SELECTOR);
  await Promise.all([
    page.waitForNavigation(),
    page.click(NEXT_BUTTON_SELECTOR),
  ]);
}

function filterURLsBetweenDates(urls, { earliestDate, latestDate }) {
  return urls.filter((url) => {
    const linkDate = new Date(parseInt(url.match(/\d+/)[0]) * 1000);
    return (
      new Date(earliestDate) <= linkDate && linkDate <= new Date(latestDate)
    );
  });
}

async function getAppointmentURLs(page) {
  // Selector should definitely be there so wait for it. Sometimes not so return [] on fail.
  const urls = await page
    .waitForSelector(".timetable")
    .then(() =>
      page.$$eval("td.frei > a", (els) =>
        els.map((el) => el.href).filter((href) => !!href)
      )
    );
  logger.debug(`Got timeslot URLs: ${JSON.stringify(urls, null, 2)}`);
  return urls;
}

function filterURLsBetweenTimes(urls, { earliestTime, latestTime }) {
  return urls.filter((url) => {
    const linkDate = new Date(parseInt(url.match(/\d+/)[0]) * 1000);
    const linkTime = `${linkDate.getHours()}:${linkDate.getMinutes()} GMT`;
    return (
      new Date("1970 " + earliestTime) <= new Date("1970 " + linkTime) &&
      new Date("1970 " + linkTime) <= new Date("1970 " + latestTime)
    );
  });
}

function sleep(ms = 120000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
