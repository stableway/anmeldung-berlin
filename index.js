const fs = require("fs");
const puppeteer = require("puppeteer");
const bluebird = require("bluebird");
const { locations, entryUrl } = require("./constants.json");
const config = require("./config.json");

(async () => {
  console.log("---- Get an Anmeldung Termin ------");
  console.log("Starting: " + new Date(Date.now()).toUTCString());
  console.log("Config file:", JSON.stringify(config, null, 2));

  while (true) {
    let hasBooked = await bookTermin();
    if (hasBooked) {
      console.log("Booking successful!");
      break;
    }
    console.log("Booking did not succeed.");
    const waitSeconds = config.waitSeconds ? config.waitSeconds : 120;
    console.log("Waiting", waitSeconds, "seconds until next attempt ...");
    await sleep(waitSeconds * 1000);
  }
  console.log("Ending: " + new Date(Date.now()).toUTCString());
})();

async function bookTermin() {
  const startTime = new Date(Date.now()).toUTCString();
  let browser;

  try {
    console.log("Launching the browser ...");
    browser = await puppeteer.launch({
      headless: !config.debug,
      defaultViewport: undefined,
      slowMo: config.debug ? 1500 : undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await applyStealth(page);
    const calendarUrl = getCalendarLink(
      entryUrl,
      config.allLocations,
      config.locations,
      locations
    );

    console.log("Going to calendar of appointment dates");
    await page.goto(calendarUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("div.span7.column-content");
    const dateLinks = await getAllDateLinks(page);
    if (dateLinks.length === 0) return false;
    // using withPage function from now on.
    page.close();

    // Get all timeslot booking page links for each available date in parallel.
    const timeslotLinks = [].concat.apply(
      [],
      await bluebird.all(
        bluebird.map(dateLinks, async (url) => {
          // Create promise for each link
          return withPage(browser)(async (page) => {
            console.log("Getting timeslots for:", url);
            await page.goto(url, { waitUntil: "domcontentloaded" });
            const links = await getTimeslotLinks(page);
            return links;
          }).catch((e) => {
            // If one link fails, just return [] and go ahead with the links you could find.
            console.log("Get timeslots failed for:", url, "with:", e.message);
            return [];
          });
        }),
        { concurrency: config.concurrency ? config.concurrency : 3 }
      )
    );
    // If no links are available for any dates, go into waiting mode.
    if (timeslotLinks.length === 0) return false;

    while (true) {
      // Get the first booking page that renders the input form
      const bookingPage = await bluebird
        .any(
          bluebird.map(
            timeslotLinks,
            async (url) => {
              // Create promise for each link
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
                console.log(
                  "Get booking page failed for:",
                  url,
                  "with:",
                  e.message
                );
                throw e;
              });
            },
            { concurrency: config.concurrency ? config.concurrency : 3 }
          )
        )
        .catch((e) => {
          console.log("Get booking pages failed with:", e.message);
          return undefined;
        });
      // If no booking pages render, then go into waiting mode.
      if (bookingPage === undefined) return false;

      const bookingPageUrl = bookingPage.url();
      try {
        console.log("Filling out form with config data at:", bookingPageUrl);
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
        ]);

        // The note feature is not available for every location.
        if (config.note !== undefined && config.note !== "") {
          console.log(
            "Writing the configured note if the feature is available ..."
          );
          await bookingPage
            .waitForSelector("textarea[name=amendment]", { timeout: 5000 })
            .then((el) => el.type(config.note))
            .catch((e) =>
              console.log(
                "Write note failed with:",
                e.message,
                "\nContinuing with booking with no note"
              )
            );
        }

        // TODO: Handle when phone number is required for some locations.

        console.log("Submitting form ...");
        await Promise.all([
          bookingPage.waitForNavigation(),
          bookingPage.click("button#register_submit.btn"),
        ]);

        try {
          // TODO: validate the booking confirmation rather than just waiting 10 seconds.
          console.log("Waiting 10 seconds for booking result to render ...");
          await bookingPage.waitForTimeout(10000);

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
          console.log(e);
          console.log(
            "Error thrown during booking confirmation. Exiting. Check your config.email address for booking info."
          );
        }

        console.log("Success!!!");
        return true;
      } catch (e) {
        console.log(
          "Booking timeslot failed for:",
          bookingPageUrl,
          "with:",
          e.message,
          "\nTrying the next one now."
        );
      }
    }
  } catch (e) {
    console.log(e);
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
    } catch {
      // If error, always close page
      await page.close();
    } finally {
      if (options.close) await page.close();
    }
  };

const applyStealth = (page) =>
  page
    .addScriptTag({
      url: "https://raw.githack.com/berstend/puppeteer-extra/stealth-js/stealth.min.js",
    })
    .catch((e) =>
      console.log(
        "Applying stealth protections failed with:",
        e.message,
        "\nContinuing without protection"
      )
    );

function getCalendarLink(entryUrl, allLocations, locations, locationToIdMap) {
  let link = entryUrl;
  if (allLocations === true) {
    for (const location in locationToIdMap) {
      link = link + locationToIdMap[location] + ",";
    }
  } else {
    for (const location in locations) {
      link = link + locationToIdMap[location] + ",";
    }
  }
  return link.slice(0, link.length - 1);
}

async function getAllDateLinks(page) {
  console.log("Getting available date links from calendar");
  const linksPage1 = await getDateLinks(page);
  await paginateCalendar(page);
  const linksPage2 = await getDateLinks(page);
  const links = linksPage1.concat(linksPage2);
  console.log("All date links:", JSON.stringify(links, null, 2));
  return [...new Set(links)];
}

async function getDateLinks(page) {
  // Selector might not be there so don't bother waiting for it.
  const links = await page.$$eval("td.buchbar > a", (els) =>
    els
      .map((el) => el.href)
      .filter((href) => href !== undefined && href !== null)
  );
  console.log("Got date links:", JSON.stringify(links, null, 2));
  return links;
}

async function paginateCalendar(page) {
  await Promise.all([page.waitForNavigation(), page.click("th.next")]);
}

async function getTimeslotLinks(page) {
  // Selector should definitely be there so wait for it. Sometimes not so return [] on fail.
  const links = await page
    .waitForSelector("td.frei > a")
    .then(() =>
      page.$$eval("td.frei > a", (els) =>
        els
          .map((el) => el.href)
          .filter((href) => href !== undefined && href !== null)
      )
    )
    .catch(() => []);
  console.log("Got timeslot links:", JSON.stringify(links, null, 2));
  return links;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
