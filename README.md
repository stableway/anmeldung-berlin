# anmeldung-berlin

This app will find and book an Anmeldung appointment automatically for you in Berlin.

## Quickstart

### Configuration

```bash
vi config.json
```

Variable | Default | Description
---------|----------|---------
 `debug` | `false` | Run a headful browser
 `name` | `"Max Mustermann"` | Your full name
 `email` | `"max.mustermann@domain.com"` | Your email
 `phone` | `"0176 55555555"` | Your phone number
 `takeSurvey` | `true` | Whether or not to take the Amt's survey
 `note` | `""` | An optional note to include with your booking
 `service` | `"Anmeldung einer Wohnung"` | The name of the appointment service from [./constants.json](./constants.json)
 `allLocations` | `true` | Include all service locations*
 `locations` | `["Bürgeramt Rathaus Neukölln", "Bürgeramt Rathaus Neukölln - Vorzugsterminen"]` | Specific service locations to search from [./constants.json](./constants.json)
 `earliestDate` | `"1970-01-01 GMT"` | Book an appointment no earlier than this date
 `latestDate` | `"2069-01-01 GMT"` | Book an appointment no later than this date
 `earliestTime` | `"05:00 GMT"` | Book an appointment no earlier than this time
 `latestTime` | `"18:00 GMT"` | Book an appointment no later than this time
 `concurrency` | `3` | How many Chromium pages to run at the same time
 `waitSeconds` | `120` | How long to wait between booking attempts
 `coolOffSeconds` | `600` | How long to wait if blocked for too many attempts

*`allLocations` will override `locations`

### With Docker (recommended)

```bash
# Build
docker build -t anmeldung-berlin .
# Get an appointment
docker run \
    -v $(pwd)/output:/home/myuser/output \
    anmeldung-berlin
```

### Local on Mac OS

```bash
# Install
npm i
# Get an appointment
NODE_OPTIONS="--max_old_space_size=30000 --max-http-header-size=80000" \
    npm start
```

## Output

The [./output](./output) directory will save a picture of the appointment confirmation page and a JSON file with appointment info. Check your `email` inbox (and spam folder) for the appointment confirmation.

## Known Issues

- No verification is made of successful booking. If you click submit, you'll get a 'Success!!!' but double check the booking in the case of bad form inputs.
- There is a Captcha service that can be triggered, which is not handled.

## Other Services' Appointments

Two services are available (Anmeldung and Change of Passport for EU Blue Card), and this project can be easily extended to include other services' appointments by adding service names and numbers to [./constants.json](./constants.json).

## Contributing

If you're planning to contribute to the project, install dev dependencies and use `eslint` and `prettier` for linting and formatting, respectively.

```bash
npm i --include=dev
npx eslint --fix index.js # caution: this will modify index.js in place
npx prettier -w index.js # caution: this will modify index.js in place
```
