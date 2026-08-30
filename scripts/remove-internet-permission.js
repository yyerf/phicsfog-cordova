'use strict';

/*
 * Cordova's Android template declares INTERNET even though PH ICS FOG has no
 * in-WebView network feature. Remove that generated manifest entry after each
 * prepare; approved external links are still handled by other Android apps via
 * config.xml allow-intent rules.
 */
const fs = require('fs');
const path = require('path');

module.exports = function removeInternetPermission(context) {
    const platforms = (context.opts && context.opts.platforms) || [];
    if (!platforms.includes('android')) { return; }

    const root = context.opts.projectRoot;
    const manifest = path.join(root, 'platforms', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    if (!fs.existsSync(manifest)) {
        throw new Error('Generated AndroidManifest.xml was not found during after_prepare.');
    }

    const source = fs.readFileSync(manifest, 'utf8');
    const internetPermission = /\s*<uses-permission\b[^>]*android:name=["']android\.permission\.INTERNET["'][^>]*\/>/g;
    const updated = source.replace(internetPermission, '');
    if (updated !== source) {
        fs.writeFileSync(manifest, updated, 'utf8');
    }
};
