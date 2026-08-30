'use strict';

const { runCordova } = require('./toolchain');

const args = process.argv.slice(2);
if (!args.length) {
    console.error('Usage: node scripts/cordova.js <cordova arguments>');
    process.exit(2);
}

try {
    const result = runCordova(args);
    if (result.error) { throw result.error; }
    process.exit(typeof result.status === 'number' ? result.status : 1);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
