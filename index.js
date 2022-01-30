const fs = require("fs");
const puppeteer = require("puppeteer");
const Promise = require("bluebird");
const constants = require("./constants.json");
const config = require("./config.json");

(async () => {
  console.log("---- Get an Anmeldung Termin ------");
  console.log("Starting: " + timestamp());
  console.log("Config file:", JSON.stringify(config, null, 2));

  let hasBooked = false;
  while (!hasBooked) {
    hasBooked = await bookTermin();
    if (hasBooked) {
      console.log("Booking successful!");
    } else {
      console.log("Booking did not succeed.");
      console.log(
        "Waiting",
        config.waitSeconds,
        "seconds until next attempt ..."
      );
      await sleep(config.waitSeconds * 1000 * 1000);
    }
  }
  console.log("Ending: " + timestamp());
})();

function timestamp() {
  return new Date(Date.now()).toUTCString();
}

async function bookTermin() {
  const startTime = timestamp();
  let browser;

  try {
    console.log("Launching the browser ...");
    browser = await puppeteer.launch({
      headless: !config.debug,
      slowMo: config.debug ? 1500 : undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const dateURLs = await withPage(browser)(async (page) => {
      const CALENDAR_SELECTOR = "div.span7.column-content";
      const calendarURL = getCalendarURL(config);
      console.log("Going to calendar at:", calendarURL);
      await page.goto(calendarURL, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(CALENDAR_SELECTOR);
      let dateURLs = await getAllDateURLs(page);
      return filterURLsBetweenDates(dateURLs, config);
    });
    if (dateURLs.length === 0) return false;

    // Get all timeslot booking page URLs for each available date in parallel.
    let timeslotURLs = [].concat.apply(
      [],
      await Promise.all(
        Promise.map(dateURLs, async (url) => {
          // Create promise for each URL
          return withPage(browser)(async (page) => {
            console.log("Getting timeslots for:", url);
            await page.goto(url, { waitUntil: "domcontentloaded" });
            return await getTimeslotURLs(page);
          }).catch((e) => {
            // If one URL fails, just return [] and go ahead with the URLs you could find.
            console.log("Get timeslots failed for:", url, "with:", e.message);
            return [];
          });
        }),
        { concurrency: config.concurrency || 3 }
      )
    );
    // If no URLs are available for any dates, go into waiting mode.
    timeslotURLs = filterURLsBetweenTimes(timeslotURLs, config);
    if (timeslotURLs.length === 0) return false;

    while (true) {
      // Get the first booking page that renders the input form
      const bookingPage = await Promise.any(
        Promise.map(
          timeslotURLs,
          async (url) => {
            // Create promise for each URL
            return withPage(browser, { alwaysClosePage: false })(
              async (page) => {
                console.log("Getting booking page for:", url);
                await page.goto(url, { waitUntil: "domcontentloaded" });

                console.log("Waiting for booking form to render for:", url);
                await Promise.all([
                  page.waitForSelector("input#familyName"),
                  page.waitForSelector("input#email"),
                  page.waitForSelector('select[name="surveyAccepted"]'),
                  page.waitForSelector("input#agbgelesen"),
                  page.waitForSelector("button#register_submit.btn"),
                ]);
                return page;
              }
            ).catch((e) => {
              console.error(e.message, `Get booking page failed for: ${url}`);
              throw e;
            });
          },
          { concurrency: config.concurrency || 3 }
        )
      ).catch((e) => {
        console.error(e.message, "Get booking pages failed!");
        return;
      });
      // If no booking pages render, then go into waiting mode.
      if (bookingPage === undefined) return false;

      const bookingPageURL = bookingPage.url();
      try {
        console.log("Filling out form with config data at:", bookingPageURL);
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
          bookingPage.select(
            'select[name="surveyAccepted"]',
            config.takeSurvey ? "1" : "0"
          ),
          bookingPage.$eval("input#agbgelesen", (el) => (el.checked = true)),
        ]).catch((e) => {
          console.error(
            e.message,
            "Writing essential information failed. Cancelling form submission."
          );
          throw e;
        });

        // The note feature is not available for every location.
        if (!config.note) {
          console.log(
            "Writing the configured note if the feature is available ..."
          );
          await bookingPage
            .waitForSelector("textarea[name=amendment]", { timeout: 5 * 1000 })
            .then((handle) => handle.type(config.note))
            .catch((e) =>
              console.error(
                e.message,
                "Write note failed. Continuing with booking with no note."
              )
            );
        }

        // Telephone entry is not available for every location.
        console.log("Looking for the telephone input ...");
        const telephoneHandle = await bookingPage
          .waitForSelector("input#telephone", { timeout: 5 * 1000 })
          .catch((e) =>
            console.error(
              e.message,
              "Did not find telephone input. Continuing with booking without providing a contact number ..."
            )
          );

        if (telephoneHandle !== undefined) {
          console.log("Writing configured phone into form ...");
          await telephoneHandle
            .evaluate((el, config) => (el.value = config.phone), config)
            .catch((e) => {
              console.error(
                e.message,
                "Writing phone number failed. Cancelling form submission."
              );
              throw e;
            });
        }

        console.log("Submitting form ...");
        await Promise.all([
          bookingPage.waitForNavigation(),
          bookingPage.click("button#register_submit.btn"),
        ]);

        try {
          // TODO: validate the booking confirmation rather than just waiting 10 seconds.
          console.log("Waiting 10 seconds for booking result to render ...");
          await bookingPage.waitForTimeout(10 * 1000);

          console.log("Saving booking info to files ...");
          await Promise.allSettled([
            fs.writeFile(
              `./output/booking-${startTime}.json`,
              JSON.stringify({ bookedAt: startTime }, null, 2),
              (err) => {
                if (err) throw err;
                console.log("The booking has been saved!");
              }
            ),
            bookingPage.screenshot({
              path: `./output/booking-${startTime}.png`,
              fullPage: true,
            }),
          ]);
        } catch (e) {
          console.error(
            e.message,
            "Error thrown during booking confirmation. Exiting. Check your config.email address for booking info."
          );
        }

        console.log("Success!!!");
        return true;
      } catch (e) {
        console.error(
          e.message,
          `Booking timeslot failed for: ${bookingPageURL}. Trying the next timeslot now.`
        );
      }
    }
  } catch (e) {
    console.error(e);
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
    await applyStealth(page);
    try {
      return await fn(page);
    } catch (e) {
      console.error(e);
      // If error, always close page
      if (!(await page.isClosed())) await page.close();
    } finally {
      if (options.alwaysClosePage && !(await page.isClosed()))
        await page.close();
    }
  };

const applyStealth = (page) =>
  page
    .addScriptTag({
      url: "https://raw.githack.com/berstend/puppeteer-extra/stealth-js/stealth.min.js",
    })
    .catch((e) =>
      console.error(
        e.message,
        "Applying stealth protections failed. Continuing without protection"
      )
    );

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

async function getAllDateURLs(page) {
  console.log("Getting available date URLs from calendar");
  const linksPage1 = await getDateURLs(page);
  console.log("Got date URLs:", JSON.stringify(linksPage1, null, 2));
  await paginateCalendar(page);
  const linksPage2 = await getDateURLs(page);
  console.log("Got date URLs:", JSON.stringify(linksPage2, null, 2));
  const urls = linksPage1.concat(linksPage2);
  console.log("Unique date URLs:", JSON.stringify([...new Set(urls)], null, 2));
  return [...new Set(urls)];
}

async function getDateURLs(page) {
  // Selector might not be there so don't bother waiting for it.
  return await page.$$eval("td.buchbar > a", (els) =>
    els.map((el) => el.href).filter((href) => !!href)
  );
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
    if (new Date(earliestDate) <= linkDate <= new Date(latestDate)) {
      return true;
    }
    return false;
  });
}

async function getTimeslotURLs(page) {
  // Selector should definitely be there so wait for it. Sometimes not so return [] on fail.
  const urls = await page
    .waitForSelector("td.frei > a")
    .then(() =>
      page.$$eval("td.frei > a", (els) =>
        els.map((el) => el.href).filter((href) => !!href)
      )
    )
    .catch(() => []);
  console.log("Got timeslot URLs:", JSON.stringify(urls, null, 2));
  return urls;
}

function filterURLsBetweenTimes(urls, { earliestTime, latestTime }) {
  return urls.filter((url) => {
    const linkDate = new Date(parseInt(url.match(/\d+/)[0]) * 1000);
    const linkTime = `${linkDate.getHours()}:${linkDate.getMinutes()} GMT`;
    if (
      new Date("1970 " + earliestTime) <=
      new Date("1970 " + linkTime) <=
      new Date("1970 " + latestTime)
    ) {
      return true;
    }
    return false;
  });
}

function sleep(ms = 120000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
