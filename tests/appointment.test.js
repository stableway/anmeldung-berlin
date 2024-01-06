const { expect } = require("@playwright/test");
const MailSlurp = require("mailslurp-client").default;
const Promise = require("bluebird");
const logger = require("../src/logger");
const test = require("../src/test.js")({
  MAILSLURP_API_KEY: null,
  MAILSLURP_INBOX_ID: null,
  FORM_NAME: null,
  FORM_PHONE: null,
  FORM_NOTE: null,
  FORM_TAKE_SURVEY: "false",
  APPOINTMENT_SERVICE: "Anmeldung einer Wohnung",
  APPOINTMENT_LOCATIONS: null,
  APPOINTMENT_EARLIEST_DATE: "1970-01-01 GMT",
  APPOINTMENT_LATEST_DATE: "2069-12-31 GMT",
  APPOINTMENT_EARLIEST_TIME: "00:00 GMT",
  APPOINTMENT_LATEST_TIME: "23:59 GMT",
});

test("appointment", async ({ context, params }, testInfo) => {
  logger.debug(JSON.stringify(params, null, 2));
  const serviceURL = await getServiceURL(context, params);
  const dateURLs = await getDateURLs(context, serviceURL, params);
  expect(dateURLs.length, "No available appointment dates").toBeGreaterThan(0);

  const appointmentURLs = await getAppointmentURLs(context, dateURLs, params);
  expect(
    appointmentURLs.length,
    "No available appointments on any appointment date"
  ).toBeGreaterThan(0);

  for (const appointmentURL of appointmentURLs) {
    try {
      await bookAppointment(context, appointmentURL, params, testInfo);
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

async function getServiceURL(context, params) {
  return await test.step("get service url", async () => {
    const page = await context.newPage();
    const servicesURL = "https://service.berlin.de/dienstleistungen/";
    await page.goto(servicesURL, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    const serviceLinkLocator = page.getByRole("link", {
      name: params.APPOINTMENT_SERVICE,
    });
    await expect(
      serviceLinkLocator,
      `Service ${params.APPOINTMENT_SERVICE} not found at ${servicesURL}`
    ).toBeVisible();
    const serviceUrl = await serviceLinkLocator.getAttribute("href");
    await page.close();
    return serviceUrl;
  });
}

async function getDateURLs(context, serviceURL, params) {
  return await test.step("get date urls", async () => {
    const page = await context.newPage();
    await page.goto(serviceURL, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    await selectLocations(
      page,
      {
        locations: params.APPOINTMENT_LOCATIONS
          ? params.APPOINTMENT_LOCATIONS.split(",")
          : [],
      },
      logger
    );
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
    logger.debug(`Found ${dateURLs.length} appointment dates.`);
    const filteredDateURLs = filterURLsBetweenDates(dateURLs, {
      earliestDate: params.APPOINTMENT_EARLIEST_DATE,
      latestDate: params.APPOINTMENT_LATEST_DATE,
    });
    logger.debug(
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
      // TODO: First location in params.APPOINTMENT_LOCATIONS must always exist or this will fail.
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

async function getAppointmentURLs(context, dateURLs, params) {
  return await test.step("get appointment urls", async () => {
    return await [].concat.apply(
      [],
      await Promise.map(
        dateURLs,
        async (url) =>
          getAppointmentURLsForDateURL(
            await context.newPage(),
            url,
            params,
            logger
          ).catch((e) => {
            // If one URL fails, just return [] and go ahead with the URLs you could find.
            logger.error(`Get appointments failed for ${url} - ${e.message}`);
            return [];
          }),
        { concurrency: parseInt(process.env.CONCURRENCY || "16") }
      )
    );
  });
}

async function getAppointmentURLsForDateURL(page, url, params) {
  return await test.step(`get appointment urls for ${url}`, async () => {
    logger.debug(`Getting appointments for ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    const urls = await scrapeAppointmentURLs(page);
    logger.debug(`Found ${urls.length} appointments for ${url}`);
    const filteredURLs = filterURLsBetweenTimes(urls, {
      earliestTime: params.APPOINTMENT_EARLIEST_TIME,
      latestTime: params.APPOINTMENT_LATEST_TIME,
    });
    logger.debug(
      `Found ${filteredURLs.length} appointments within the configured time range for ${url}`
    );
    await page.close();
    return filteredURLs;
  });
}

async function bookAppointment(context, url, params, testInfo) {
  await test.step(`book appointment at ${url}`, async () => {
    logger.debug(`Retrieving booking page for ${url}`);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await checkRateLimitExceeded(page);
    await checkCaptcha(page);
    // This block is executed if the first appointment link failed and more than 1 appointment link was found.
    const startNewReservation = page.getByRole("link", {
      name: "Reservierung aufheben und neue Terminsuche starten",
    });
    if (await startNewReservation.isVisible()) {
      logger.debug("Starting a new reservation process.");
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
    const mailslurp = new MailSlurp({ apiKey: params.MAILSLURP_API_KEY });
    let inboxId = params.MAILSLURP_INBOX_ID;
    if (!inboxId) {
      ({ id: inboxId } = await mailslurp.createInbox());
      logger.debug(`Created MailSlurp inbox with id: ${inboxId}`);
    }
    const inbox = await mailslurp.getInbox(inboxId);

    logger.debug(`Filling booking form for ${url}`);
    const name = params.FORM_NAME;
    const takeSurvey = params.FORM_TAKE_SURVEY;
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
    const note = params.FORM_NOTE;
    if (note) {
      logger.debug(
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
    const phone = params.FORM_PHONE;
    if (phone) {
      logger.debug(
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
    logger.debug(
      `Waiting for email verification code to arrive at inbox with id ${inboxId} ...`
    );
    const firstEmail = await mailslurp.waitForLatestEmail(
      inboxId,
      300_000,
      true
    );

    let verificationCode;
    if (/verifizieren/.exec(firstEmail.subject)) {
      verificationCode = /<h2>([0-9a-zA-Z]{6})<\/h2>/.exec(firstEmail.body)[1];
    } else {
      logger.debug("No email verification code was requested");
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
        logger.debug(`Filling in verification code: ${verificationCode}`);
        await verificationCodeInput.fill(verificationCode);
        await submitVerificationCode().catch(async () => {
          await submitVerificationCode();
        });
        logger.debug("Waiting for email confirmation to arrive ...");
        secondEmail = await mailslurp.waitForLatestEmail(
          inboxId,
          300_000,
          true
        );
      }
    }

    async function saveCalendarAttachment(email, suffix) {
      expect(email.attachments.length).toEqual(1);
      const attachmentDto =
        await mailslurp.emailController.downloadAttachmentBase64({
          attachmentId: email.attachments[0],
          emailId: email.id,
        });
      expect(attachmentDto.base64FileContents).toBeTruthy();
      const fileContent = new Buffer(
        attachmentDto.base64FileContents,
        "base64"
      ).toString();
      await testInfo.attach(`appointment-${suffix}.ics`, { body: fileContent });
    }

    async function saveConfirmationPage(suffix) {
      const screenshot = await page.screenshot({ fullPage: true });
      return testInfo.attach(`web-confirmation-${suffix}`, {
        body: screenshot,
        contentType: "image/png",
      });
    }

    const savedAt = timestamp();
    logger.debug(`Saving booking files for booking at ${savedAt} ...`);
    if (secondEmail) {
      await Promise.allSettled([
        saveCalendarAttachment(secondEmail, savedAt),
        saveConfirmationPage(savedAt),
        testInfo.attach(`email-verification-${savedAt}`, {
          body: firstEmail.body,
          contentType: "text/html",
        }),
        testInfo.attach(`email-confirmation-${savedAt}`, {
          body: secondEmail.body,
          contentType: "text/html",
        }),
      ]);
    } else if (firstEmail) {
      await Promise.allSettled([
        saveCalendarAttachment(firstEmail, savedAt),
        saveConfirmationPage(savedAt),
        testInfo.attach(`email-confirmation-${savedAt}`, {
          body: firstEmail.body,
          contentType: "text/html",
        }),
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

function checkRateLimitExceeded(page) {
  return expect(
    page.getByRole("heading", { name: "Zu viele Zugriffe" }),
    "Rate limit exceeded"
  ).not.toBeVisible({ timeout: 1 });
}

function checkCaptcha(page) {
  return expect(
    page.getByRole("heading", { name: "Bitte verifizieren sie sich" }),
    "Blocked by captcha"
  ).not.toBeVisible({ timeout: 1 });
}
