'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function executable(home, name) {
    return path.join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
}

function commandVersion(command, args) {
    const result = spawnSync(command, args || [], { encoding: 'utf8' });
    return {
        status: result.status,
        output: ((result.stdout || '') + (result.stderr || '')).trim()
    };
}

function javaMajor(javaHome) {
    if (!javaHome) { return null; }
    const java = executable(javaHome, 'java');
    if (!fs.existsSync(java)) { return null; }
    const result = commandVersion(java, ['-version']);
    const match = result.output.match(/version\s+"(?:1\.)?(\d+)/i);
    return match ? Number(match[1]) : null;
}

function resolveJava17() {
    const candidates = [process.env.CORDOVA_JAVA_HOME, process.env.JAVA_HOME].filter(Boolean);
    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (javaMajor(resolved) === 17) { return resolved; }
    }
    return null;
}

function resolveSdkRoot() {
    const candidates = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        path.join(os.homedir(), 'Android', 'Sdk')
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function resolveGradle() {
    const name = 'gradle' + (process.platform === 'win32' ? '.bat' : '');
    const candidates = [];
    if (process.env.GRADLE_HOME) { candidates.push(path.join(process.env.GRADLE_HOME, 'bin', name)); }

    const cache = path.join(os.homedir(), '.gradle', 'wrapper', 'dists');
    if (fs.existsSync(cache)) {
        fs.readdirSync(cache, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('gradle-8.14.2-'))
            .forEach((distribution) => {
                const distributionDir = path.join(cache, distribution.name);
                fs.readdirSync(distributionDir, { withFileTypes: true })
                    .filter((entry) => entry.isDirectory())
                    .forEach((hash) => {
                        candidates.push(path.join(distributionDir, hash.name, 'gradle-8.14.2', 'bin', name));
                    });
            });
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            const home = path.dirname(path.dirname(candidate));
            if (fs.existsSync(path.join(home, 'lib', 'gradle-launcher-8.14.2.jar'))) { return candidate; }
        }
    }
    const fromPath = commandVersion('gradle', ['--version']);
    if (fromPath.status === 0 && /Gradle 8\.14\.2\b/.test(fromPath.output)) { return 'gradle'; }
    return null;
}

function assertToolchain(options) {
    const opts = options || {};
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor !== 22) {
        throw new Error('Node 22 LTS is required; detected ' + process.versions.node + '.');
    }

    const javaHome = resolveJava17();
    if (!javaHome) {
        throw new Error('JDK 17 is required. Set CORDOVA_JAVA_HOME (preferred) or JAVA_HOME to a JDK 17 installation.');
    }

    const sdkRoot = resolveSdkRoot();
    if (!sdkRoot || !fs.existsSync(path.join(sdkRoot, 'platforms', 'android-36'))) {
        throw new Error('Android SDK Platform 36 is missing. Set ANDROID_HOME to the Android SDK root.');
    }
    if (opts.requireBuildTools !== false && !fs.existsSync(path.join(sdkRoot, 'build-tools', '36.0.0'))) {
        throw new Error('Android SDK Build Tools 36.0.0 is missing from ' + sdkRoot + '.');
    }

    const gradle = resolveGradle();
    if (opts.requireGradle && !gradle) {
        throw new Error('Gradle 8.14.2 is required to generate the Cordova wrapper. Install it or set GRADLE_HOME.');
    }

    return { javaHome, sdkRoot, gradle };
}

function cordovaEnvironment(toolchain) {
    const environment = Object.assign({}, process.env, {
        JAVA_HOME: toolchain.javaHome,
        CORDOVA_JAVA_HOME: toolchain.javaHome,
        ANDROID_HOME: toolchain.sdkRoot,
        ANDROID_SDK_ROOT: toolchain.sdkRoot
    });
    if (toolchain.gradle && toolchain.gradle !== 'gradle') {
        environment.PATH = path.dirname(toolchain.gradle) + path.delimiter + (environment.PATH || '');
    }
    return environment;
}

function cordovaBin() {
    return path.join(ROOT, 'node_modules', '.bin', 'cordova' + (process.platform === 'win32' ? '.cmd' : ''));
}

function runCordova(args, options) {
    const opts = options || {};
    const toolchain = assertToolchain(Object.assign({}, opts, { requireGradle: true }));
    const bin = cordovaBin();
    if (!fs.existsSync(bin)) { throw new Error('Local Cordova CLI is missing; run npm ci.'); }
    return spawnSync(bin, args, {
        cwd: ROOT,
        env: cordovaEnvironment(toolchain),
        stdio: opts.stdio || 'inherit',
        encoding: opts.encoding
    });
}

module.exports = {
    ROOT,
    assertToolchain,
    commandVersion,
    cordovaBin,
    cordovaEnvironment,
    javaMajor,
    resolveJava17,
    resolveGradle,
    resolveSdkRoot,
    runCordova
};
