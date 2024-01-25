const { defineConfig, devices } = require("@playwright/test");

// Function to convert a string to lower camel case
const toLowerCamelCase = (str) => {
  return str
      .toLowerCase()
      .replace(/_./g, (match) => match.charAt(1).toUpperCase());
};

// Destructuring `process.env` into lower camel case form
const lowerCamelCaseEnv = Object.entries(process.env).reduce((acc, [key, value]) => {
  acc[toLowerCamelCase(key)] = value;
  return acc;
}, {});

const launchOptionsArgs = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  `--disable-extensions-except=2captcha-solver-3.4.0`,
  "--load-extension=2captcha-solver-3.4.0",
];

if (process.env.HEADED !== "true") {
  launchOptionsArgs.push('--headless=new');
}

module.exports = defineConfig({
  name: "anmeldung-berlin",
  testDir: "./tests/",
  timeout: 0,
  reporter: [["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    launchOptions: {
      args: launchOptionsArgs,
    },
    proxy: process.env.PROXY_URL
      ? { server: process.env.PROXY_URL }
      : undefined,
    actionTimeout: 10 * 1000,
    navigationTimeout: 60 * 1000,
    ...lowerCamelCaseEnv,
  },
  projects: [
    {
      name: "appointment",
      testMatch: /appointment\.test\./,
    },
    {
      name: "stealth",
      testMatch: /stealth\.test\./,
    },
    {
      name: "service.berlin.de",
      testMatch: /appointment\.test\./,
      use: {
        formName: "Max Mustermann",
        formPhone: "0176 55555555",
        appointmentService: "Anmeldung einer Wohnung",
      },
    },
    {
      name: "otv.verwalt-berlin.de",
      testMatch: /appointment\.test\./,
      use: {
        appointmentService: "Aufenthaltserlaubnis zur selbstständigen Tätigkeit - Erteilung",
        otvNationality: "Vereinigte Staaten von Amerika",
        otvNumberOfPeople: "2",
        otvLiveWithFamily: "true",
        otvNationalityOfFamily: "Vereinigte Staaten von Amerika",
        otvService: "Aufenthaltstitel - beantragen",
        otvReasonType: "Erwerbstätigkeit",
        otvReason: "selbstständigen Tätigkeit - Erteilung",
        otvLastName: "Mustermann",
        otvFirstName: "Max",
        otvBirthDate: "01.01.1990",
      },
    },
  ],
});
