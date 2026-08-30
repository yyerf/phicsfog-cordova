'use strict';
/*
 * CI entry point. Replicates the GitHub Actions job locally:
 *   clean npm ci -> unit + static tests -> prepare -> debug build -> artifact check.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', '.bin');

function run(cmd, args, opts) {
    console.log('\n==> ' + cmd + ' ' + (args || []).join(' '));
    const r = spawnSync(cmd, args || [], Object.assign({ stdio: 'inherit', cwd: ROOT }, opts));
    if (r.status !== 0) { console.error('CI step failed.'); process.exit(r.status || 1); }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

console.log('PH ICS FOG CI (Node 22 / JDK 17 / API 36)');
run(npm, ['--version']);
run(npm, ['ci']);
run(npm, ['run', 'env:check']);
// `npm test` runs both unit and static checks via `node --test`.
run(npm, ['test']);
run(npm, ['run', 'prepare:android']);
run(npm, ['run', 'debug']);
run(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-aab.js'),
    '--require-signed',
    path.join(ROOT, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
]);
console.log('\nCI succeeded: clean install, tests passed, and debug APK built and verified.');
