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
  const serviceURL = await getServiceURL(await context.newPage(), {
    serviceName: params.APPOINTMENT_SERVICE,
  });
  const dateURLs = await getDateURLs(await context.newPage(), serviceURL, {
    locations: params.APPOINTMENT_LOCATIONS,
    earliestDate: params.APPOINTMENT_EARLIEST_DATE,
    latestDate: params.APPOINTMENT_LATEST_DATE,
  });
  expect(dateURLs.length, "No available appointment dates").toBeGreaterThan(0);

  const appointmentURLs = await getAppointmentURLs(context, dateURLs, {
    earliestTime: params.APPOINTMENT_EARLIEST_TIME,
    latestTime: params.APPOINTMENT_LATEST_TIME,
  });
  expect(
    appointmentURLs.length,
    "No available appointments on any appointment date"
  ).toBeGreaterThan(0);

  for (const appointmentURL of appointmentURLs) {
    try {
      await bookAppointment(
        context,
        appointmentURL,
        {
          mailSlurpAPIKey: params.MAILSLURP_API_KEY,
          mailSlurpInboxId: params.MAILSLURP_INBOX_ID,
          formName: params.FORM_NAME,
          formTakeSurvey: params.FORM_TAKE_SURVEY,
          formNote: params.FORM_NOTE,
          formPhone: params.FORM_PHONE,
        },
        testInfo
      );
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

async function getServiceURL(page, { serviceName }) {
  return await test
    .step("get service url", async () => {
      page.on("load", async () => {
        await Promise.all([checkRateLimitExceeded(page), checkCaptcha(page)]);
      });
      const servicesURL = "https://service.berlin.de/dienstleistungen/";
      await page.goto(servicesURL, { waitUntil: "domcontentloaded" });
      const serviceLinkLocator = page.getByRole("link", {
        name: serviceName,
        exact: true,
      });
      await expect(
        serviceLinkLocator,
        `Service ${serviceName} not found at ${servicesURL}`
      ).toBeVisible();
      const serviceUrl = await serviceLinkLocator.getAttribute("href");
      return serviceUrl;
    })
    .finally(async () => {
      await page.close();
    });
}

async function getDateURLs(
  page,
  serviceURL,
  { locations, earliestDate, latestDate }
) {
  return await test
    .step("get date urls", async () => {
      page.on("load", async () => {
        await Promise.all([checkRateLimitExceeded(page), checkCaptcha(page)]);
      });
      await page.goto(serviceURL, { waitUntil: "domcontentloaded" });
      await selectLocations(page, {
        locations: locations ? locations.split(",") : [],
      });
      await Promise.all([
        page.waitForNavigation(),
        page
          .getByRole("button", {
            name: "An diesem Standort einen Termin buchen",
          })
          .click(),
      ]);
      await expect(
        page,
        "No appointments available for the selected locations"
      ).not.toHaveURL(
        /service\.berlin\.de\/terminvereinbarung\/termin\/taken/,
        {
          timeout: 1,
        }
      );
      await expect(
        page.getByRole("heading", { name: "Wartung" }),
        "Website is down for maintenance"
      ).not.toBeVisible({ timeout: 1 });
      await expect(
        page.getByRole("heading", {
          name: "Die Terminvereinbarung ist zur Zeit nicht",
        }),
        "Appointment booking not possible at this time"
      ).not.toBeVisible({ timeout: 1 });

      logger.debug(`Calendar url: ${page.url()}`);
      const dateURLsPage1 = await scrapeDateURLs(page);
      // TODO: use page.getByRole for pagination button
      let dateURLsPage2 = [];
      const nextButtonLocator = page.locator("th.next");
      if (await nextButtonLocator.isVisible()) {
        await Promise.all([
          page.waitForNavigation(),
          page.locator("th.next").click(),
        ]);
        dateURLsPage2 = await scrapeDateURLs(page);
      }
      const dateURLs = [...new Set(dateURLsPage1.concat(dateURLsPage2))];
      logger.debug(`Found ${dateURLs.length} appointment dates.`);
      const filteredDateURLs = filterURLsBetweenDates(dateURLs, {
        earliestDate,
        latestDate,
      });
      logger.debug(
        `Found ${filteredDateURLs.length} appointment dates within the configured date range.`
      );
      return filteredDateURLs;
    })
    .finally(async () => {
      await page.close();
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

async function getAppointmentURLs(
  context,
  dateURLs,
  { earliestTime, latestTime }
) {
  return await test.step("get appointment urls", async () => {
    return await [].concat.apply(
      [],
      await Promise.map(
        dateURLs,
        async (url) =>
          getAppointmentURLsForDateURL(await context.newPage(), url, {
            earliestTime,
            latestTime,
          }).catch((e) => {
            // If one URL fails, just return [] and go ahead with the URLs you could find.
            logger.error(`Get appointments failed for ${url} - ${e.message}`);
            return [];
          }),
        { concurrency: parseInt(process.env.CONCURRENCY || "16") }
      )
    );
  });
}

async function getAppointmentURLsForDateURL(
  page,
  url,
  { earliestTime, latestTime }
) {
  return await test
    .step(`get appointment urls for ${url}`, async () => {
      page.on("load", async () => {
        await Promise.all([checkRateLimitExceeded(page), checkCaptcha(page)]);
      });
      logger.debug(`Getting appointments for ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const urls = await scrapeAppointmentURLs(page);
      logger.debug(`Found ${urls.length} appointments for ${url}`);
      const filteredURLs = filterURLsBetweenTimes(urls, {
        earliestTime,
        latestTime,
      });
      logger.debug(
        `Found ${filteredURLs.length} appointments within the configured time range for ${url}`
      );
      return filteredURLs;
    })
    .finally(async () => {
      await page.close();
    });
}

async function bookAppointment(
  context,
  url,
  {
    mailSlurpAPIKey,
    mailSlurpInboxId,
    formName,
    formTakeSurvey,
    formNote,
    formPhone,
  },
  testInfo
) {
  await test.step(`book appointment at ${url}`, async () => {
    logger.debug(`Retrieving booking page for ${url}`);
    const page = await context.newPage();
    page.on("load", async () => {
      await Promise.all([checkRateLimitExceeded(page), checkCaptcha(page)]);
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // This block is executed if the first appointment link failed and more than 1 appointment link was found.
    const startNewReservation = page.getByRole("link", {
      name: "Reservierung aufheben und neue Terminsuche starten",
    });
    if (await startNewReservation.isVisible()) {
      logger.debug("Starting a new reservation process.");
      await Promise.all([
        page.waitForNavigation(),
        startNewReservation.click(),
      ]);
      await page.goto(url);
    }
    await expect(
      page.getByRole("heading", { name: "Bitte entschuldigen Sie den Fehler" }),
      "Appointment already taken"
    ).not.toBeVisible({ timeout: 1 });

    await expect(
      page.getByRole("heading", { name: "Terminvereinbarung" }),
      "Booking page not reached"
    ).toBeVisible();

    // Set up MailSlurp inbox
    const mailslurp = new MailSlurp({ apiKey: mailSlurpAPIKey });
    let inboxId = mailSlurpInboxId;
    if (!inboxId) {
      ({ id: inboxId } = await mailslurp.createInbox());
      logger.debug(`Created MailSlurp inbox with id: ${inboxId}`);
    }
    const inbox = await mailslurp.getInbox(inboxId);

    logger.debug(`Filling booking form for ${url}`);
    await Promise.all([
      page
        .locator("input#familyName")
        .evaluate((el, name) => (el.value = name), formName),
      page
        .locator("input#email")
        .evaluate((el, email) => (el.value = email.trim()), inbox.emailAddress),
      page
        .locator("input#emailequality")
        .evaluate((el, email) => (el.value = email.trim()), inbox.emailAddress),
      page
        .locator('select[name="surveyAccepted"]')
        .selectOption(formTakeSurvey === "true" ? "1" : "0"),
      page.locator("input#agbgelesen").check(),
    ]);

    // The note feature is not available for every location.
    if (formNote) {
      logger.debug(
        "Writing the configured note if the feature is available ..."
      );
      const noteInput = page.locator("textarea[name=amendment]");
      if (await noteInput.isVisible()) {
        await noteInput
          .evaluate((el, note) => (el.value = note), formNote)
          .catch((e) =>
            logger.warn(
              `Write note failed. Continuing with booking with no note - ${e.message}`
            )
          );
      }
    }

    // Telephone entry is not available for every location.
    if (formPhone) {
      logger.debug(
        "Writing the configured phone number if the feature is available ..."
      );
      const phoneInput = page.locator("input#telephone");
      if (await phoneInput.isVisible()) {
        await phoneInput
          .evaluate((el, phone) => (el.value = phone), formPhone)
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
    logger.debug("Submitting appointment booking form ...");
    await expect(async () => {
      await Promise.all([
        page.waitForNavigation(),
        page.locator("button#register_submit.btn").click(),
      ]);
      await expect(
        page.getByRole("heading", {
          name: /Terminbuchung - Email bestätigen|Terminbestätigung/,
        })
      ).toBeVisible();
    }, "Form submission failed").toPass();

    // Wait for first email (confirmation or verification code) to arrive.
    logger.debug(
      `Waiting for first email (verification or confirmation) to arrive at inbox with id ${inboxId} ...`
    );
    // TODO: "fetch failed" error message sporadically occurs here.
    const firstEmail = await mailslurp.waitForLatestEmail(
      inboxId,
      300_000,
      true
    );

    let verificationCode, secondEmail;
    if (/verifizieren/.exec(firstEmail.subject)) {
      logger.debug("Email verification code requested");
      verificationCode = /<h2>([0-9a-zA-Z]{6})<\/h2>/.exec(firstEmail.body)[1];
      logger.debug(`Verification code: ${verificationCode}`);

      const verificationCodeInput = page.locator("input#verificationcode");
      await expect(verificationCodeInput).toBeVisible();

      // Fill & submit the verification code.
      await verificationCodeInput.fill(verificationCode);
      logger.debug("Submitting verification code ...");
      await expect(async () => {
        await Promise.all([
          page.waitForNavigation(),
          page.getByRole("button", { name: "Termin verifizieren" }).click(),
        ]);
        await expect(
          page.getByRole("heading", { name: "Terminbestätigung" })
        ).toBeVisible();
      }, "Verification code submission failed").toPass();

      logger.debug("Waiting for second email (confirmation) to arrive ...");
      // TODO: "fetch failed" error message sporadically occurs here.
      secondEmail = await mailslurp.waitForLatestEmail(inboxId, 300_000, true);
    } else {
      logger.debug("No email verification code requested");
      await expect(
        page.getByRole("heading", { name: "Terminbestätigung" }),
        "Confirmation page not reached"
      ).toBeVisible();
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

function scrapeDateURLs(page) {
  return page
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
  await expect(timetable, "No timetable found").toBeVisible();
  return timetable
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
