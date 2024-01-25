const { expect } = require("@playwright/test");
const MailSlurp = require("mailslurp-client").default;
const Promise = require("bluebird");
const logger = require("../src/logger");
const base = require("../src/test.js");

const test = base.extend({
  mailslurpApiKey: [null, { option: true }],
  mailslurpInboxId: [null, { option: true }],
  formName: [null, { option: true }],
  formPhone: [null, { option: true }],
  formNote: [null, { option: true }],
  formTakeSurvey: ["false", { option: true }],
  appointmentService: ["Anmeldung einer Wohnung", { option: true }],
  appointmentLocations: [null, { option: true }],
  appointmentEarliestDate: ["1970-01-01 GMT", { option: true }],
  appointmentLatestDate: ["2069-12-31 GMT", { option: true }],
  appointmentEarliestTime: ["00:00 GMT", { option: true }],
  appointmentLatestTime: ["23:59 GMT", { option: true }],
  otvNationality: [null, { option: true }],
  otvNumberOfPeople: [null, { option: true }],
  otvLiveWithFamily: [null, { option: true }],
  otvNationalityOfFamily: [null, { option: true }],
  otvService: [null, { option: true }],
  otvReasonType:[null, { option: true }],
  otvReason: [null, { option: true }],
  otvLastName: [null, { option: true }],
  otvFirstName: [null, { option: true }],
  otvBirthDate: [null, { option: true }],
  otvEmail: [null, { option: true }],
});

test("appointment", async ({ context, mailslurpApiKey,
  mailslurpInboxId,
  formName,
  formPhone,
  formNote,
  formTakeSurvey,
  appointmentService,
  appointmentLocations,
  appointmentEarliestDate,
  appointmentLatestDate,
  appointmentEarliestTime,
  appointmentLatestTime,
  otvService,
  otvNumberOfPeople,
  otvLiveWithFamily,
  otvNationality,
  otvNationalityOfFamily,
  otvLastName,
  otvReasonType,
  otvReason,
  otvFirstName,
  otvBirthDate,
  otvEmail,
  }, testInfo) => {
  const serviceURL = await getServiceURL(await context.newPage(), {
    serviceName: appointmentService,
  });
  const servicePage = await getServicePage(await context.newPage(), serviceURL);
  const otvBookingLinkLocator = servicePage.getByRole("link", {
    name: "Termin buchen",
  });
  if (await otvBookingLinkLocator.isVisible()) {
    await otvAppointment(servicePage, {
      nationality: otvNationality,
      numberOfPeople: otvNumberOfPeople,
      withFamily: otvLiveWithFamily,
      familyNationality: otvNationalityOfFamily,
      serviceName: otvService,
      residenceReasonType: otvReasonType,
      residenceReason: otvReason,
      lastName: otvLastName,
      firstName: otvFirstName,
      birthDate: otvBirthDate,
      email: otvEmail,
    });
    return;
  }
  const dateURLs = await getDateURLs(servicePage, {
    locations: appointmentLocations,
    earliestDate: appointmentEarliestDate,
    latestDate:  appointmentLatestDate,
  });
  expect(dateURLs.length, "No available appointment dates").toBeGreaterThan(0);

  const appointmentURLs = await getAppointmentURLs(context, dateURLs, {
    earliestTime: appointmentEarliestTime,
    latestTime: appointmentLatestTime,
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
          mailSlurpAPIKey: mailslurpApiKey,
          mailSlurpInboxId: mailslurpInboxId,
          formName: formName,
          formTakeSurvey: formTakeSurvey,
          formNote: formNote,
          formPhone: formPhone,
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

async function getServicePage(page, url) {
  return await test.step("get service page", async () => {
    page.on("load", async () => {
      await Promise.all([checkRateLimitExceeded(page), checkCaptcha(page)]);
    });
    await page.goto(url);
    return page;
  });
}

async function getDateURLs(page, { locations, earliestDate, latestDate }) {
  return await test
    .step("get date urls", async () => {
      // page.on("load", async () => {
      //   await Promise.all([checkRateLimitExceeded(page), checkCaptcha(page)]);
      // });
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
          page.getByRole("button", { name: "Termin verifzieren" }).click(),
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

async function otvAppointment(
  page,
  {
    nationality,
    numberOfPeople,
    withFamily,
    serviceName,
    familyNationality,
    residenceReasonType,
    residenceReason,
    lastName,
    firstName,
    birthDate,
    email,
  }
) {
  return test.step("otv appointment", async () => {
    const RESOURCE_EXCLUSTIONS = ["stylesheet"];
    await page.route("**/*", (route) => {
      return RESOURCE_EXCLUSTIONS.includes(route.request().resourceType())
        ? route.abort()
        : route.continue();
    });
    page.on("load", async (page) => {
      await Promise.all([
        expect(page, "Unexpectedly logged out").not.toHaveURL("**/logout", {
          timeout: 250,
        }),
        expect(
          page.getByRole("heading", { name: "Sitzungsende" }),
          "Unexpectedly logged out"
        ).not.toBeVisible({ timeout: 250 }),
        expect(
          page.locator(".errorMessage"), // page.getByText("Für die gewählte Dienstleistung sind aktuell keine Termine frei! Bitte versuchen Sie es zu einem späteren Zeitpunkt erneut."),
          "No appointments currently available"
        ).not.toBeVisible({ timeout: 250 }),
      ]);
    });
    const loadingLocator = page.locator(".loading").first();
    await page.getByRole("link", { name: "Termin buchen" }).click();
    await page.waitForURL("**/otv.verwalt-berlin.de/**");
    await page.getByRole("link", { name: "Termin buchen" }).click();
    await page.waitForURL("**/otv.verwalt-berlin.de/ams/TerminBuchen");
    await page.getByRole("checkbox", { name: "Ich erkläre hiermit" }).check();
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.waitForURL("**/otv.verwalt-berlin.de/ams/TerminBuchen");
    await page
      .getByLabel("Staatsangehörigkeit (Wenn Sie")
      .selectOption(nationality);
    // TODO: Use locator like .getByLabel("Anzahl der Personen")
    await page.locator("#xi-sel-422").selectOption(numberOfPeople);
    const serviceLocator = page.getByLabel(serviceName);
    await expect(async () => {
      const withFamilyLocator = page.getByLabel(
        "Leben Sie in Berlin zusammen mit einem Familienangehörigen (z.B. Ehepartner, Kind)*",
        { exact: true }
      );
      // Select the wrong option first to retry selecting the correct option.
      await withFamilyLocator.selectOption(withFamily === "true" ? "2" : "1");
      // Select the correct option.
      await withFamilyLocator.selectOption(withFamily === "true" ? "1" : "2");
      // TODO: familyNationalityLocator is untested so far.
      const familyNationalityLocator = page.getByLabel(
        "Staatsangehörigkeit des Familienangehörigen"
      );
      await page.waitForTimeout(500); // Wait for the form to load.
      if (await familyNationalityLocator.isVisible()) {
        await familyNationalityLocator.selectOption(familyNationality);
      }
      await expect(serviceLocator).toHaveCount(1);
    }).toPass();
    await expect(loadingLocator).not.toBeVisible({timeout: 20_000});
    // await expect(serviceLocator).toBeVisible();
    await serviceLocator.check();
    const residenceReasonTypeLocator = page.getByLabel(residenceReasonType);
    await expect(loadingLocator).not.toBeVisible({timeout: 20_000});
    await page.waitForTimeout(500); // Wait for the form to load.
    if (await residenceReasonTypeLocator.isVisible()) {
      await residenceReasonTypeLocator.check();
    }
    await page.getByLabel(residenceReason).check();
    const lastNameLocator = page.getByLabel("Nachnamen");
    await expect(loadingLocator).not.toBeVisible({timeout: 60_000});
    await page.waitForTimeout(500); // Wait for the form to load.
    if (await lastNameLocator.isVisible()) {
      await lastNameLocator.fill(lastName);
    }
    await page.getByRole("button", { name: "Weiter" }).click();
    const availableAppointments = await page.getByRole("row").getByRole("link");
    await expect(loadingLocator).not.toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500); // Wait for the form to load.
    await availableAppointments.first().click();
    await expect(loadingLocator).not.toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500); // Wait for the form to load.
    await page
      // TODO: Use locator like locator.getByLabel("Bitte wählen Sie einen Tag")
      .locator("#xi-sel-3")
      .selectOption(/\d{1,2}:\d{2}/);
    // TODO: Solve captcha with 2Captcha API
    // Solve captcha with 2Captcha chrome extension
    await expect(loadingLocator).not.toBeVisible({timeout: 60_000});
    await page.waitForTimeout(500); // Wait for the form to load.
    const captchaSolver = page.locator(".captcha-solver");
    await captchaSolver.click();
    await expect(captchaSolver, "Captcha solver didn't solve").toHaveAttribute(
      "data-state",
      "solved",
      { timeout: 150_000 }
    );
    // Submit booking
    await page.getByRole("button", { name: "Weiter" }).click();
    // FIXME: waitForLoadState not working.
    await page.waitForLoadState();
    await expect(loadingLocator).not.toBeVisible({timeout: 60_000});
    await page.waitForTimeout(500); // Wait for the form to load.
    await page.locator('input[name="antragsteller_vname"]').fill(firstName);
    await page.locator('input[name="antragsteller_nname"]').fill(lastName);
    await page.locator('input[name="antragsteller_gebDatum"]').fill(birthDate);
    await page.locator('input[name="antragsteller_email"]').fill(email);
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.waitForLoadState();
    await page.getByRole("button", { name: "Termin buchen" }).click();
    await page.waitForLoadState();
    await page.waitForTimeout(60_000);
    // TODO: Save booking confirmation or handle whatever comes next.
  });
}
