const fs = require('fs');
const puppeteer = require('puppeteer');
const bluebird = require('bluebird');
const {locations, entryUrl} = require('./constants.json');
const config = require('./config.json');

(async() => {
    console.log('---- Get an Anmeldung Termin ------');
    console.log('Starting: ' + new Date(Date.now()).toUTCString());
    console.log('Config file:', JSON.stringify(config, null, 2))
    while (true) {
        let hasBooked = await bookTermin();
        if (hasBooked) {
            console.log('Booking successful!');
            break;
        }
        console.log('Booking did not succeed.')
        console.log('Waiting 2 minutes until next attempt ...');
        await sleep(2 * 60 * 1000);
    }
    console.log('Ending: ' + new Date(Date.now()).toUTCString());
})();

async function bookTermin() {
    const startTime = new Date(Date.now()).toUTCString();
    let browser, page;
    try {
        console.log('Launching the browser ...');
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ? process.env.PUPPETEER_EXECUTABLE_PATH : undefined,
            headless: !config.debug,
            defaultViewport: undefined,
            slowMo: config.debug ? 1500 : undefined,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        page = await browser.newPage();
        await applyStealth(page);
    } catch (e) {
        console.log(e);
    }

    try {
        // Create calendar URL
        let calendarUrl = entryUrl
        if (config.allLocations === true) {
            for (let location in locations) {
                calendarUrl = calendarUrl + locations[location] + ',';
            }
        } else {
            for (let location in config.locations) {
                calendarUrl = calendarUrl + locations[location] + ',';
            }
        }
        calendarUrl = calendarUrl.slice(0, calendarUrl.length - 1);
        console.log('Going to calendar of appointment dates');

        await page.goto(calendarUrl, {waitUntil: 'domcontentloaded'});
        await page.waitForSelector('div.span7.column-content');
        const dateLinks = await getAllDateLinks(page);
        console.log('Got date links:', JSON.stringify(dateLinks, null, 2));
        if (dateLinks.length === 0) return false;
        page.close();

        const timeslotLinks = [].concat.apply([], await bluebird.any(dateLinks.map(async url => {
            return await withPage(browser)(async (page) => {
                try {
                    console.log('Navigating to appointment booking for date ...');
                    await page.goto(url, {waitUntil: 'domcontentloaded'});
                } catch(e) {
                    console.log('Navigation failed.');
                }
                try {
                    console.log('Waiting for available timeslots ...');
                    await page.waitForSelector('tr > td.frei');
                } catch(e) {
                    console.log('No more available timeslots for date :(');
                }
                try {
                    return await getTimeslotLinks(page);
                } catch {
                    return [];
                }
            });
        })), {concurrency: 3});
        console.log('Got timeslot links:', JSON.stringify(timeslotLinks, null, 2));
        if (timeslotLinks.length === 0) return false;

        while (true) {
            let [bookingPage, bookingUrl, foundTimeslot] = await bluebird.any(timeslotLinks.map(async url => {
                return await withPage(browser)(async (page) => {
                    console.log('Navigating to timeslot:',  url);
                    try {
                        await page.goto(url, {waitUntil: 'domcontentloaded'});
                    } catch(e) {
                        console.log('Navigation failed.');
                    }
                    console.log('Waiting for form to render ...');
                    await Promise.all([
                        page.waitForSelector('input#familyName'),
                        page.waitForSelector('input#email'),
                        page.waitForSelector('select[name="surveyAccepted"]'),
                        page.waitForSelector('input#agbgelesen'),
                        page.waitForSelector('button#register_submit.btn'),
                    ]);
                    return [page, url, true]
                });
            }), {concurrency: 3}).catch(() => {
                console.log('No more timeslot links are rendering forms.');
                return [undefined, undefined, false];
            })
            if (foundTimeslot === false) return false;
    
            try {
                console.log('Filling out form with config data ...');
                await Promise.all([
                    bookingPage.$eval('input#familyName', (el, config) => el.value = config.name, config),
                    bookingPage.$eval('input#email', (el, config) => el.value = config.email, config),
                    bookingPage.select('select[name="surveyAccepted"]', config.takeSurvey ? '1' : '0'),
                    bookingPage.$eval('input#agbgelesen', el => el.checked = true),
                ]);
    
                console.log('Submitting form ...');
                await Promise.all([
                    bookingPage.waitForNavigation(),
                    bookingPage.click('button#register_submit.btn'),
                ]);
    
                try {
                    console.log('Waiting 10 seconds for booking result to render ...');
                    await bookingPage.waitForTimeout(10000);
    
                    console.log('Saving booking info to files ...');
                    await Promise.allSettled([
                        fs.writeFile(`./output/booking-${startTime}.json`, JSON.stringify({ bookedAt: startTime }, null, 2), (err) => {
                            if (err) throw err;
                            console.log('The booking has been saved!');
                        }),
                        bookingPage.screenshot({ path: `./output/booking-${startTime}.png`, fullbookingPage: true }),
                    ]);
                } catch (e) {
                    console.log(e);
                    console.log('Error thrown during booking confirmation. Exiting. Check your config.email address for booking info.')
                }
    
                console.log('Success!!!');
                return true;
            } catch (e) {
                console.log(`Booking timeslot link ${bookingUrl} failed, trying the next one now.`);
                console.log(e.message);
            }
        }
    } catch (e) {
        console.log(e);
        return false;
    } finally {
        await browser.close();
    }
}

const withPage = (browser) => async (fn) => {
	const page = await browser.newPage();
    await applyStealth(page);
	try {
		return await fn(page);
	} catch {
		await page.close();
	}
}

const applyStealth = (page) =>
    page.addScriptTag({url: 'https://raw.githack.com/berstend/puppeteer-extra/stealth-js/stealth.min.js'})

async function getAllDateLinks(page) {
    console.log('Getting time booking URLs for each available appointment date');
    let links = await getDateLinks(page);
    await Promise.all([
        page.waitForNavigation(),
        page.click('th.next'),
    ]);
    return await links.concat(await getDateLinks(page));
}

async function getDateLinks(page) {
    return await page.$$eval('td.buchbar > a', els => els.map(el => el.href));
}

async function getTimeslotLinks(page) {
    return await page.$$eval('td.frei > a', els => els.map(el => el.href));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
