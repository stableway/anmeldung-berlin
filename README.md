# anmeldung-berlin

This app will find and book an Anmeldung appointment automatically for you in Berlin.

## Quickstart

### 1. Get a MailSlurp API Key

Get a [MailSlurp API key here](https://app.mailslurp.com/sign-up/). Set your API key to value of the environment variable `MAILSLURP_API_KEY`.

```bash
export MAILSLURP_API_KEY=*your-api-key*
```

Check .env file for more configuration options.

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
docker run -it \
    -v $(pwd)/output:/home/pwuser/output \
    --env-file ./.env \
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
npm start
```

## Environment Variables

```bash
vi .env
```

Variable | Default | Description
---------|----------|---------
 `MAILSLURP_API_KEY` | `""` | API key for MailSlurp service. [Required]
 `MAILSLURP_INBOX_ID` | `""` | Inbox ID for MailSlurp service. Use to avoid creating many MailSlurp inboxes.
 `FORM_NAME` | `"Max Mustermann"` | Your name. [Change]
 `FORM_PHONE` | `"0176 55555555"` | Your phone number. [Change]
 `FORM_NOTE` | `""` | Your note for the Amt on your booking. [Change]
 `FORM_TAKE_SURVEY` | `"false"` | If you want to take the Amt's survey. [Change]
 `APPT_SERVICE` | `"Anmeldung einer Wohnung"` | Service name for appointment. [Change]
 `APPT_LOCATIONS` | `""` | Comma separated location names for appointment. [Change]
 `APPT_EARLIEST_DATE` | `"1970-01-01 GMT"` | Earliest date for appointment (include timezone, for example: 2024-01-23 GMT). [Change]
 `APPT_LATEST_DATE` | `"2069-01-01 GMT"` | Latest date for appointment (include timezone, for example: 2024-01-29 GMT). [Change]
 `APPT_EARLIEST_TIME` | `"05:00 GMT"` | Earliest time for appointment (include timezone, for example: 5:00 GMT). [Change]
 `APPT_LATEST_TIME` | `"18:00 GMT"` | Latest time for appointment (include timezone, for example: 17:00 GMT). [Change]
 `CONCURRENCY` | `"3"` | Concurrency level for the application.
 `LOG_LEVEL` | `"info"` | Log level for the application.
 `PROXY_URL` | `""` | Proxy URL for the application.
 `RETRY_WAIT_SECONDS` | `"60"` | Wait time in seconds for retrying requests.
 `RETRY_WAIT_SECONDS_BLOCKED` | `"600"` | Wait time in seconds for retrying when rate limit is exceeded.

## Debugging

```bash
npm run debug
```

## Output

The [./output](./output) directory will save one or two .html files that are the body of the emails received during the booking process. There will also be an .ics file to add to your calendar. Check your MailSlurp email inbox for the appointment confirmations.

## Known Issues

- No verification is made of successful booking. Always check your emails and output files for errors.
- A Captcha can be presented, which is not handled.

## Other Services' Appointments

This app works for any [service.berlin.de](https://service.berlin.de) appointment that can be booked online!

## Contributing

If you're planning to contribute to the project, install dev dependencies and use `eslint` and `prettier` for linting and formatting, respectively.

```bash
npm i --include=dev
npx eslint --fix tests/
npx prettier -w tests/
```
