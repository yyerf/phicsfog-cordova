'use strict';

/* Release-oriented source integrity checks for the offline Cordova app. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const APP_CONFIG = require(path.join(WWW, 'js', 'app-config.js'));
const CORE = require(path.join(WWW, 'js', 'app-core.js'));
const PKG = require(path.join(ROOT, 'package.json'));
const LOCK = require(path.join(ROOT, 'package-lock.json'));
const configXml = fs.readFileSync(path.join(ROOT, 'config.xml'), 'utf8');
const htmlFiles = fs.readdirSync(WWW).filter((file) => file.endsWith('.html')).sort();

const errors = [];
const warnings = [];
function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }

function attr(tag, name, source) {
    const match = source.match(new RegExp('<' + tag + '[^>]*\\b' + name + '="([^"]*)"'));
    return match ? match[1] : null;
}

function preference(name) {
    const match = configXml.match(new RegExp('<preference\\s+name="' + name + '"[^>]*>'));
    return match ? attr('preference', 'value', match[0]) : null;
}

function duplicateValues(values) {
    const seen = new Set();
    const duplicates = new Set();
    values.forEach((value) => {
        if (seen.has(value)) { duplicates.add(value); }
        seen.add(value);
    });
    return [...duplicates];
}

function localAsset(page, reference) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) { return; }
    if (reference === 'cordova.js') { return; }
    const clean = reference.split(/[?#]/)[0].replace(/^\//, '');
    if (!fs.existsSync(path.join(WWW, clean))) { fail(page + ': missing local asset ' + reference); }
}

// Identity and version synchronization.
const validation = CORE.validateAppConfig(APP_CONFIG);
if (!validation.valid) { fail('app-config validation failed: ' + validation.errors.join(', ')); }
if (APP_CONFIG.appId !== 'com.knpn.phicsfog' || attr('widget', 'id', configXml) !== APP_CONFIG.appId) {
    fail('application ID is not synchronized');
}
if (APP_CONFIG.name !== 'PH ICS FOG' || PKG.displayName !== APP_CONFIG.name) { fail('application name is not synchronized'); }
if (!/<name>PH ICS FOG<\/name>/.test(configXml)) { fail('config.xml app name is not PH ICS FOG'); }
if (APP_CONFIG.versionName !== '8.2.2' || PKG.version !== APP_CONFIG.versionName ||
        attr('widget', 'version', configXml) !== APP_CONFIG.versionName) {
    fail('versionName is not synchronized at 8.2.2');
}
if (APP_CONFIG.versionCode !== 80202 || attr('widget', 'android-versionCode', configXml) !== '80202') {
    fail('versionCode is not synchronized at 80202');
}
if (APP_CONFIG.expiresAt !== '2027-12-31T23:59:59+08:00') { fail('expiry timestamp changed unexpectedly'); }
if (preference('android-minSdkVersion') !== '24' || APP_CONFIG.minSdk !== 24) { fail('minimum SDK must be 24'); }
if (preference('android-targetSdkVersion') !== '36' || preference('android-compileSdkVersion') !== '36' ||
        APP_CONFIG.targetSdk !== 36) { fail('compile/target SDK must be 36'); }
if (preference('GradleVersion') !== '8.14.2') { fail('Gradle must be 8.14.2'); }
if (preference('AndroidLaunchMode') !== 'singleTask') { fail('Android launch mode must be singleTask'); }
if (preference('AndroidEdgeToEdge') !== 'false') { fail('Cordova native inset handling must be explicit'); }
if (!new RegExp('Ver\\.' + APP_CONFIG.versionName.replace(/\./g, '\\.')).test(
    fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
)) { fail('displayed version is not synchronized'); }

// Reproducible package/toolchain metadata.
const pinned = { cordova: '13.0.0', 'cordova-android': '15.1.0', 'cordova-plugin-geolocation': '5.0.0' };
Object.entries(pinned).forEach(([name, version]) => {
    if (!PKG.devDependencies || PKG.devDependencies[name] !== version) { fail(name + ' must be pinned to ' + version); }
});
if (PKG.private !== true) { fail('npm package must be private'); }
if (PKG.license !== 'UNLICENSED') { fail('project license metadata must be UNLICENSED'); }
if (PKG.engines.node !== '>=22.9.0 <23') { fail('Node engine must stay on Node 22 LTS'); }
if (!PKG.overrides || PKG.overrides['cross-spawn'] !== '7.0.6') { fail('cross-spawn security override must stay at 7.0.6'); }
if (!LOCK.packages || !LOCK.packages[''] || LOCK.packages[''].version !== PKG.version) {
    fail('package-lock root metadata is out of sync');
}
const bundletoolBuild = fs.readFileSync(path.join(ROOT, 'scripts', 'bundletool', 'build.gradle'), 'utf8');
if (!/bundletool:1\.18\.3'/.test(bundletoolBuild)) { fail('AAB verifier bundletool must stay pinned at 1.18.3'); }

// WebView network policy and Android permissions.
if (/<access\b[^>]*origin="\*"/.test(configXml)) { fail('config.xml allow-lists arbitrary WebView network access'); }
if (/<allow-navigation\b[^>]*(?:https?:|\*)/.test(configXml)) { fail('config.xml permits remote WebView navigation'); }
const intents = [...configXml.matchAll(/<allow-intent\b[^>]*href="([^"]+)"/g)].map((match) => match[1]).sort();
const expectedIntents = [
    'https://drive.google.com/*',
    'https://play.google.com/store/apps/details?id=com.knpn.phicsfog',
    'https://yyerf.github.io/phicsfog-cordova/privacy-policy.html'
].sort();
if (JSON.stringify(intents) !== JSON.stringify(expectedIntents)) { fail('external intent allow-list is broader or narrower than approved destinations'); }
if (/ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE|REQUEST_INSTALL_PACKAGES/.test(configXml)) {
    fail('obsolete/background Android permission appears in config.xml');
}
if (!/<hook\b[^>]*type="after_prepare"[^>]*src="scripts\/remove-internet-permission\.js"/.test(configXml)) {
    fail('Cordova after_prepare hook must remove the unused INTERNET permission');
}
if (!/<hook\b[^>]*type="after_prepare"[^>]*src="scripts\/patch-geolocation-approximate\.js"/.test(configXml)) {
    fail('Cordova after_prepare hook must preserve Android approximate-location grants');
}
const permissionHook = fs.readFileSync(path.join(ROOT, 'scripts', 'remove-internet-permission.js'), 'utf8');
if (!permissionHook.includes('android\\.permission\\.INTERNET')) {
    fail('INTERNET-permission removal hook is missing its exact manifest target');
}
const approximateHook = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-geolocation-approximate.js'), 'utf8');
if (!approximateHook.includes('Build.VERSION_CODES.S') ||
        !approximateHook.includes('Manifest.permission.ACCESS_COARSE_LOCATION')) {
    fail('approximate-location hook is missing its guarded Android 12+ coarse-permission handling');
}

const approvedExternal = [
    /^https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+$/,
    /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.knpn\.phicsfog$/,
    /^https:\/\/yyerf\.github\.io\/phicsfog-cordova\/privacy-policy\.html$/
];
const allInputIds = [];

for (const file of htmlFiles) {
    const source = fs.readFileSync(path.join(WWW, file), 'utf8');
    if (/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(source)) { fail(file + ': inline script is forbidden'); }
    if (/<[^>]+\son[a-z]+\s*=/i.test(source)) { fail(file + ': inline event handler is forbidden'); }
    if (/javascript\s*:/i.test(source)) { fail(file + ': javascript: URL is forbidden by CSP'); }

    for (const match of source.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)) {
        if (/^(?:https?:|\/\/)/i.test(match[1])) { fail(file + ': remote script ' + match[1]); }
        else { localAsset(file, match[1]); }
    }
    for (const match of source.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)) {
        if (/^(?:https?:|\/\/)/i.test(match[1])) { fail(file + ': remote stylesheet ' + match[1]); }
        else { localAsset(file, match[1]); }
    }
    for (const match of source.matchAll(/<img\b([^>]*)>/gi)) {
        const attributes = match[1];
        const src = (attributes.match(/\bsrc="([^"]+)"/i) || [])[1];
        if (src) { localAsset(file, src); }
        if (!/\balt="[^"]+"/i.test(attributes)) { fail(file + ': image is missing meaningful alt text'); }
    }

    for (const match of source.matchAll(/data-page="([^"]+)"/g)) {
        if (!fs.existsSync(path.join(WWW, match[1] + '.html'))) { fail(file + ': missing navigation target ' + match[1]); }
    }
    for (const match of source.matchAll(/data-embed="([^"]+)"/g)) {
        if (!fs.existsSync(path.join(WWW, match[1] + '.html'))) { fail(file + ': missing embedded page ' + match[1]); }
    }

    const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    for (const match of source.matchAll(/<input\b[^>]*\bid="([^"]+)"/gi)) {
        allInputIds.push({ id: match[1], file: file });
    }
    duplicateValues(ids).forEach((id) => fail(file + ': duplicate id "' + id + '"'));
    const idSet = new Set(ids);
    for (const match of source.matchAll(/data-target="#([^"]+)"/g)) {
        if (!idSet.has(match[1])) { fail(file + ': data-target points to missing #' + match[1]); }
    }
    for (const match of source.matchAll(/<a\b[^>]*data-toggle="collapse"[^>]*href="#([^"]+)"/g)) {
        if (!idSet.has(match[1])) { fail(file + ': collapse link points to missing #' + match[1]); }
    }

    for (const match of source.matchAll(/<a\b[^>]*href="(https?:[^"]+)"/gi)) {
        if (!approvedExternal.some((pattern) => pattern.test(match[1]))) { fail(file + ': unapproved external URL ' + match[1]); }
    }
}

duplicateValues(allInputIds.map((entry) => entry.id)).forEach((id) => {
    const locations = allInputIds.filter((entry) => entry.id === id).map((entry) => entry.file);
    fail('input id "' + id + '" is duplicated across ' + locations.join(', '));
});

// Embedded fragments remain in the DOM after their panels close. Validate
// the host plus every possible embedded fragment as one document, not merely
// as isolated source files.
htmlFiles.forEach((hostFile) => {
    const host = fs.readFileSync(path.join(WWW, hostFile), 'utf8');
    const embedded = [...host.matchAll(/data-embed="([^"]+)"/g)].map((match) => match[1] + '.html');
    if (!embedded.length) { return; }
    const liveIds = [];
    [hostFile].concat(embedded).forEach((file) => {
        const source = fs.readFileSync(path.join(WWW, file), 'utf8');
        for (const match of source.matchAll(/\bid="([^"]+)"/g)) { liveIds.push(match[1]); }
    });
    duplicateValues(liveIds).forEach((id) => fail(hostFile + ': embedded DOM duplicates id "' + id + '"'));
});

// CSS assets and basic syntax regressions.
for (const file of fs.readdirSync(path.join(WWW, 'css')).filter((name) => name.endsWith('.css'))) {
    const source = fs.readFileSync(path.join(WWW, 'css', file), 'utf8');
    for (const match of source.matchAll(/url\((?:['"]?)([^)'"\s]+)(?:['"]?)\)/gi)) {
        if (/^(?:data:|https?:|\/\/)/i.test(match[1])) {
            if (/^(?:https?:|\/\/)/i.test(match[1])) { fail('css/' + file + ': remote asset ' + match[1]); }
        } else {
            const resolved = path.resolve(path.join(WWW, 'css'), match[1].split(/[?#]/)[0]);
            if (!fs.existsSync(resolved)) { fail('css/' + file + ': missing asset ' + match[1]); }
        }
    }
}

// Checklist compatibility and the historically duplicated Medical Unit IDs.
const checklistPages = {
    'command.html': 'ICcheckboxValues',
    'commonresp.html': 'CRcheckboxValues',
    'finssect.html': 'FASCcheckboxValues',
    'intelsect.html': 'IIScheckboxValues',
    'logssect.html': 'LSCcheckboxValues',
    'opssect.html': 'OSCcheckboxValues',
    'plansect.html': 'PSCcheckboxValues',
    'protguide.html': 'PAGcheckboxValues'
};
Object.entries(checklistPages).forEach(([file, key]) => {
    const source = fs.readFileSync(path.join(WWW, file), 'utf8');
    if (!new RegExp('id="checkbox-container"[^>]*data-storage-key="' + key + '"').test(source)) {
        fail(file + ': checklist storage key changed from ' + key);
    }
    if (!CORE.CHECKLIST_KEYS.includes(key)) { fail('app-core is missing checklist key ' + key); }
});
const logs = fs.readFileSync(path.join(WWW, 'logssect.html'), 'utf8');
[
    ['medlP01', 'common responsibilities'],
    ['medlP04', 'unit leader responsibilities'],
    ['medlP02', 'Participate in Logistics'],
    ['medlP03', 'Determine level of emergency']
].forEach(([id, text]) => {
    if (!new RegExp('id="' + id + '"[\\s\\S]{0,180}' + text, 'i').test(logs)) {
        fail('logssect.html: Medical Unit compatibility mapping changed for ' + id);
    }
});

// CSP and first-party runtime privacy scan.
const index = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const csp = (index.match(/Content-Security-Policy[^>]*content="([^"]+)"/i) || [])[1] || '';
if (!/script-src\s+'self'\s*;/.test(csp) || /script-src[^;]*(?:unsafe-inline|unsafe-eval|https?:|\*)/.test(csp)) {
    fail('CSP script-src is not local-only');
}
if (!/connect-src\s+'self'\s*;/.test(csp)) { fail('CSP connect-src must be same-origin only'); }
if (!/object-src\s+'none'\s*;/.test(csp) || !/base-uri\s+'self'\s*;/.test(csp)) {
    fail('CSP object/base restrictions are missing');
}

const firstPartyRuntime = [
    path.join(WWW, 'js', 'app-config.js'),
    path.join(WWW, 'js', 'app-core.js'),
    path.join(WWW, 'js', 'app.js'),
    ...htmlFiles.map((file) => path.join(WWW, file))
];
const bannedRuntime = [
    /firebase/i,
    /AIzaSy[0-9A-Za-z_-]{20,}/,
    /glitch\.me/i,
    /socket\.io/i,
    /device\.(?:uuid|serial)/i,
    /cordova\.plugins\.insomnia/i,
    /WebSocket\s*\(/,
    /ACCESS_BACKGROUND_LOCATION/,
    /FOREGROUND_SERVICE/,
    /N@k@l1m0tk0|nakalim0tk0/i
];
firstPartyRuntime.forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    bannedRuntime.forEach((pattern) => {
        if (pattern.test(source)) { fail(path.relative(ROOT, file) + ': banned runtime reference ' + pattern); }
    });
});
if (/window\.open\s*\(/.test(fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8'))) {
    fail('app.js must use Cordova allow-intent anchors, not ambiguous window.open behavior');
}

// Bundled library versions, links, policy, and prohibited release files.
if (!/jQuery v3\.7\.1/.test(fs.readFileSync(path.join(WWW, 'js', 'jquery.min.js'), 'utf8'))) { fail('bundled jQuery is not 3.7.1'); }
if (!/Bootstrap v3\.4\.1/.test(fs.readFileSync(path.join(WWW, 'js', 'bootstrap.min.js'), 'utf8'))) { fail('bundled Bootstrap JS is not 3.4.1'); }
const downloads = fs.readFileSync(path.join(WWW, 'downloads.html'), 'utf8');
const driveLinks = [...downloads.matchAll(/https:\/\/drive\.google\.com\/open\?id=[A-Za-z0-9_-]+/g)];
if (driveLinks.length !== 14) { fail('expected 14 preserved Google Drive form links, found ' + driveLinks.length); }
const privacy = fs.readFileSync(path.join(ROOT, 'privacy-policy.html'), 'utf8');
['KNPN', 'Eric C. Colmenares', 'not stored', 'not transmitted', 'no analytics', 'no tracking'].forEach((text) => {
    if (!privacy.toLowerCase().includes(text.toLowerCase())) { fail('privacy policy is missing: ' + text); }
});

const forbiddenFiles = ['knpn.jks', 'google-services.json', 'app-release-unsigned.apk', 'phicsfog.apk', 'zipalign.exe'];
forbiddenFiles.forEach((file) => {
    if (fs.existsSync(path.join(ROOT, file))) { fail('forbidden release/generated file exists: ' + file); }
});
const tracked = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
if (tracked.status === 0) {
    (tracked.stdout || '').split(/\r?\n/).filter(Boolean).forEach((file) => {
        if (/\.(?:jks|keystore|p12|apk|aab|pem|crt|exe)$/i.test(file) || /(^|\/)build\.release\.json$/i.test(file)) {
            fail('sensitive/generated file is tracked: ' + file);
        }
    });
}

if (!fs.existsSync(path.join(ROOT, 'resources', 'android', 'icon-master.png'))) {
    warn('official icon-master.png is missing; signed releases are intentionally blocked');
}

console.log('Static checks for PH ICS FOG 8.2.2');
console.log('  checked pages:', htmlFiles.length);
console.log('  drive links:', driveLinks.length);
warnings.forEach((message) => console.log('  [WARN] ' + message));
errors.forEach((message) => console.log('  [FAIL] ' + message));
if (errors.length) {
    console.log('Static checks FAILED (' + errors.length + ').');
    process.exit(1);
}
console.log('Static checks passed.');
