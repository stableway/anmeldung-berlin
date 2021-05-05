const fs = require('fs');
const puppeteer = require('puppeteer');
const config = {
    'debug': true,
    'minTimestamp': 1609801200,// Use Berlin time-zone here
    'maxTimestamp': 1612479600,// Use Berlin time-zone here
    'name': 'ADD YOUR FULL NAME HERE',
    'email': 'ADD YOUR EMAIL HERE',
    'moreDetails': '',// ADD FURTHER DETAILS HERE (OPTIONAL)
    'takeScreenshot': true,
    'screenshotFile1': 'screenshot1.png',
    'screenshotFile2': 'screenshot2.png',
    'logFile': 'logFile.txt'
};

const staticConfig = {
    'entryUrl': 'https://service.berlin.de/terminvereinbarung/termin/tag.php?termin=1&anliegen[]=120686&dienstleisterlist=122210,122217,327316,122219,327312,122227,327314,122231,327346,122243,327348,122252,329742,122260,329745,122262,329748,122254,329751,122271,327278,122273,327274,122277,327276,122280,327294,122282,327290,122284,327292,327539,122291,327270,122285,327266,122286,327264,122296,327268,150230,329760,122301,327282,122297,327286,122294,327284,122312,329763,122304,327330,122311,327334,122309,327332,122281,327352,122279,329772,122276,327324,122274,327326,122267,329766,122246,327318,122251,327320,122257,327322,122208,327298,122226,327300',
};

(async() => {
    if(shouldBook()){
        console.log('----');
        console.log('Starting: ' + new Date(Date.now()).toTimeString());
        bookTermin();
    }
})();

function shouldBook() {
    if(!fs.existsSync(config.logFile)){
        return true;
    } else {
        return false;
    }
}

async function saveTerminBooked() {
    await fs.writeFileSync(config.logFile, JSON.stringify({ 'booked': Date.now() }), 'utf8');
}

async function bookTermin() {
    const browser = await puppeteer.launch({
  		headless: !config.debug,
        defaultViewport: null,
        // Uncomment the lines below if you are using a Raspberry to run the script
        //product: 'chrome',
        //executablePath: '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
  	});
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if(req.resourceType() === 'image' || req.resourceType() === 'stylesheet' || req.resourceType() === 'font'){
            req.abort();
        } else {
            req.continue();
        }
    });

    let success = false;

    try{
        await page.goto(staticConfig.entryUrl);

        await page.waitForSelector('div.span7.column-content', { timeout: 120000 });

        // Check if there are Termins available
        let available = (await page.$$('td.buchbar')).length;
        console.log('Available Termins: ' + available);

        // If there are bookable Termins
        if(available > 0){
            let dates = await page.$$('td.buchbar');
            for(let i=0;i<available;i++){
                let link = await dates[i].$eval('a', el => el.getAttribute('href'));
                console.log('Link ' + i + ': ' + link);
                // Checking if Termins are within desirable range
                let regex = /\d+/g;
                let matches = link.match(regex);
                if(matches.length > 0 && Number(matches[0]) > config.minTimestamp && Number(matches[0]) < config.maxTimestamp){
                    console.log('Trying to book ' + matches[0]);
                    await page.click('a[href*="' + link + '"]');
                    console.log('Booking step 1');

                    await page.waitForSelector('tr > td.frei', { timeout: 120000 });
                    const termins = await page.$$('tr > td.frei');
                    await termins[0].click();
                    console.log('Booking step 2');

                    // Fill out custom information
                    await page.waitForSelector('input[id="familyName"]', { timeout: 120000 });
                    await page.type('input[id="familyName"]', config.name);
                    await page.type('input[id="email"]', config.email);
                    await page.type('textarea[name="amendment"]', config.moreDetails);
                    console.log('Booking step 3');

                    // Fill out standard information
                    await page.select('select[name="surveyAccepted"]', '1')
                    await page.click('input[id="agbgelesen"]');
                    console.log('Booking step 4');

                    // Screenshot
                    if(config.takeScreenshot)
                        await page.screenshot({ path: config.screenshotFile1, fullPage: true });

                    // Book
                    await page.click('button[id="register_submit"]');
                    console.log('Booking step 5');
                    await page.waitForSelector('img.logo', { timeout: 120000 });
                    saveTerminBooked();

                    // Screenshot
                    if(config.takeScreenshot)
                        await page.screenshot({ path: config.screenshotFile2, fullPage: true });

                    break;
                }
            }
        }
        success = true;
    } catch (err) {
        console.log(err);
    }
    browser.close();
    return success;
}
