# anmeldung-berlin

This app will find and book an Anmeldung appointment automatically for you in Berlin.

## Quickstart

### Configuration

```bash
vi config.json
```

Variable | Default | Required
---------|----------|---------
 `debug` | `false` | `false`
 `name` | `"Max Mustermann"` | `true`
 `email` | `"max.mustermann@domain.com"` | `true`
 `phone` | `"0176 55555555"` | `true`
 `takeSurvey` | `true` | `false`
 `note` | `""` | `false`
 `allLocations` | `true` | `false`*
 `locations` | `["Bürgeramt Rathaus Neukölln", "Bürgeramt Rathaus Neukölln - Vorzugsterminen"]` | `false`**
 `earliestDate` | `"1970-01-01 GMT"` | `true`
 `latestDate` | `"2069-01-01 GMT"` | `true`
 `earliestTime` | `"08:00 GMT"` | `true`
 `latestTime` | `"18:00 GMT"` | `true`
 `concurrency` | `3` | `false`
 `waitSeconds` | `120` | `false`

*Either `allLocations` or `locations` must be defined.

**A list of allowed `locations` is available in [./constants.json](./constants.json)

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

## Contributing

If you're planning to contribute to the project, install dev dependencies and use `eslint` and `prettier` for linting and formatting, respectively.

```bash
npm i --include=dev
eslint --fix index.js # caution: this will modify index.js in place
prettier -w index.js # caution: this will modify index.js in place
```
