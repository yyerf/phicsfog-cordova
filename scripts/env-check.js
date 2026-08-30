'use strict';

/* Deterministic, cross-platform PH ICS FOG Android toolchain check. */
const fs = require('fs');
const path = require('path');
const {
    ROOT,
    commandVersion,
    javaMajor,
    resolveGradle,
    resolveJava17,
    resolveSdkRoot
} = require('./toolchain');

let failed = false;
function ok(message) { console.log('  [OK]     ' + message); }
function warn(message) { console.log('  [WARN]   ' + message); }
function bad(message) { console.log('  [FAIL]   ' + message); failed = true; }

console.log('PH ICS FOG environment check');
console.log('----------------------------');

const nodeVersion = process.versions.node;
if (Number(nodeVersion.split('.')[0]) === 22) { ok('Node 22 LTS (' + nodeVersion + ')'); }
else { bad('Node 22 LTS required; detected ' + nodeVersion); }

const javaHome = resolveJava17();
if (!javaHome) {
    bad('JDK 17 not selected; set CORDOVA_JAVA_HOME to a JDK 17 installation');
} else {
    const java = path.join(javaHome, 'bin', 'java' + (process.platform === 'win32' ? '.exe' : ''));
    const version = commandVersion(java, ['-version']).output.split('\n')[0];
    ok('JDK 17 (' + version + ')');
    if (!process.env.CORDOVA_JAVA_HOME) {
        warn('CORDOVA_JAVA_HOME is unset; npm build wrappers will derive it from JAVA_HOME');
    } else if (javaMajor(path.resolve(process.env.CORDOVA_JAVA_HOME)) !== 17) {
        bad('CORDOVA_JAVA_HOME does not point to JDK 17');
    }
}

const sdkRoot = resolveSdkRoot();
if (sdkRoot && fs.existsSync(path.join(sdkRoot, 'platforms', 'android-36'))) {
    ok('Android SDK Platform 36 (' + sdkRoot + ')');
} else {
    bad('Android SDK Platform 36 missing; set ANDROID_HOME to the SDK root');
}
if (sdkRoot && fs.existsSync(path.join(sdkRoot, 'build-tools', '36.0.0'))) {
    ok('Android SDK Build Tools 36.0.0');
} else {
    bad('Android SDK Build Tools 36.0.0 missing');
}

const gradle = resolveGradle();
if (gradle) { ok('Gradle 8.14.2 wrapper bootstrap (' + gradle + ')'); }
else { bad('Gradle 8.14.2 missing; install it or set GRADLE_HOME so Cordova can generate its wrapper'); }

const pkg = require(path.join(ROOT, 'package.json'));
const expected = {
    cordova: '13.0.0',
    'cordova-android': '15.1.0',
    'cordova-plugin-geolocation': '5.0.0'
};
Object.entries(expected).forEach(([name, version]) => {
    if (pkg.devDependencies && pkg.devDependencies[name] === version) {
        ok('pinned ' + name + '@' + version);
    } else {
        bad(name + ' must be pinned to ' + version);
    }
});

if (pkg.private === true) { ok('npm package is private'); }
else { bad('package.json must be private'); }

const cordovaDefaultsPath = path.join(ROOT, 'node_modules', 'cordova-android', 'framework', 'cdv-gradle-config-defaults.json');
if (fs.existsSync(cordovaDefaultsPath)) {
    const defaults = require(cordovaDefaultsPath);
    if (defaults.GRADLE_VERSION === '8.14.2') { ok('cordova-android Gradle 8.14.2'); }
    else { bad('cordova-android generated Gradle version is ' + defaults.GRADLE_VERSION + ', expected 8.14.2'); }
} else {
    bad('local cordova-android package is missing; run npm ci');
}

console.log('----------------------------');
if (failed) {
    console.log('Environment check FAILED.');
    process.exit(1);
}
console.log('Environment check passed.');
