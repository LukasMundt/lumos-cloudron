#!/usr/bin/env node

/* jslint node:true */
/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global xit */

'use strict';

require('chromedriver');

const execSync = require('child_process').execSync,
    expect = require('expect.js'),
    fs = require('fs'),
    path = require('path'),
    superagent = require('superagent'),
    util = require('util'),
    { Builder, By, until } = require('selenium-webdriver'),
    { Options } = require('selenium-webdriver/chrome');

if (!process.env.USERNAME || !process.env.PASSWORD) {
    console.log('USERNAME and PASSWORD env vars need to be set');
    process.exit(1);
}

describe('Application life cycle test', function () {
    this.timeout(0);

    let browser, app, apiEndpoint;
    const LOCATION = 'test';
    const TEST_TIMEOUT = 50000;

    before(function () {
        browser = new Builder().forBrowser('chrome').setChromeOptions(new Options().windowSize({ width: 1280, height: 1024 })).build();
    });

    after(function () {
        browser.quit();
    });

    async function waitForElement(elem) {
        await browser.wait(until.elementLocated(elem), TEST_TIMEOUT);
        await browser.wait(until.elementIsVisible(browser.findElement(elem)), TEST_TIMEOUT);
    }

    function getAppInfo() {
        const inspect = JSON.parse(execSync('cloudron inspect'));
        apiEndpoint = inspect.apiEndpoint;

        app = inspect.apps.filter(function (a) { return a.location === LOCATION; })[0];
        expect(app).to.be.an('object');
    }

    async function welcomePage() {
        await browser.get('https://' + app.fqdn);
        await waitForElement(By.xpath('//*[contains(text(), "Cloudron LAMP App")]'));
    }

    async function uploadedFileExists() {
        await browser.get('https://' + app.fqdn + '/test.php');
        await waitForElement(By.xpath('//*[text()="this works"]'));
        await waitForElement(By.xpath('//*[text()="' + app.fqdn + '"]'));
    }

    async function checkIonCube() {
        await browser.get('https://' + app.fqdn + '/test.php');
        await waitForElement(By.xpath('//a[contains(text(), "ionCube Loader")]'));
        // return waitForElement(By.xpath('//*[contains(text(), "Intrusion&nbsp;Protection&nsbp;from&nbsp;ioncube24.com")]'));
    }

    async function checkPhpMyAdmin() {
        execSync(`cloudron pull --app ${app.id} /app/data/phpmyadmin_login.txt /tmp/phpmyadmin_login.txt`);
        // know your file structure !
        const PHPMYADMIN_PASSWORD = fs.readFileSync('/tmp/phpmyadmin_login.txt', 'utf8').split('\n')[6].split(':')[1].trim();
        fs.unlinkSync('/tmp/phpmyadmin_login.txt');

        const result = await superagent.get('https://' + app.fqdn + '/phpmyadmin').ok(() => true);
        if (result.status !== 401) throw new Error('Expecting 401 error');

        const result2 = await superagent.get('https://' + app.fqdn + '/phpmyadmin')
            .auth('admin', PHPMYADMIN_PASSWORD)
            .ok(() => true);

        if (result2.text.indexOf(`${app.fqdn} / mysql | phpMyAdmin`) === -1) { // in the <title>
            console.log(result2.text);
            throw new Error('could not detect phpmyadmin');
        }
    }

    async function changePhp(version) {
        fs.writeFileSync('/tmp/PHP_VERSION', `PHP_VERSION=${version}\n`, 'utf8');
        execSync(`cloudron push --app ${app.id} /tmp/PHP_VERSION /app/data/PHP_VERSION`);
        execSync(`cloudron restart --app ${app.id}`);
    }

    async function checkPhpVersion(version) {
        await browser.get('https://' + app.fqdn + '/test.php');
        await waitForElement(By.xpath(`//*[contains(text(), "PHP Version:${version}")]`));
    }

    xit('build app', function () {
        execSync('cloudron build', { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('install app', function () {
        execSync(`cloudron install --location ${LOCATION}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('can get app information', getAppInfo);
    it('can view welcome page', welcomePage);
    it('can upload file with sftp', function () {
        // remove from known hosts in case this test was run on other apps with the same domain already
        // if the tests fail here you want below in ~/.ssh/config
        // Host my.cloudron.xyz
        //     StrictHostKeyChecking no
        //     HashKnownHosts no
        execSync(util.format('sed -i \'/%s/d\' -i ~/.ssh/known_hosts', app.fqdn));
        const sftpCommand = `sshpass -p${process.env.PASSWORD} sftp -P 222 -o StrictHostKeyChecking=no -oHostKeyAlgorithms=+ssh-rsa -oBatchMode=no -b - ${process.env.USERNAME}@${app.fqdn}@${apiEndpoint}`;
        console.log('If this test fails, see the comment above this log message. Run -- ', sftpCommand);
        execSync(sftpCommand, { input: 'cd public\nput test.php\nbye\n', encoding: 'utf8', cwd: __dirname });
    });
    it('can get uploaded file', uploadedFileExists);
    it('can access ioncube', checkIonCube);
    it('can access phpmyadmin', checkPhpMyAdmin);
    it('can change PHP version', changePhp.bind(null, '8.1')); // default

    it('can restart app', () => execSync('cloudron restart'));
    it('can get uploaded file', uploadedFileExists);
    it('can access ioncube', checkIonCube);
    it('can access phpmyadmin', checkPhpMyAdmin);

    it('can change PHP version', changePhp.bind(null, '8.2'));
    it('can restart app', () => execSync('cloudron restart'));
    it('can check PHP version', checkPhpVersion.bind(null, '8.2'));

    it('backup app', function () {
        execSync(`cloudron backup create --app ${app.id}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('restore app', function () {
        const backups = JSON.parse(execSync('cloudron backup list --raw'));
        execSync('cloudron uninstall --app ' + app.id, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
        execSync('cloudron install --location ' + LOCATION, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
        var inspect = JSON.parse(execSync('cloudron inspect'));
        app = inspect.apps.filter(function (a) { return a.location === LOCATION; })[0];
        execSync(`cloudron restore --backup ${backups[0].id} --app ${app.id}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    it('can get uploaded file', uploadedFileExists);
    it('can check PHP version', checkPhpVersion.bind(null, '8.2'));

    it('move to different location', function () {
        browser.manage().deleteAllCookies();
        execSync(`cloudron configure --location ${LOCATION}2 --app ${app.id}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
        var inspect = JSON.parse(execSync('cloudron inspect'));
        app = inspect.apps.filter(function (a) { return a.location === LOCATION + '2'; })[0];
        expect(app).to.be.an('object');
    });

    it('can get uploaded file', uploadedFileExists);
    it('can access phpmyadmin', checkPhpMyAdmin);
    it('can check PHP version', checkPhpVersion.bind(null, '8.2'));

    it('uninstall app', function () {
        execSync(`cloudron uninstall --app ${app.id}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });

    // test update
    it('can install app for update', function () {
        execSync(`cloudron install --appstore-id ${app.manifest.id} --location ${LOCATION}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
        const inspect = JSON.parse(execSync('cloudron inspect'));
        app = inspect.apps.filter(function (a) { return a.location === LOCATION; })[0];
        expect(app).to.be.an('object');
    });

    it('can get app information', getAppInfo);
    it('can view welcome page', welcomePage);
    it('can upload file with sftp', function () {
        // remove from known hosts in case this test was run on other apps with the same domain already
        // if the tests fail here you want to set "HashKnownHosts no" in ~/.ssh/config
        const sftpCommand = `sshpass -p${process.env.PASSWORD} sftp -P 222 -o StrictHostKeyChecking=no -oHostKeyAlgorithms=+ssh-rsa -oBatchMode=no -b - ${process.env.USERNAME}@${app.fqdn}@${apiEndpoint}`;
        console.log('If this test fails, see the comment above this log message. Run -- ', sftpCommand);
        execSync(sftpCommand, { input: 'cd public\nput test.php\nbye\n', encoding: 'utf8', cwd: __dirname });
    });

    it('can update', function () {
        execSync(`cloudron update --app ${LOCATION}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });
    it('can get uploaded file', uploadedFileExists);
    it('can access phpmyadmin', checkPhpMyAdmin);
    it('can access ioncube', checkIonCube);
    it('can check PHP version', checkPhpVersion.bind(null, '8.1'));

    it('uninstall app', function () {
        execSync(`cloudron uninstall --app ${app.id}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    });
});
