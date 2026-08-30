'use strict';

/* Verify actual artifact metadata, permissions, structure, and certificate. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ROOT, assertToolchain, cordovaEnvironment } = require('./toolchain');
const APP_CONFIG = require(path.join(ROOT, 'www', 'js', 'app-config.js'));

const argv = process.argv.slice(2);
const requireSigned = argv.includes('--require-signed');
let artifact = argv.find((arg) => !arg.startsWith('--'));
if (!artifact) {
    artifact = path.join(ROOT, 'dist', 'phicsfog-' + APP_CONFIG.versionName + '-' + APP_CONFIG.versionCode + '.aab');
}
artifact = path.resolve(artifact);

let failures = 0;
function ok(message) { console.log('  [OK]     ' + message); }
function bad(message) { console.log('  [FAIL]   ' + message); failures += 1; }

function normalizedFingerprint(value) {
    const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return compact.length === 64 ? compact : null;
}

function run(command, args, environment) {
    return spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: environment });
}

function output(result) {
    return ((result.stdout || '') + (result.stderr || '')).trim();
}

if (!fs.existsSync(artifact)) {
    console.error('Artifact not found: ' + artifact);
    process.exit(1);
}

const extension = path.extname(artifact).toLowerCase();
if (extension !== '.aab' && extension !== '.apk') {
    console.error('Expected an .aab or .apk artifact.');
    process.exit(2);
}

let toolchain;
try { toolchain = assertToolchain(); }
catch (error) { console.error(error.message); process.exit(1); }
const environment = cordovaEnvironment(toolchain);
const sdk = toolchain.sdkRoot;
const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const scriptSuffix = process.platform === 'win32' ? '.bat' : '';
const apkanalyzer = path.join(sdk, 'cmdline-tools', 'latest', 'bin', 'apkanalyzer' + scriptSuffix);
const buildTools = path.join(sdk, 'build-tools', '36.0.0');
const apksigner = path.join(buildTools, 'apksigner' + scriptSuffix);
const jar = path.join(toolchain.javaHome, 'bin', 'jar' + executableSuffix);
const jarsigner = path.join(toolchain.javaHome, 'bin', 'jarsigner' + executableSuffix);
const keytool = path.join(toolchain.javaHome, 'bin', 'keytool' + executableSuffix);
const expectedPermissions = [
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION',
    // AndroidX adds this signature-level, application-scoped permission to
    // prevent other apps from targeting its compatibility receivers.
    APP_CONFIG.appId + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
];

function checkPermissions(permissions) {
    const unique = [...new Set(permissions)];
    const extras = unique.filter((permission) => !expectedPermissions.includes(permission));
    const missing = expectedPermissions.filter((permission) => !unique.includes(permission));
    if (!extras.length && !missing.length) {
        ok('permissions are exactly foreground coarse/fine location + AndroidX receiver guard');
    } else {
        if (missing.length) { bad('missing expected permissions: ' + missing.join(', ')); }
        if (extras.length) { bad('unexpected permissions: ' + extras.join(', ')); }
    }
    if (unique.some((permission) => /BACKGROUND_LOCATION|FOREGROUND_SERVICE/.test(permission))) {
        bad('background location or foreground-service permission is present');
    }
}

function xmlAttribute(tag, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = tag.match(new RegExp('\\s' + escaped + '="([^"]*)"'));
    return match ? match[1] : null;
}

console.log('Verifying: ' + artifact);

const archive = run(jar, ['tf', artifact], environment);
if (archive.status !== 0) {
    bad('artifact is not a readable ZIP/JAR archive');
} else {
    ok('artifact is a readable archive');
    const entries = (archive.stdout || '').split(/\r?\n/).filter(Boolean);
    const prohibitedEntries = entries.filter((entry) =>
        /firebase|google-services|socket\.io|insomnia|cordova-plugin-device|glitch/i.test(entry)
    );
    if (prohibitedEntries.length) {
        bad('artifact contains prohibited tracking/device assets: ' + prohibitedEntries.join(', '));
    } else {
        ok('archive contains no Firebase, Socket.IO, Insomnia, device plugin, or Glitch assets');
    }
    if (extension === '.aab') {
        if (/(^|\n)base\/manifest\/AndroidManifest\.xml(\r?$|\n)/m.test(archive.stdout || '')) {
            ok('AAB contains base/manifest/AndroidManifest.xml');
        } else {
            bad('AAB is missing base/manifest/AndroidManifest.xml');
        }
    }
}

if (extension === '.aab') {
    const bundletoolProject = path.join(ROOT, 'scripts', 'bundletool');
    const bundletoolArgs = (command) => [
        '--quiet', '--no-daemon', '-p', bundletoolProject, 'runBundletool',
        '-PbundletoolCommand=' + command,
        '-PbundlePath=' + artifact
    ];
    if (!toolchain.gradle || !fs.existsSync(path.join(bundletoolProject, 'build.gradle'))) {
        bad('Gradle 8.14.2 and the scripts/bundletool project are required for AAB inspection');
    } else {
        const validation = run(toolchain.gradle, bundletoolArgs('validate'), environment);
        if (validation.status === 0) { ok('bundletool validates the AAB structure'); }
        else { bad('bundletool rejected the AAB: ' + output(validation)); }

        const dump = run(toolchain.gradle, bundletoolArgs('dump'), environment);
        const dumpOutput = output(dump);
        const manifestMatch = dumpOutput.match(/<manifest\b[\s\S]*<\/manifest>/);
        if (dump.status !== 0 || !manifestMatch) {
            bad('bundletool could not dump the base manifest: ' + dumpOutput);
        } else {
            const manifest = manifestMatch[0];
            const manifestTag = manifest.match(/<manifest\b[^>]*>/);
            const sdkTag = manifest.match(/<uses-sdk\b[^>]*>/);
            const actual = {
                'application-id': manifestTag && xmlAttribute(manifestTag[0], 'package'),
                'version-name': manifestTag && xmlAttribute(manifestTag[0], 'android:versionName'),
                'version-code': manifestTag && xmlAttribute(manifestTag[0], 'android:versionCode'),
                'min-sdk': sdkTag && xmlAttribute(sdkTag[0], 'android:minSdkVersion'),
                'target-sdk': sdkTag && xmlAttribute(sdkTag[0], 'android:targetSdkVersion')
            };
            const expected = {
                'application-id': String(APP_CONFIG.appId),
                'version-name': String(APP_CONFIG.versionName),
                'version-code': String(APP_CONFIG.versionCode),
                'min-sdk': String(APP_CONFIG.minSdk),
                'target-sdk': String(APP_CONFIG.targetSdk)
            };
            Object.entries(expected).forEach(([name, value]) => {
                if (actual[name] === value) { ok(name + ': ' + actual[name]); }
                else { bad(name + ': expected ' + value + ', got ' + (actual[name] || '(no value)')); }
            });
            const permissions = [...manifest.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"[^>]*>/g)]
                .map((match) => match[1]);
            checkPermissions(permissions);
        }
    }
} else if (!fs.existsSync(apkanalyzer)) {
    bad('apkanalyzer is missing from Android SDK command-line tools/latest');
} else {
    const expected = {
        'application-id': String(APP_CONFIG.appId),
        'version-name': String(APP_CONFIG.versionName),
        'version-code': String(APP_CONFIG.versionCode),
        'min-sdk': String(APP_CONFIG.minSdk),
        'target-sdk': String(APP_CONFIG.targetSdk)
    };
    Object.entries(expected).forEach(([verb, value]) => {
        const result = run(apkanalyzer, ['manifest', verb, artifact], environment);
        const actual = output(result);
        if (result.status === 0 && actual === value) { ok(verb + ': ' + actual); }
        else { bad(verb + ': expected ' + value + ', got ' + (actual || '(no value)')); }
    });

    const permissionResult = run(apkanalyzer, ['manifest', 'permissions', artifact], environment);
    if (permissionResult.status !== 0) {
        bad('could not read artifact permissions: ' + output(permissionResult));
    } else {
        const permissions = output(permissionResult).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        checkPermissions(permissions);
    }
}

if (extension === '.aab') {
    const signature = run(jarsigner, ['-verify', artifact], environment);
    const signatureOutput = output(signature);
    const isSigned = signature.status === 0 && /jar verified/i.test(signatureOutput) && !/jar is unsigned/i.test(signatureOutput);
    if (requireSigned && !isSigned) { bad('AAB signature verification failed: ' + signatureOutput); }
    else if (isSigned) { ok('AAB JAR signature verified'); }
    else { ok('AAB is unsigned, as expected for release preparation'); }

    if (requireSigned && isSigned) {
        const certificate = run(keytool, ['-printcert', '-jarfile', artifact], environment);
        const certificateOutput = output(certificate);
        const match = certificateOutput.match(/SHA-?256:\s*([0-9A-F:]{64,})/i);
        const actual = match && normalizedFingerprint(match[1]);
        if (!actual) {
            bad('could not extract the signed AAB certificate SHA-256 fingerprint');
        } else {
            const configPath = path.join(ROOT, 'build.release.json');
            if (!fs.existsSync(configPath)) {
                bad('build.release.json is required to compare the signed certificate with Play App integrity');
            } else {
                try {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    const expected = normalizedFingerprint(config.expectedCertificateSha256);
                    if (expected && expected === actual) { ok('certificate matches the Play upload-key SHA-256 fingerprint'); }
                    else { bad('signed certificate does not match expectedCertificateSha256'); }
                } catch (error) {
                    bad('could not parse build.release.json for certificate comparison: ' + error.message);
                }
            }
        }
    }
} else {
    if (!fs.existsSync(apksigner)) {
        bad('apksigner 36.0.0 is missing');
    } else {
        const signature = run(apksigner, ['verify', '--print-certs', artifact], environment);
        if (signature.status === 0) { ok('APK signature verified'); }
        else if (requireSigned) { bad('APK signature verification failed: ' + output(signature)); }
        else { ok('APK is unsigned, as expected for QA'); }
    }
}

console.log('----------------------------');
if (failures) {
    console.log('Verification FAILED (' + failures + ').');
    process.exit(1);
}
console.log('Artifact verification passed.');
