'use strict';

/* Build APKs for QA or a certificate-checked, signed AAB for Play. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, assertToolchain, cordovaEnvironment, runCordova } = require('./toolchain');
const APP_CONFIG = require(path.join(ROOT, 'www', 'js', 'app-config.js'));

const args = process.argv.slice(2);
const wantApk = args.includes('--apk');
const wantAab = args.includes('--aab');
const signed = args.includes('--signed');
const unsigned = args.includes('--unsigned');

if ((wantApk && wantAab) || (!wantApk && !wantAab) || (signed && unsigned) || (wantAab && !signed && !unsigned) ||
        (wantApk && (signed || unsigned))) {
    console.error('Usage: node scripts/build.js --apk | --aab (--unsigned | --signed)');
    process.exit(2);
}

function normalizedFingerprint(value) {
    const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    return compact.length === 64 ? compact : null;
}

function pngDimensions(file) {
    if (!fs.existsSync(file)) { return null; }
    const bytes = fs.readFileSync(file);
    if (bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a') { return null; }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function assertOfficialArtwork() {
    const master = path.join(ROOT, 'resources', 'android', 'icon-master.png');
    const dimensions = pngDimensions(master);
    if (!dimensions || dimensions.width < 512 || dimensions.height < 512) {
        throw new Error(
            'Signed release blocked: add the official 8.2.0/Play artwork as resources/android/icon-master.png ' +
            '(at least 512x512), regenerate resources, and review the result. The current icons came from a 170x200 source.'
        );
    }
}

function signingConfig(toolchain) {
    const configPath = path.join(ROOT, 'build.release.json');
    if (!fs.existsSync(configPath)) {
        throw new Error('build.release.json not found. Copy build.release.example.json and fill in the local values.');
    }
    let config;
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch (error) { throw new Error('Could not parse build.release.json: ' + error.message); }

    const required = ['keystorePath', 'storePassword', 'alias', 'password', 'expectedCertificateSha256'];
    required.forEach((key) => {
        if (!config[key] || /^<.*>$/.test(String(config[key]))) {
            throw new Error('build.release.json is missing a real value for ' + key + '.');
        }
    });
    if (config.authoritativeSourceAuditConfirmed !== true) {
        throw new Error('Signed release blocked: confirm the authoritative 8.2.0 source audit in build.release.json.');
    }
    if (config.playVersionCode80202Confirmed !== true) {
        throw new Error('Signed release blocked: confirm in Play Console that versionCode 80202 exceeds every existing artifact.');
    }
    if (!path.isAbsolute(config.keystorePath)) { throw new Error('keystorePath must be absolute.'); }
    const keystore = fs.realpathSync(config.keystorePath);
    const relative = path.relative(ROOT, keystore);
    if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..')) {
        throw new Error('The upload keystore must be stored outside this repository.');
    }

    const expected = normalizedFingerprint(config.expectedCertificateSha256);
    if (!expected) { throw new Error('expectedCertificateSha256 must contain the 64-hex SHA-256 fingerprint from Play App integrity.'); }

    const keytool = path.join(toolchain.javaHome, 'bin', 'keytool' + (process.platform === 'win32' ? '.exe' : ''));
    const environment = Object.assign({}, cordovaEnvironment(toolchain), {
        PHICSFOG_KEYSTORE_PASSWORD: String(config.storePassword)
    });
    const result = spawnSync(keytool, [
        '-list', '-v',
        '-keystore', keystore,
        '-alias', String(config.alias),
        '-storepass:env', 'PHICSFOG_KEYSTORE_PASSWORD'
    ], { encoding: 'utf8', env: environment });
    const output = (result.stdout || '') + (result.stderr || '');
    if (result.status !== 0) { throw new Error('Could not inspect the upload key: ' + output.trim()); }
    const match = output.match(/SHA-?256:\s*([0-9A-F:]{64,})/i);
    const actual = match && normalizedFingerprint(match[1]);
    if (!actual) { throw new Error('Could not read the upload key SHA-256 certificate fingerprint.'); }
    if (actual !== expected) {
        throw new Error('Upload certificate mismatch. Release stopped before signing. Compare build.release.json with Play Console > App integrity.');
    }

    return {
        android: {
            release: {
                keystore,
                storePassword: String(config.storePassword),
                alias: String(config.alias),
                password: String(config.password),
                keystoreType: String(config.keystoreType || 'JKS')
            }
        }
    };
}

let tempDir = null;
try {
    const toolchain = assertToolchain();
    // Android refuses to install an unsigned release APK. Build the QA artifact
    // with Cordova's standard debug key so `npm run apk` always produces an APK
    // that can be installed directly on a device. Play releases remain AAB-only.
    const cordovaArgs = ['build', 'android', wantApk ? '--debug' : '--release'];

    if (signed) {
        assertOfficialArtwork();
        const config = signingConfig(toolchain);
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phicsfog-signing-'));
        const temporaryConfig = path.join(tempDir, 'build.json');
        fs.writeFileSync(temporaryConfig, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
        cordovaArgs.push('--buildConfig=' + temporaryConfig);
    }

    cordovaArgs.push('--', '--packageType=' + (wantApk ? 'apk' : 'bundle'));
    console.log('Building PH ICS FOG ' + APP_CONFIG.versionName + ' ' +
        (wantApk ? 'debug-signed APK for device QA' : (signed ? 'signed Play AAB' : 'unsigned AAB')) + '...');
    const result = runCordova(cordovaArgs);
    if (result.status !== 0) { throw new Error('Cordova build failed with status ' + result.status + '.'); }

    const outputs = path.join(ROOT, 'platforms', 'android', 'app', 'build', 'outputs');
    const candidates = wantApk
        ? [path.join(outputs, 'apk', 'debug', 'app-debug.apk')]
        : [path.join(outputs, 'bundle', 'release', 'app-release.aab'), path.join(outputs, 'bundle', 'release', 'app.aab')];
    const source = candidates.find((candidate) => fs.existsSync(candidate));
    if (!source) { throw new Error('Build artifact not found in the expected Gradle output directory.'); }

    const dist = path.join(ROOT, 'dist');
    fs.mkdirSync(dist, { recursive: true });
    const name = wantApk
        ? 'phicsfog-' + APP_CONFIG.versionName + '-qa.apk'
        : 'phicsfog-' + APP_CONFIG.versionName + '-' + APP_CONFIG.versionCode + (signed ? '' : '-unsigned') + '.aab';
    const destination = path.join(dist, name);
    fs.copyFileSync(source, destination);
    console.log('Artifact: ' + destination + ' (' + (fs.statSync(destination).size / 1024 / 1024).toFixed(1) + ' MB)');

    if (signed || wantApk) {
        const verifyArgs = [path.join(ROOT, 'scripts', 'verify-aab.js'), '--require-signed', destination];
        const verify = spawnSync(process.execPath, verifyArgs, {
            cwd: ROOT,
            stdio: 'inherit',
            env: cordovaEnvironment(toolchain)
        });
        if (verify.status !== 0) {
            throw new Error((wantApk ? 'QA APK' : 'Signed AAB') + ' verification failed.');
        }
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    if (tempDir) {
        const temporaryConfig = path.join(tempDir, 'build.json');
        if (fs.existsSync(temporaryConfig)) { fs.unlinkSync(temporaryConfig); }
        fs.rmdirSync(tempDir);
    }
}
