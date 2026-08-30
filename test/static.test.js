'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

// Run the static checks as a test so `node --test` covers both unit and
// static validation in one command.
test('static checks pass (assets, nav, ids, version sync, CSP, no tracking)', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'static-check.js')], { encoding: 'utf8' });
    // The checker prints to stdout and exits 0 on success.
    assert.strictEqual(r.status, 0, 'static-check failed:\n' + (r.stdout + r.stderr));
});
