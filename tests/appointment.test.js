const { expect, test } = require("@playwright/test");
const fs = require("fs").promises;
const MailSlurp = require("mailslurp-client").default;
const Promise = require("bluebird");
const winston = require("winston");

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
  level: process.env.LOG_LEVEL || "info",
});

test.beforeEach(async ({ context }) => {
  await context.addInitScript({ path: "stealth.min.js" });
});

test.afterEach(async ({ context }, testInfo) => {
  await context.close();
  if (testInfo.status !== testInfo.expectedStatus) {
    logger.warn(`Appointment booking failed: ${testInfo.error.message}`);
  }
  if (testInfo.retry) {
    let waitSeconds = parseInt(process.env.RETRY_WAIT_SECONDS || "120");
    if (testInfo.error.message === "Rate limit exceeded") {
      waitSeconds = parseInt(process.env.RETRY_WAIT_SECONDS_BLOCKED || "600");
    }
    logger.info(`Waiting ${waitSeconds} seconds then retrying`);
    await sleep(waitSeconds * 1000);
  }
});

test("appointment", async ({ context }) => {
  const serviceURL = await getServiceURL(context);
  const dateURLs = await getDateURLs(context, serviceURL);
  expect(dateURLs.length, "No available appointment dates").toBeGreaterThan(0);

  const appointmentURLs = getAppointmentURLs(context, dateURLs);
  expect(
    appointmentURLs.length,
    "No available appointments on any appointment date"
  ).toBeGreaterThan(0);

  for (const appointmentURL of appointmentURLs) {
    try {
      logger.info(`Booking appointment at ${appointmentURL}`);
      await bookAppointment(context, appointmentURL);
      logger.info("Booking successful!");
      return;
    } catch (e) {
      logger.error(
        `Booking appointment failed at ${appointmentURL}: ${e.message}`
      );
    }
  }
  throw new Error("Booking failed for all appointments.");
});

function timestamp() {
  return new Date(Date.now()).toUTCString();
}

async function getServiceURL(context) {
  return await test.step("get service url", async () => {
    const page = await context.newPage();
    const servicesURL = "https://service.berlin.de/dienstleistungen/";
    await page.goto(servicesURL, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    const appointmentService =
      process.env.APPT_SERVICE || "Anmeldung einer Wohnung";
    const serviceLinkLocator = page.getByRole("link", {
      name: appointmentService,
    });
    await expect(
      serviceLinkLocator,
      `Service ${appointmentService} not found at ${servicesURL}`
    ).toBeVisible();
    const serviceUrl = await serviceLinkLocator.getAttribute("href");
    await page.close();
    return serviceUrl;
  });
}

async function getDateURLs(context, serviceURL) {
  return await test.step("get date urls", async () => {
    const page = await context.newPage();
    await page.goto(serviceURL, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    const appointmentLocations = process.env.APPT_LOCATIONS
      ? process.env.APPT_LOCATIONS.split(",")
      : [];
    await selectLocations(page, {
      locations: appointmentLocations,
    });
    logger.info("Navigating to the appointment calendar");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page
        .getByRole("button", { name: "An diesem Standort einen Termin buchen" })
        .click(),
    ]);
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    await expect(
      page,
      "No appointments available for the selected locations"
    ).not.toHaveURL(/service\.berlin\.de\/terminvereinbarung\/termin\/taken/, {
      timeout: 1,
    });
    // TODO: Check for maintenance page "Wartung"
    // if (page.getByRole("heading", { name: "Wartung" }).isVisible()) {
    //   throw new Error("Site down for maintenance. Exiting.");
    // }
    logger.debug(`Calendar url: ${page.url()}`);
    const dateURLsPage1 = await scrapeDateURLs(page);
    // TODO: use page.getByRole for pagination button
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.locator("th.next").click(),
    ]);
    const dateURLsPage2 = await scrapeDateURLs(page);
    const dateURLs = [...new Set(dateURLsPage1.concat(dateURLsPage2))];
    logger.info(`Found ${dateURLs.length} appointment dates.`);
    const appointmentEarliestDate =
      process.env.APPT_EARLIEST_DATE || "1970-01-01 GMT";
    const appointmentLatestDate =
      process.env.APPT_LATEST_DATE || "2069-12-31 GMT";
    const filteredDateURLs = filterURLsBetweenDates(dateURLs, {
      earliestDate: appointmentEarliestDate,
      latestDate: appointmentLatestDate,
    });
    logger.info(
      `Found ${filteredDateURLs.length} appointment dates within the configured date range.`
    );
    await page.close();
    return filteredDateURLs;
  });
}

async function selectLocations(page, { locations }) {
  await test.step("select locations", async () => {
    // All locations are selected if locations is empty.
    if (locations.length === 0) {
      // Actually click the first checkbox for submit actionability, then check all checkboxes in parallel for speed.
      const checkboxLocator = page.getByRole("checkbox");
      await checkboxLocator.first().check();
      await checkboxLocator.evaluateAll((els) =>
        els.map((el) => (el.checked = true))
      );
    } else {
      // TODO: First location in process.env.APPT_LOCATIONS must always exist or this will fail.
      await page
        .getByRole("checkbox", { name: locations[0], exact: true })
        .check();
      await Promise.map(locations, async (location) =>
        page
          .getByRole("checkbox", { name: location, exact: true })
          .evaluate((el) => (el.checked = true))
          .catch((e) =>
            logger.warn(
              `Failed to select location ${location} - Continuing without selecting it: ${e.message}`
            )
          )
      );
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
          getAppointmentURLsForDateURL(await context.newPage(), url).catch(
            (e) => {
              // If one URL fails, just return [] and go ahead with the URLs you could find.
              logger.error(`Get appointments failed for ${url} - ${e.message}`);
              return [];
            }
          ),
        { concurrency: parseInt(process.env.CONCURRENCY || "3") }
      )
    );
  });
}

async function getAppointmentURLsForDateURL(page, url) {
  return await test.step(`get appointment urls for ${url}`, async () => {
    logger.info(`Getting appointments for ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    const urls = await scrapeAppointmentURLs(page);
    logger.info(`Found ${urls.length} appointments for ${url}`);
    const filteredURLs = filterURLsBetweenTimes(urls, {
      earliestTime: process.env.APPT_EARLIEST_TIME || "00:00 GMT",
      latestTime: process.env.APPT_LATEST_TIME || "23:59 GMT",
    });
    logger.info(
      `Found ${filteredURLs.length} appointments within the configured time range for ${url}`
    );
    await page.close();
    return filteredURLs;
  });
}

async function bookAppointment(context, url) {
  await test.step(`book appointment at ${url}`, async () => {
    logger.info(`Retrieving booking page for ${url}`);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    // This block is executed if the first appointment link failed and more than 1 appointment link was found.
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

    // Set up MailSlurp inbox
    const mailslurp = new MailSlurp({ apiKey: process.env.MAILSLURP_API_KEY });
    let inboxId = process.env.MAILSLURP_INBOX_ID;
    if (!inboxId) {
      ({ id: inboxId } = await mailslurp.createInbox());
      logger.info(`Created MailSlurp inbox with id: ${inboxId}`);
    }
    const inbox = await mailslurp.getInbox(inboxId);

    logger.info(`Filling booking form for ${url}`);
    const name = process.env.FORM_NAME || "Max Mustermann";
    const takeSurvey = process.env.FORM_TAKE_SURVEY || "false";
    await Promise.all([
      page
        .locator("input#familyName")
        .evaluate((el, name) => (el.value = name), name),
      page
        .locator("input#email")
        .evaluate((el, email) => (el.value = email), inbox.emailAddress),
      page
        .locator("input#emailequality")
        .evaluate((el, email) => (el.value = email), inbox.emailAddress),
      page
        .locator('select[name="surveyAccepted"]')
        .selectOption(takeSurvey === "true" ? "1" : "0"),
      page.locator("input#agbgelesen").check(),
    ]);

    // The note feature is not available for every location.
    const note = process.env.FORM_NOTE || "";
    if (note) {
      logger.info(
        "Writing the configured note if the feature is available ..."
      );
      const noteInput = page.locator("textarea[name=amendment]");
      if (await noteInput.isVisible()) {
        await noteInput
          .evaluate((el, note) => (el.value = note), note)
          .catch((e) =>
            logger.warn(
              `Write note failed. Continuing with booking with no note - ${e.message}`
            )
          );
      }
    }

    // Telephone entry is not available for every location.
    const phone = process.env.FORM_PHONE || "0176 55555555";
    if (phone) {
      logger.info(
        "Writing the configured phone number if the feature is available ..."
      );
      const phoneInput = page.locator("input#telephone");
      if (await phoneInput.isVisible()) {
        await phoneInput
          .evaluate((el, phone) => (el.value = phone), phone)
          .catch((e) => {
            logger.warn(
              `Failed to write phone number. Continuing with booking without providing a contact number - ${e.message}`
            );
          });
      }
    }

    logger.debug(
      "Reading all emails from MailSlurp inbox so we can wait for new unread emails ..."
    );
    await mailslurp.getEmails(inboxId, { unreadOnly: true });

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
    logger.info(
      `Waiting for email verification code to arrive at inbox with id ${inboxId} ...`
    );
    const firstEmail = await mailslurp.waitForLatestEmail({
      inboxId,
      timeout: 300_000,
      unreadOnly: true,
    });

    let verificationCode;
    if (/verifizieren/.exec(firstEmail.subject)) {
      verificationCode = /<h2>([0-9a-zA-Z]{6})<\/h2>/.exec(firstEmail.body)[1];
    } else {
      logger.info("No email verification code was requested");
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
    let secondEmail;
    if (verificationCode) {
      const verificationCodeInput = page.locator("input#verificationcode");
      if (await verificationCodeInput.isVisible()) {
        logger.info(`Filling in verification code: ${verificationCode}`);
        await verificationCodeInput.fill(verificationCode);
        await submitVerificationCode().catch(async () => {
          await submitVerificationCode();
        });
        logger.info("Waiting for email confirmation to arrive ...");
        secondEmail = await mailslurp.waitForLatestEmail({
          inboxId,
          timeout: 300_000,
          unreadOnly: true,
        });
      }
    }

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

    function saveConfirmationPage(suffix) {
      return page
        .screenshot({
          // TODO: Write these to test-results
          path: `./output/web-confirmation-${suffix}.png`,
          fullPage: true,
        })
        .catch((e) => {
          logger.error(
            `Failed to save screenshot of booking confirmation - ${e.message}`
          );
          logger.info(
            `Check your MailSlurp inbox for booking info: ${e.message}`
          );
        });
    }

    const savedAt = timestamp();
    logger.info(`Saving booking files for booking at ${savedAt} ...`);
    if (secondEmail) {
      await Promise.allSettled([
        saveCalendarAttachment(secondEmail, savedAt),
        saveConfirmationPage(savedAt),
        // TODO: Write these to test-results
        fs.writeFile(
          `./output/email-verification-${savedAt}.html`,
          firstEmail.body
        ),
        // TODO: Write these to test-results
        fs.writeFile(
          `./output/email-confirmation-${savedAt}.html`,
          secondEmail.body
        ),
      ]);
    } else if (firstEmail) {
      await Promise.allSettled([
        saveCalendarAttachment(firstEmail, savedAt),
        saveConfirmationPage(savedAt),
        // TODO: Write these to test-results
        fs.writeFile(
          `./output/email-confirmation-${savedAt}.html`,
          firstEmail.body
        ),
      ]);
    }
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
  return expect(
    page.getByText("Zu viele Zugriffe"),
    "Rate limit exceeded"
  ).not.toBeVisible({ timeout: 1 });
}

function checkCaptcha(page) {
  return expect(
    page.getByRole("heading", { name: "Bitte verifizieren sie sich" }),
    "Blocked by captcha"
  ).not.toBeVisible({ timeout: 1 });
}
