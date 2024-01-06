# anmeldung-berlin

This app will find and book any [service.berlin.de](https://service.berlin.de) appointment that can be booked online.

## Quickstart

### 1. Get a MailSlurp API Key

Get a [MailSlurp API key here](https://app.mailslurp.com/sign-up/).

### 2. Update Stealth Evasions

```bash
npx extract-stealth-evasions
```

### 3a. Run with Docker (recommended)

Build & run Docker container.

```bash
# Build
docker build -t anmeldung-berlin .
# Get an appointment
docker run \
    -v $(pwd)/playwright-report:/home/pwuser/playwright-report \
    -v $(pwd)/test-results:/home/pwuser/test-results \
    -e MAILSLURP_API_KEY=*your-api-key* \
    -e FORM_NAME=*your-name* \
    -e FORM_PHONE=*your-phone-number* \
    anmeldung-berlin
```

### 3b. Run Locally on Mac OS

Run the program from the command line.

```bash
# Install dependencies
npm i
# Install browsers
npx playwright install chromium
# Get an appointment
MAILSLURP_API_KEY=*your-api-key* FORM_NAME=*your-name* FORM_PHONE=*your-phone-number* \
    npm start
```

## Deployment

Set [playwright.config.js](/playwright.config.js) `retries` to a high number, if you want to run the app locally until a successful booking is made. You may very well be blocked for exceeding a rate limit. In this case, try setting `PROXY_URL` to a back-connect proxy URL.

## Parameters

The app is parameterized via environment variables, which have default values (sometimes `null`) per Playwright Test instance.

```bash
vi .env
```

For [making an appointmen](/tests/appointment.test.js), the parameters are:

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

- We don't verify the final booking page. Always check your emails and Playwright report for errors.
- We can be blocked by a Captcha in some cases.

## Contributing

If you're planning to contribute to the project, install dev dependencies and use `eslint` and `prettier` for linting and formatting, respectively.

```bash
npm i --include=dev
npx eslint --fix tests/
npx prettier -w tests/
```
