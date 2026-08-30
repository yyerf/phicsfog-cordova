'use strict';

/* Build, safely install, launch, and identify the QA APK on one Android device. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, assertToolchain, cordovaEnvironment } = require('./toolchain');
const APP_CONFIG = require(path.join(ROOT, 'www', 'js', 'app-config.js'));

const suffix = process.platform === 'win32' ? '.bat' : '';
let temporaryDirectory = null;

function run(command, args, options) {
    return spawnSync(command, args, Object.assign({ cwd: ROOT, encoding: 'utf8' }, options));
}

function combinedOutput(result) {
    return ((result.stdout || '') + (result.stderr || '')).trim();
}

function requireSuccess(result, label) {
    if (result.error) { throw new Error(label + ': ' + result.error.message); }
    if (result.status !== 0) { throw new Error(label + ': ' + (combinedOutput(result) || 'command failed')); }
    return result;
}

function certificateDigest(apksigner, apk, environment) {
    const result = requireSuccess(
        run(apksigner, ['verify', '--print-certs', apk], { env: environment }),
        'Could not inspect APK certificate'
    );
    const match = combinedOutput(result).match(/certificate SHA-256 digest:\s*([0-9a-f]+)/i);
    if (!match) { throw new Error('Could not read the APK certificate SHA-256 digest.'); }
    return match[1].toUpperCase();
}

function adbRun(adb, serial, args, environment, options) {
    return run(adb, ['-s', serial].concat(args), Object.assign({ env: environment }, options));
}

try {
    const toolchain = assertToolchain({ requireGradle: true });
    const environment = cordovaEnvironment(toolchain);
    const build = run(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), '--apk'], {
        env: environment,
        stdio: 'inherit'
    });
    if (build.status !== 0) { throw new Error('QA APK build or verification failed.'); }

    const artifact = path.join(ROOT, 'dist', 'phicsfog-' + APP_CONFIG.versionName + '-qa.apk');
    const adb = path.join(toolchain.sdkRoot, 'platform-tools', 'adb' + (process.platform === 'win32' ? '.exe' : ''));
    const apksigner = path.join(toolchain.sdkRoot, 'build-tools', '36.0.0', 'apksigner' + suffix);
    if (!fs.existsSync(adb)) { throw new Error('Android SDK platform-tools/adb is missing.'); }

    const devicesResult = requireSuccess(run(adb, ['devices', '-l'], { env: environment }), 'Could not list Android devices');
    const devices = (devicesResult.stdout || '').split(/\r?\n/).slice(1).map((line) => {
        const match = line.trim().match(/^(\S+)\s+(\S+)(?:\s|$)/);
        return match ? { serial: match[1], state: match[2], line: line.trim() } : null;
    }).filter(Boolean);
    const selectedSerial = process.env.ANDROID_SERIAL;
    const selected = selectedSerial
        ? devices.filter((device) => device.serial === selectedSerial)
        : devices.filter((device) => device.state === 'device');

    if (selectedSerial && selected.length !== 1) {
        throw new Error('ANDROID_SERIAL=' + selectedSerial + ' is not visible to adb.');
    }
    if (!selectedSerial && selected.length > 1) {
        throw new Error('More than one authorized device is attached. Set ANDROID_SERIAL to choose one.');
    }
    if (!selected.length) {
        const unauthorized = devices.filter((device) => device.state === 'unauthorized');
        if (unauthorized.length) {
            throw new Error('The attached phone is unauthorized. Unlock it, accept the USB debugging prompt, then rerun npm run phone:test.');
        }
        throw new Error('No authorized Android phone is attached. Enable USB debugging, connect it, then rerun npm run phone:test.');
    }
    if (selected[0].state !== 'device') {
        throw new Error('Selected Android device is not ready: ' + selected[0].line);
    }
    const serial = selected[0].serial;
    console.log('Phone: ' + selected[0].line);

    // Avoid suggesting an uninstall of the Play-signed app, which would erase
    // checklist data. A debug-signed APK may only replace an existing debug copy.
    const localDigest = certificateDigest(apksigner, artifact, environment);
    const paths = adbRun(adb, serial, ['shell', 'pm', 'path', APP_CONFIG.appId], environment);
    if (paths.status === 0 && /^package:/m.test(paths.stdout || '')) {
        const remoteApk = (paths.stdout || '').match(/^package:(.+)$/m)[1].trim();
        temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'phicsfog-installed-apk-'));
        const installedApk = path.join(temporaryDirectory, 'base.apk');
        requireSuccess(adbRun(adb, serial, ['pull', remoteApk, installedApk], environment), 'Could not inspect installed app');
        const installedDigest = certificateDigest(apksigner, installedApk, environment);
        if (installedDigest !== localDigest) {
            throw new Error(
                'Install stopped: com.knpn.phicsfog is already installed with a different certificate (normally the Play build). ' +
                'Do not uninstall it if checklist data or upgrade testing matters. Use the signed Internal testing AAB instead.'
            );
        }
    }

    const install = requireSuccess(
        adbRun(adb, serial, ['install', '-r', artifact], environment),
        'APK installation failed'
    );
    console.log(combinedOutput(install) || 'APK installed.');
    requireSuccess(
        adbRun(adb, serial, ['shell', 'monkey', '-p', APP_CONFIG.appId, '-c', 'android.intent.category.LAUNCHER', '1'], environment),
        'App launch failed'
    );

    const details = requireSuccess(
        adbRun(adb, serial, ['shell', 'dumpsys', 'package', APP_CONFIG.appId], environment),
        'Could not verify installed package'
    ).stdout || '';
    const versionName = (details.match(/\bversionName=([^\s]+)/) || [])[1];
    const versionCode = (details.match(/\bversionCode=(\d+)/) || [])[1];
    if (versionName !== String(APP_CONFIG.versionName) || versionCode !== String(APP_CONFIG.versionCode)) {
        throw new Error('Installed package version mismatch: got ' + versionName + '/' + versionCode + '.');
    }
    console.log('Launched ' + APP_CONFIG.appId + ' ' + versionName + ' (' + versionCode + ') on ' + serial + '.');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    if (temporaryDirectory) { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
}
