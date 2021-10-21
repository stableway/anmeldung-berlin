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
 `name` | `"Your Full Name"` | `true`
 `email` | `"your.username@domain.com"` | `true`
 `takeSurvey` | `true` | `false`
 `allLocations` | `true` | `false`*
 `locations` | `["Bürgeramt Rathaus Neukölln", "Bürgeramt Rathaus Neukölln - Vorzugsterminen]` | `false`*

*Either `allLocations` or `locations` must be defined.

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

You must have the Google Chrome App installed. `$PUPPETEER_EXECUTABLE_PATH` is the Google Chrome executable path on your computer.

```bash
# Install
npm i
# Get an appointment
NODE_OPTIONS="--max_old_space_size=30000 --max-http-header-size=80000" \
    npm start
```

## Output

The `./output` directory will save a picture of the appointment confirmation page and a JSON file with appointment info. Check your `email` inbox (and spam folder) for the appointment confirmation.
