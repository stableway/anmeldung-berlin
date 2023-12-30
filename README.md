# anmeldung-berlin

This app will find and book an Anmeldung appointment automatically for you in Berlin.

## Run the Bot: Step-By-Step

### 1. Get a MailSlurp API Key

Get a [MailSlurp API key here](https://app.mailslurp.com/sign-up/). Set your API key to value of the environment variable `MAILSLURP_API_KEY`.

```bash
export MAILSLURP_API_KEYU=*your-api-key*
```

### 2. Configuration

```bash
vi config.json
```

Variable | Default | Description
---------|----------|---------
 `name` | `"Max Mustermann"` | Your full name
 `email` | `"max.mustermann@domain.com"` | Your email
 `phone` | `"0176 55555555"` | Your phone number
 `takeSurvey` | `true` | Whether or not to take the Amt's survey
 `note` | `""` | An optional note to include with your booking
 `service` | `"Anmeldung einer Wohnung"` | The name of the appointment service from this list ([valid service names can be found here](https://service.berlin.de/dienstleistungen/))
 `allLocations` | `true` | Include all service locations*
 `locations` | `["Bürgeramt Rathaus Neukölln", "Bürgeramt Rathaus Neukölln - Vorzugsterminen"]` | Specific service locations to search ([valid service locations for the service "Anmeldung einer Wohnung" can be found here](https://service.berlin.de/dienstleistung/120686/))
 `earliestDate` | `"1970-01-01 GMT"` | Book an appointment no earlier than this date
 `latestDate` | `"2069-01-01 GMT"` | Book an appointment no later than this date
 `earliestTime` | `"05:00 GMT"` | Book an appointment no earlier than this time
 `latestTime` | `"18:00 GMT"` | Book an appointment no later than this time
 `concurrency` | `3` | How many Chromium pages to run at the same time
 `waitSeconds` | `120` | How long to wait between booking attempts
 `coolOffSeconds` | `600` | How long to wait if blocked for too many attempts

*`allLocations` will override `locations`

### 3. Update Stealth Evasions

```bash
npx extract-stealth-evasions
```

### 4a. Run with Docker (recommended)

Build & run Docker container.

```bash
# Build
docker build -t anmeldung-berlin .
# Get an appointment
docker run -it \
    -v $(pwd)/output:/home/pwuser/output \
    -e MAILSLURP_API_KEY=*your-api-key* \
    anmeldung-berlin
```

### 4b. Run locally on Mac OS

Run the program from the command line.

```bash
# Install dependencies
npm i
# Install browsers
npx playwright install
# Get an appointment
NODE_OPTIONS="--max_old_space_size=4000 --max-http-header-size=80000" \
    npm start
```

## Debugging

```bash
npm run debug
```

## Output

The [./output](./output) directory will save one or two .html files that are the body of the emails received during the booking process. There will also be an .ics file to add to your calendar. Check your MailSlurp email inbox for the appointment confirmations.

## Known Issues

- No verification is made of successful booking. If you click submit, you'll get a 'Success!!!' but double check the booking in the case of bad form inputs.
- There is a Captcha service that can be triggered, which is not handled.

## Other Services' Appointments

This app works for any [service.berlin.de](https://service.berlin.de) appointment that can be booked online!

## Contributing

If you're planning to contribute to the project, install dev dependencies and use `eslint` and `prettier` for linting and formatting, respectively.

```bash
npm i --include=dev
npx eslint --fix tests/
npx prettier -w tests
```
