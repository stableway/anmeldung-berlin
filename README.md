# anmeldung-berlin

This app will find and book any [service.berlin.de](https://service.berlin.de) appointment that can be booked online.

## Quickstart

### 1. Get a MailSlurp API Key

Get a [MailSlurp API key here](https://app.mailslurp.com/sign-up/).

### 2a. Run with Docker (recommended)

Build & run Docker container.

```bash
# Update stealth evasions
npx extract-stealth-evasions
# Build
docker build -t anmeldung-berlin .
# Book an "Anmeldung einer Wohnung" appointment
docker run \
    -v $(pwd)/playwright-report:/home/pwuser/playwright-report \
    -v $(pwd)/test-results:/home/pwuser/test-results \
    -e MAILSLURP_API_KEY=*your-api-key* \
    -e FORM_NAME=*your-name* \
    -e FORM_PHONE=*your-phone-number* \
    anmeldung-berlin
# Book an "Blaue Karte EU auf einen neuen Pass übertragen" appointment on/after 01 Feb 2024 & before/on 28 Feb 2024 at any time.
docker run \
    -v $(pwd)/playwright-report:/home/pwuser/playwright-report \
    -v $(pwd)/test-results:/home/pwuser/test-results \
    -e MAILSLURP_API_KEY=*your-api-key* \
    -e FORM_NAME=*your-name* \
    -e FORM_PHONE=*your-phone-number* \
    -e APPOINTMENT_SERVICE="Blaue Karte EU auf einen neuen Pass übertragen" \
    -e APPOINTMENT_EARLIEST_DATE="2024-02-01 GMT" \
    -e APPOINTMENT_LATEST_DATE="2024-02-28 GMT" \
    anmeldung-berlin
```

### 2b. Run with Docker Compose through a Proxy

This setup uses `docker compose` and consists of two services:

- **Application**: Processes the booking
- **Tor Proxy**: Avoids rate limiting and blocks

This allows the application to run in a loop until a successful booking is made without risking being blocked.

To get started, follow these steps:

```bash
npx extract-stealth-evasions
cp .env.example .env
# Then edit .env with your preferred settings
docker compose up --build
```

### 2c. Run Locally on Mac OS

Run the program from the command line.

```bash
# Update stealth evasions
npx extract-stealth-evasions
# Install dependencies
npm i
# Install Chrome browser
npx playwright install chrome
# Book an "Anmeldung einer Wohnung" appointment
MAILSLURP_API_KEY=*your-api-key* FORM_NAME=*your-name* FORM_PHONE=*your-phone-number* \
    npm start
# Book an "Abmeldung einer Wohnung" appointment starting on/after 10:00 AM and before/at 1:00 PM on any date.
MAILSLURP_API_KEY=*your-api-key* FORM_NAME=*your-name* FORM_PHONE=*your-phone-number* \
    APPOINTMENT_SERVICE="Abmeldung einer Wohnung" \
    APPOINTMENT_EARLIEST_TIME="10:00 GMT" \
    APPOINTMENT_LATEST_TIME="13:00 GMT" \
    npm run debug
```

## Deployment

Set [playwright.config.js](/playwright.config.js) `retries` to a high number, if you want to run the app locally until a successful booking is made. You may very well be blocked for exceeding a rate limit. In this case, try setting `PROXY_URL` to a back-connect proxy URL.

## Parameters

The app is parameterized via environment variables at runtime, which have default values (sometimes `null`) defined in the [Playwright test](./tests/appointment.test.js)

For [making an appointment](/tests/appointment.test.js), the parameters are:

Environment Variable | Parameter Default | Description
---------|----------|---------
 `MAILSLURP_API_KEY` | `null` | API key for MailSlurp service. [Required]
 `MAILSLURP_INBOX_ID` | `null` | Inbox ID for MailSlurp service. Use to avoid creating many MailSlurp inboxes.
 `FORM_NAME` | `null` | Your name. [Required]
 `FORM_PHONE` | `null` | Your phone number. [Required]
 `FORM_NOTE` | `null` | Your note for the Amt on your booking.
 `FORM_TAKE_SURVEY` | `"false"` | If you want to take the Amt's survey.
 `APPOINTMENT_SERVICE` | `"Anmeldung einer Wohnung"` | Name of the appointment type.
 `APPOINTMENT_LOCATIONS` | `null` | Comma separated location names for appointment.
 `APPOINTMENT_EARLIEST_DATE` | `"1970-01-01 GMT"` | Earliest date for appointment.
 `APPOINTMENT_LATEST_DATE` | `"2069-12-31 GMT"` | Latest date for appointment.
 `APPOINTMENT_EARLIEST_TIME` | `"00:00 GMT"` | Earliest time for appointment.
 `APPOINTMENT_LATEST_TIME` | `"23:59 GMT"` | Latest time for appointment.
| `DELAY_EACH_RETRY_IN_SEC` | `"60"` | Delay between retries in seconds.
| `RETRIES` | `"10"` | Number of retries before giving up.
| `TIMEOUT_IN_SEC` | `"60"` | Timeout for page load in seconds.

## Environment Variables

Variable | Default | Description
---------|----------|---------
`LOGLEVEL` | "info" | Set to "debug" to get stdout.
`CONCURRENCY` | "16" | Max number of concurrent Pages.
`PROXY_URL` | `undefined` | Hide your IP with a back-connect proxy.

## Debugging

```bash
MAILSLURP_API_KEY=*your-api-key* FORM_NAME=*your-name* FORM_PHONE=*your-phone-number* \
    npm run debug
```

## Output

[playwright-report](./playwright-report) will contain one or two .html files that are the body of the emails received during the booking process. There will also be an .ics file to add to your calendar. Check your MailSlurp email inbox for the appointment confirmations.

```bash
npx playwright show-report
```

## Known Issues

- We can be blocked by a Captcha in some cases.

## Contributing

If you're planning to contribute to the project, install dev dependencies and use `eslint` and `prettier` for linting and formatting, respectively.

```bash
npm i --include=dev
npx eslint --fix tests/ src/ playwright.config.js
npx prettier -w tests/ src/ playwright.config.js
```
