/*
 * PH ICS FOG - application configuration.
 *
 * This is the single source of truth for the version and runtime URLs. The
 * static tests (test/static.test.js) assert that this object stays in sync
 * with config.xml and package.json.
 *
 * Exposed as APP_CONFIG in the browser and module.exports in Node (tests).
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.APP_CONFIG = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var config = {
        // Identity
        appId: 'com.knpn.phicsfog',
        name: 'PH ICS FOG',
        versionName: '8.2.2',
        versionCode: 80202,
        minSdk: 24,
        targetSdk: 36,

        // After this instant the app shows a one-per-cold-launch update warning
        // (Update / Continue) but never locks or terminates the offline guide.
        expiresAt: '2027-12-31T23:59:59+08:00',

        playStoreUrl: 'https://play.google.com/store/apps/details?id=com.knpn.phicsfog',
        privacyPolicyUrl: 'https://yyerf.github.io/phicsfog-cordova/privacy-policy.html'
    };
    return (typeof Object.freeze === 'function') ? Object.freeze(config) : config;
}));
