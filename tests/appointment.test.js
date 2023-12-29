const { expect, test } = require("@playwright/test");
const fs = require("fs").promises;
const MailSlurp = require("mailslurp-client").default;
const Promise = require("bluebird");
const winston = require("winston");
const config = require("../config.json");

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


test.beforeEach(async ({context}) => {
  await context.addInitScript({ path: "stealth.min.js" });
});

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    logger.info(`Waiting ${config.waitSeconds} seconds before retrying ...`);
    if (testInfo.error.message === "Rate limit exceeded") {
      await sleep(config.coolOffSeconds * 1000);
    } else {
      await sleep(config.waitSeconds * 1000);
    }
  }
});

test("appointment", async ({ context }) => {
  const serviceURL = await getServiceURL(context, config);
  const dateURLs = await getDateURLs(context, serviceURL, config);
  expect(dateURLs.length).toBeGreaterThan(0);

  const appointmentURLs = getAppointmentURLs(context, dateURLs);
  expect(appointmentURLs.length).toBeGreaterThan(0);

  for (const appointmentURL of appointmentURLs) {
    try {
      await bookAppointment(await context.newPage(), appointmentURL);
      logger.info("Booking successful!");
      return;
    } catch (e) {
      logger.error(
        `Booking appointment failed ${e.message} for ${appointmentURL}. Trying the next appointment now.`
      );
    }
  }
  throw new Error("Booking failed for all appointments.");
});

function timestamp() {
  return new Date(Date.now()).toUTCString();
}

async function getServiceURL(context, {service}) {
  return await test.step("get service url", async () => {
    const page = await context.newPage();
    const servicesURL = "https://service.berlin.de/dienstleistungen/";
    await page.goto(servicesURL, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    const serviceLinkLocator = page.getByRole("link", { name: service });
    await expect(serviceLinkLocator, `Service ${service} not found at ${servicesURL}`).toBeVisible();
    const serviceUrl = await serviceLinkLocator.getAttribute("href");
    await page.close();
    return serviceUrl;
  });
}

async function getDateURLs(context, serviceURL, config) {
  return await test.step("get date urls", async () => {
    const page = await context.newPage();
    await page.goto(serviceURL, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    await selectLocations(page, config);
    logger.info("Navigating to the appointment calendar");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded"}), 
      page.getByRole("button", { name: "An diesem Standort einen Termin buchen" }).click()
    ]);
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    await expect(page, "No appointments available for the selected locations").not.toHaveURL(/service\.berlin\.de\/terminvereinbarung\/termin\/taken/, { timeout: 1 });
    // TODO: Check for maintenance page "Wartung"
    // if (page.getByRole("heading", { name: "Wartung" }).isVisible()) {
    //   throw new Error("Site down for maintenance. Exiting.");
    // }
    logger.debug(`Calendar url: ${page.url()}`);
    const dateURLsPage1 = await scrapeDateURLs(page);
    // TODO: use page.getByRole for pagination button
    await Promise.all([page.waitForNavigation({waitUntil: "domcontentloaded"}), page.locator("th.next").click()]);
    const dateURLsPage2 = await scrapeDateURLs(page);
    const dateURLs = [...new Set(dateURLsPage1.concat(dateURLsPage2))];
    logger.info(`Found ${dateURLs.length} appointment dates.`);
    const filteredDateURLs = filterURLsBetweenDates(dateURLs, config);
    logger.info(
      `Found ${filteredDateURLs.length} appointment dates within the configured date range.`
    );
    await page.close();
    return filteredDateURLs;
  });
}

async function selectLocations(page, {allLocations, locations}) {
  await test.step("select locations", async () => {
    if (allLocations === true) {
      const allLocationsCheckboxLocator = page.getByRole("checkbox", { name: "Alle Standorte auswählen" });
      if (await allLocationsCheckboxLocator.isVisible()) {
        await allLocationsCheckboxLocator.check();
      } else {
        const checkboxLocators = page.getByRole("checkbox");
        const checkboxCount = await checkboxLocators.count();
        for (let i = 0; i < checkboxCount; ++i) {
          await checkboxLocators.nth(i).check();
        }
      }
    } else {
      for (const location of locations) {
        // TODO: Some other method than first()? This locator can have multiple matches.
        await page.getByRole("checkbox", {name: location}).first().check();
      }
    }
  });
}


async function getAppointmentURLs(context, dateURLs) {
  return await test.step("get appointment urls", async () => {
    return await [].concat.apply(
      [],
      await Promise.map(
        dateURLs,
        async (url) =>
          getAppointmentURLsForDateURL(await context.newPage(), url).catch((e) => {
            // If one URL fails, just return [] and go ahead with the URLs you could find.
            logger.error(`Get appointments failed for ${url} - ${e.message}`);
            return [];
          }),
        { concurrency: config.concurrency || 3 }
      )
    );
  });
}

async function getAppointmentURLsForDateURL(page, url) {
  return await test
    .step(`get appointment urls for ${url}`, async () => {
      logger.info(`Getting appointments for ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await checkRateLimitExceeded(page);
      await checkCaptcha(page);
      const urls = await scrapeAppointmentURLs(page);
      logger.info(`Found ${urls.length} appointments for ${url}`);
      const filteredURLs = filterURLsBetweenTimes(urls, config);
      logger.info(
        `Found ${filteredURLs.length} appointments within the configured time range for ${url}`
      );
      return filteredURLs;
    })
    .finally(async () => {
      await page.close();
    });
}

async function bookAppointment(page, url) {
  await test
    .step(`book appointment at ${url}`, async () => {
      logger.info(`Retrieving booking page for ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await checkRateLimitExceeded(page);
      await checkCaptcha(page);
      // This block is executed if the first appointment link failed and more than 1 appointment link was found.
      // <a href="/terminvereinbarung/termin/abort/?providerList=122210%2C122217%2C327316%2C122219%2C327312%2C122227%2C327314%2C122231%2C122243%2C122252%2C329742%2C122260%2C329745%2C122262%2C329748%2C122254%2C122271%2C327278%2C122273%2C327274%2C122277%2C327276%2C330436%2C122280%2C327294%2C122282%2C327290%2C122284%2C327292%2C122291%2C327270%2C122285%2C327266%2C122286%2C327264%2C122296%2C327268%2C150230%2C329760%2C122301%2C327282%2C122297%2C327286%2C122294%2C327284%2C122312%2C329763%2C122314%2C329775%2C122304%2C327330%2C122311%2C327334%2C122309%2C327332%2C122281%2C327352%2C122279%2C329772%2C122276%2C327324%2C122274%2C327326%2C122267%2C329766%2C122246%2C327318%2C122251%2C327320%2C122257%2C327322%2C122208%2C327298%2C122226%2C327300&amp;requestList=120686">Reservierung aufheben und neue Terminsuche starten</a>
      const startNewReservation = page.getByRole("link", {
        name: "Reservierung aufheben und neue Terminsuche starten",
      });
      if (await startNewReservation.isVisible()) {
        logger.info("Starting a new reservation process.");
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          startNewReservation.click(),
        ]);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await checkRateLimitExceeded(page);
        await checkCaptcha(page);
      }

      const alreadyTaken = await page
        .getByText("Bitte entschuldigen Sie den Fehler")
        .isVisible();
      if (alreadyTaken) {
        throw new Error("Appointment already taken. Exiting.");
      }

      // Set up MailSlurp email inbox.
      let mailslurp, mailslurpInboxId, mailslurpEmail;
      if (process.env.MAILSLURP_API_KEY) {
        // create a new inbox
        mailslurp = new MailSlurp({ apiKey: process.env.MAILSLURP_API_KEY });
        ({ id: mailslurpInboxId, emailAddress: mailslurpEmail } =
          await mailslurp.createInbox());
        logger.info(
          `Created MailSlurp inbox ${mailslurpEmail} with id: ${mailslurpInboxId}`
        );
      }
      // Select an email to fill in the form with.
      const emailAddress = process.env.MAILSLURP_API_KEY
        ? mailslurpEmail
        : config.email;

      logger.info(`Filling booking form for ${url}`);
      await Promise.all([
        page
          .locator("input#familyName")
          .evaluate((el, name) => (el.value = name), config.name),
        page
          .locator("input#email")
          .evaluate((el, email) => (el.value = email), emailAddress),
        page
          .locator("input#emailequality")
          .evaluate((el, email) => (el.value = email), emailAddress),
        page
          .locator('select[name="surveyAccepted"]')
          .selectOption(config.takeSurvey ? "1" : "0"),
        page.locator("input#agbgelesen").check(),
      ]);

      // The note feature is not available for every location.
      if (config.note) {
        logger.info(
          "Writing the configured note if the feature is available ..."
        );
        const noteInput = page.locator("textarea[name=amendment]");
        if (await noteInput.isVisible()) {
          await noteInput
            .evaluate((el, note) => (el.value = note), config.note)
            .catch((e) =>
              logger.warn(
                `Write note failed. Continuing with booking with no note - ${e.message}`
              )
            );
        }
      }

      // Telephone entry is not available for every location.
      if (config.phone) {
        logger.info(
          "Writing the configured phone number if the feature is available ..."
        );
        const phoneInput = page.locator("input#telephone");
        if (await phoneInput.isVisible()) {
          await phoneInput
            .evaluate((el, phone) => (el.value = phone), config.phone)
            .catch((e) => {
              logger.warn(
                `Failed to write phone number. Continuing with booking without providing a contact number - ${e.message}`
              );
            });
        }
      }

      // Watch for new emails arriving to the MailSlurp inbox.
      let firstEmailPromise;
      if (process.env.MAILSLURP_API_KEY) {
        logger.debug(
          "Reading all emails from MailSlurp inbox so we can wait for new unread emails ..."
        );
        await mailslurp.getEmails(mailslurpInboxId);
        firstEmailPromise = mailslurp.waitForLatestEmail(
          mailslurpInboxId,
          300_000,
          true
        );
      }

      // Submit the appointment booking form.
      function submitBooking() {
        return Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle" }),
          page.locator("button#register_submit.btn").click(),
        ]);
      }
      await submitBooking().catch(async () => {
        await submitBooking();
      });

      // Wait for first email (confirmation or verification code) to arrive.
      let firstEmail, verificationCode;
      if (process.env.MAILSLURP_API_KEY) {
        logger.info(
          `Waiting for email verification code to arrive at inbox with id ${mailslurpInboxId} ...`
        );
        firstEmail = await firstEmailPromise;
        if (/verifizieren/.exec(firstEmail.subject)) {
          verificationCode = /<h2>([0-9a-zA-Z]{6})<\/h2>/.exec(
            firstEmail.body
          )[1];
        }
      } else {
        logger.info("No email verification code was requested.");
      }

      // TODO: Validate the booking confirmation (or verification code page)

      // Function to click submit button
      function submitVerificationCode() {
        // <button class="btn" type="submit" name="submit" value="Termin verifzieren">Termin verifzieren</button>
        return Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle" }),
          page.getByRole("button", { name: "Termin verifzieren" }).click(),
        ]);
      }
      // <input tabindex="" class="" type="text" name="verificationcode" id="verificationcode" value="">
      let secondEmail;
      if (verificationCode) {
        const verificationCodeInput = page.locator("input#verificationcode");
        if (await verificationCodeInput.isVisible()) {
          logger.info(`Filling in verification code: ${verificationCode}`);
          await verificationCodeInput.fill(verificationCode);
          // Watch for new emails arriving to the MailSlurp inbox.
          let secondEmailPromise;
          if (process.env.MAILSLURP_API_KEY) {
            secondEmailPromise = mailslurp.waitForLatestEmail(
              mailslurpInboxId,
              300_000,
              true
            );
          }
          await submitVerificationCode().catch(async () => {
            await submitVerificationCode();
          });
          if (process.env.MAILSLURP_API_KEY) {
            logger.info("Waiting for email confirmation to arrive ...");
            secondEmail = await secondEmailPromise;
          }
        }
      }

      logger.info("Saving booking files ...");
      const savedAt = timestamp();

      async function saveCalendarAttachment(email, suffix) {
        // check has one attachment
        expect(email.attachments.length).toEqual(1);
        const attachmentDto =
          await mailslurp.emailController.downloadAttachmentBase64({
            attachmentId: email.attachments[0],
            emailId: email.id,
          });
        // can access content
        expect(attachmentDto.base64FileContents).toBeTruthy();
        const fileContent = new Buffer(
          attachmentDto.base64FileContents,
          "base64"
        ).toString();
        const outputFilename = `./output/appointment-${suffix}.ics`;
        await fs.writeFile(outputFilename, fileContent);
        logger.info(`Saved calendar attachment to ${outputFilename}`);
      }
      if (secondEmail) {
        await Promise.allSettled([
          saveCalendarAttachment(secondEmail, savedAt),
          fs.writeFile(
            `./output/email-verification-${savedAt}.html`,
            firstEmail.body
          ),
          fs.writeFile(
            `./output/email-confirmation-${savedAt}.html`,
            secondEmail.body
          ),
        ]);
      } else if (firstEmail) {
        await Promise.allSettled([
          saveCalendarAttachment(firstEmail, savedAt),
          fs.writeFile(
            `./output/email-confirmation-${savedAt}.html`,
            firstEmail.body
          ),
        ]);
      }

      await page
        .screenshot({
          path: `./output/web-confirmation-${savedAt}.png`,
          fullPage: true,
        })
        .catch((e) => {
          logger.error(
            `Failed to save screenshot of booking confirmation - ${e.message}`
          );
          logger.info(
            `Check your config.email address for booking info: ${e.message}`
          );
        });
    })
    .finally(async () => {
      await page.close();
    });
}

async function scrapeDateURLs(page) {
  return await page
    .locator("td.buchbar > a")
    .evaluateAll((els) => els.map((el) => el.href).filter((href) => !!href));
}

function filterURLsBetweenDates(urls, { earliestDate, latestDate }) {
  return urls.filter((url) => {
    const linkDate = new Date(parseInt(url.match(/\d+/)[0]) * 1000);
    return (
      new Date(earliestDate) <= linkDate && linkDate <= new Date(latestDate)
    );
  });
}

async function scrapeAppointmentURLs(page) {
  const timetable = page.locator(".timetable");
  if ((await timetable.isVisible()) === false) return [];
  return await timetable
    .locator("td.frei > a")
    .evaluateAll((els) => els.map((el) => el.href).filter((href) => !!href));
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

function checkRateLimitExceeded(page) {
  return expect(page.getByText("Zu viele Zugriffe"), "Rate limit exceeded").not.toBeVisible({ timeout: 1})
}

function checkCaptcha(page) {
  return expect(page.getByRole("heading", { name: "Bitte verifizieren sie sich" }), "Blocked by captcha").not.toBeVisible({ timeout: 1})
}
