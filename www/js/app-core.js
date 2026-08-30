/*
 * PH ICS FOG - core application logic.
 *
 * This module contains pure, dependency-injected logic so it can be unit
 * tested in Node (test/app-core.test.js). It is intentionally free of direct
 * DOM / plugin calls; www/js/app.js wires this core to the WebView, the
 * geolocation plugin, the Wake Lock API, and the Android back button.
 *
 * Exposed as APP_CORE in the browser and module.exports in Node (tests).
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(root);
    } else {
        root.APP_CORE = factory(root);
    }
}(typeof self !== 'undefined' ? self : this, function (root) {
    'use strict';

    // ------------------------------------------------------------------ //
    // Persistence keys                                                    //
    // ------------------------------------------------------------------ //

    /*
     * All checklist storage keys ever used by the app. These MUST stay stable
     * so that upgrading from 8.2.0 (and earlier) does not erase user progress.
     * "Clear Data" removes only these keys (never the update/expiry markers).
     */
    var CHECKLIST_KEYS = [
        'checkboxValues',            // legacy generic key
        'CRcheckboxValues',          // Common Responsibilities
        'FASCcheckboxValues',        // Finance & Administration Section Chief
        'ICcheckboxValues',          // Incident Command
        'IIScheckboxValues',         // Intelligence & Investigation Section
        'LSCcheckboxValues',         // Logistics Section Chief
        'OSCcheckboxValues',         // Operations Section Chief
        'PAGcheckboxValues',         // Protective Actions Guide
        'PSCcheckboxValues'          // Planning Section Chief
    ];

    // The "What's New" acknowledgement is deliberately persistent. The
    // post-expiry warning is not: app.js tracks that in memory so it appears
    // once on every cold launch, as required, without touching checklist data.
    var UPDATE_NOTICE_KEY = 'phicsfog.updateNotice.8.2.2';

    function isChecklistKey(key) {
        return CHECKLIST_KEYS.indexOf(key) !== -1;
    }

    /** Given an array of localStorage keys, return only the checklist keys. */
    function collectChecklistKeys(allKeys) {
        var out = [];
        (allKeys || []).forEach(function (k) {
            if (isChecklistKey(k)) { out.push(k); }
        });
        return out;
    }

    // ------------------------------------------------------------------ //
    // Application configuration                                          //
    // ------------------------------------------------------------------ //

    /** Validate the runtime configuration before any value is consumed. */
    function validateAppConfig(config) {
        var errors = [];
        var c = config || {};
        if (c.appId !== 'com.knpn.phicsfog') { errors.push('invalid appId'); }
        if (c.name !== 'PH ICS FOG') { errors.push('invalid app name'); }
        if (!/^\d+\.\d+\.\d+$/.test(c.versionName || '')) { errors.push('invalid versionName'); }
        if (!Number.isInteger(c.versionCode) || c.versionCode < 1) { errors.push('invalid versionCode'); }
        if (!Number.isInteger(c.minSdk) || !Number.isInteger(c.targetSdk) || c.minSdk > c.targetSdk) {
            errors.push('invalid SDK range');
        }
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(c.expiresAt || '') ||
                Number.isNaN(new Date(c.expiresAt).getTime())) {
            errors.push('invalid expiresAt');
        }
        if (c.playStoreUrl !== 'https://play.google.com/store/apps/details?id=com.knpn.phicsfog') {
            errors.push('invalid Play Store URL');
        }
        if (c.privacyPolicyUrl !== 'https://yyerf.github.io/phicsfog-cordova/privacy-policy.html') {
            errors.push('invalid privacy-policy URL');
        }
        return { valid: errors.length === 0, errors: errors };
    }

    // ------------------------------------------------------------------ //
    // Expiry                                                              //
    // ------------------------------------------------------------------ //

    function nowISO() {
        return new Date().toISOString();
    }

    /** Returns 'expired' when now >= expiresAt, otherwise 'valid'. */
    function expiryStatus(expiresAtISO, nowStr) {
        var expiry = new Date(expiresAtISO).getTime();
        var t = nowStr != null ? new Date(nowStr).getTime() : Date.now();
        if (!Number.isFinite(expiry) || !Number.isFinite(t)) { return 'invalid'; }
        return (t >= expiry) ? 'expired' : 'valid';
    }

    // ------------------------------------------------------------------ //
    // Navigation history                                                  //
    // ------------------------------------------------------------------ //

    /** Push a page onto the history stack. */
    function pushPage(stack, page) {
        var s = (stack || []).slice();
        if (s[s.length - 1] !== page) { s.push(page); }
        return s;
    }

    /**
     * Pop the most recent page and return the page to navigate back to and
     * the remaining stack. Returns { page, current, stack }.
     */
    function backPage(stack) {
        var s = (stack || []).slice();
        var current = s.pop() || '';
        var previous = s.length ? s[s.length - 1] : '';
        return { page: previous, current: current, stack: s };
    }

    /**
     * Accept only a real, simple local fragment ID. A bare "#" is commonly
     * used as an inert link, but passing it to jQuery 3 throws a selector
     * syntax error. Restricting the grammar also prevents arbitrary selector
     * text from navigation markup reaching the selector engine.
     */
    function normalizeFragmentTarget(value) {
        var target = typeof value === 'string' ? value.trim() : '';
        return /^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(target) ? target : '';
    }

    /** Ignore duplicate native back events delivered in the same key gesture. */
    function isDuplicateBackEvent(previousTimestamp, currentTimestamp, debounceMs) {
        var previous = Number(previousTimestamp) || 0;
        var current = Number(currentTimestamp) || 0;
        var delay = Number(debounceMs) || 0;
        return previous > 0 && current >= previous && current - previous < delay;
    }

    /**
     * Return a document scroll position that leaves an anchor fully visible
     * below a fixed header. Values come from live layout measurements so this
     * remains correct in landscape and when Android changes the text scale.
     */
    function anchoredScrollTop(anchorOffset, fixedHeaderHeight, gap) {
        var anchor = Number(anchorOffset);
        var header = Math.max(0, Number(fixedHeaderHeight) || 0);
        var spacing = Math.max(0, Number(gap) || 0);
        if (!Number.isFinite(anchor)) { return 0; }
        return Math.max(0, Math.round(anchor - header - spacing));
    }

    /**
     * Stop a location watch when the app is backgrounded only after it has
     * become active. Android's foreground-permission sheet itself pauses the
     * Cordova activity; cancelling/restarting a REQUESTING watch there can
     * dismiss the first prompt and immediately create a duplicate prompt.
     */
    function shouldStopGpsOnPause(status) {
        return status === GPS_STATUS.ACTIVE;
    }

    // ------------------------------------------------------------------ //
    // Checklist serialization                                              //
    // ------------------------------------------------------------------ //

    /** Build { id: checked } from an array of checkbox DOM elements. */
    function snapshotFromDom(checkboxEls) {
        var out = {};
        (checkboxEls || []).forEach(function (el) {
            if (el && el.id) { out[el.id] = !!el.checked; }
        });
        return out;
    }

    /** Apply a snapshot via the injected setter (checks boxes in the DOM). */
    function applySnapshot(snapshot, setChecked) {
        var keys = Object.keys(snapshot || {});
        for (var i = 0; i < keys.length; i++) {
            if (typeof setChecked === 'function') {
                setChecked(keys[i], !!snapshot[keys[i]]);
            }
        }
    }

    function serialize(snapshot) {
        return JSON.stringify(snapshot || {});
    }

    function deserialize(str) {
        try {
            var parsed = JSON.parse(str);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    /** Merge stored snapshot with current DOM snapshot (DOM wins). */
    function merge(stored, dom) {
        var out = {};
        Object.keys(stored || {}).forEach(function (k) { out[k] = stored[k]; });
        Object.keys(dom || {}).forEach(function (k) { out[k] = dom[k]; });
        return out;
    }


    // ------------------------------------------------------------------ //
    // GPS controller (dependency-injected geolocation)                    //
    // ------------------------------------------------------------------ //

    var GPS_STATUS = {
        IDLE: 'idle',
        REQUESTING: 'requesting',
        ACTIVE: 'active',
        DENIED: 'denied',
        UNAVAILABLE: 'unavailable',
        TIMEOUT: 'timeout',
        ERROR: 'error',
        STOPPED: 'stopped'
    };

    /**
     * Create a controllable GPS session.
     *
     * opts.geo         - { getCurrentPosition, watchPosition, clearWatch }
     * opts.onStatus    - callback(status, detail) for UI updates
     *
     * Start is intentionally only triggered by an explicit user action; the
     * controller coordinates a one-shot permission probe plus a long-running
     * watch, and can be stopped (Stop / navigation / pause / exit).
     */
    function createGpsController(opts) {
        opts = opts || {};
        var geo = opts.geo || (root.navigator && root.navigator.geolocation) || null;
        var emit = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
        var state = {
            running: false,
            watchId: null,
            lastPosition: null,
            status: GPS_STATUS.IDLE
        };

        function setStatus(status, detail) {
            state.status = status;
            emit(status, detail);
        }

        var generation = 0;

        function clearWatch() {
            if (state.watchId != null && geo && typeof geo.clearWatch === 'function') {
                try { geo.clearWatch(state.watchId); } catch (e) { /* fail harmlessly */ }
            }
            state.watchId = null;
        }

        function handleSuccess(pos, token) {
            if (!state.running || token !== generation) { return; }
            state.lastPosition = pos;
            setStatus(GPS_STATUS.ACTIVE, pos);
        }

        function handleError(err, token) {
            if (!state.running || token !== generation) { return; }
            state.running = false;
            clearWatch();
            var code = err && err.code;
            if (code === 1) { setStatus(GPS_STATUS.DENIED, err); }
            else if (code === 2) { setStatus(GPS_STATUS.UNAVAILABLE, err); }
            else if (code === 3) { setStatus(GPS_STATUS.TIMEOUT, err); }
            else { setStatus(GPS_STATUS.ERROR, err); }
        }

        function start(options) {
            options = options || {};
            if (!geo || typeof geo.watchPosition !== 'function') {
                setStatus(GPS_STATUS.UNAVAILABLE, { message: 'Geolocation is not supported on this device.' });
                return false;
            }
            if (state.running) { return true; }
            var timeout = (options.timeout != null) ? options.timeout : 30000;
            var highAcc = options.enableHighAccuracy !== false;
            generation += 1;
            var token = generation;
            state.running = true;
            setStatus(GPS_STATUS.REQUESTING, {});

            // A single watch both prompts for foreground permission and
            // supplies updates. Avoiding a simultaneous one-shot request
            // prevents duplicate prompts/callback races on older WebViews.
            try {
                var id = geo.watchPosition(function (pos) {
                    handleSuccess(pos, token);
                }, function (err) {
                    handleError(err, token);
                }, {
                    enableHighAccuracy: highAcc,
                    timeout: timeout,
                    maximumAge: 5000
                });
                if (state.running && token === generation) {
                    state.watchId = id;
                } else if (id != null && typeof geo.clearWatch === 'function') {
                    try { geo.clearWatch(id); } catch (e) { /* fail harmlessly */ }
                }
            } catch (e) {
                state.running = false;
                clearWatch();
                setStatus(GPS_STATUS.ERROR, e);
                return false;
            }
            return true;
        }

        function stop() {
            generation += 1;
            state.running = false;
            clearWatch();
            setStatus(GPS_STATUS.STOPPED, {});
        }

        function clear() {
            stop();
            state.lastPosition = null;
        }

        return {
            start: start,
            stop: stop,
            clear: clear,
            isRunning: function () { return !!state.running; },
            lastPosition: function () { return state.lastPosition; },
            status: function () { return state.status; },
            STATUS: GPS_STATUS
        };
    }


    // ------------------------------------------------------------------ //
    // Wake-lock controller (WebView Screen Wake Lock API)                 //
    // ------------------------------------------------------------------ //

    var WL_STATUS = {
        IDLE: 'idle',
        UNSUPPORTED: 'unsupported',
        ACTIVE: 'active',
        DENIED: 'denied',
        HIDDEN: 'hidden',
        RELEASED: 'released'
    };

    /**
     * Optionally keep the screen awake while the app is visible, using the
     * standard Screen Wake Lock API available in the Android 16 WebView.
     * Fails harmlessly when unsupported or denied. Re-acquired on visibility
     * regain; released when the page is hidden or the lock is released.
     *
     * opts.requestWakeLock - injected request func (default navigator.wakeLock)
     * opts.isVisible       - injected visibility check (default document.hidden)
     * opts.onStatus        - callback(status)
     */
    function createWakeLockController(opts) {
        opts = opts || {};
        var navWL = root.navigator && root.navigator.wakeLock;
        var req = opts.requestWakeLock ||
            (navWL && typeof navWL.request === 'function'
                ? function (type) { return navWL.request(type); }
                : null);
        var isVisible = opts.isVisible ||
            function () { return typeof root.document === 'undefined' || !root.document.hidden; };
        var emit = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
        var lock = null;
        var pending = null;
        var generation = 0;
        var desired = false;
        var supported = !!req;
        var status = supported ? WL_STATUS.IDLE : WL_STATUS.UNSUPPORTED;

        function setStatus(s) {
            status = s;
            emit(s);
        }

        function acquire() {
            desired = true;
            if (!supported) {
                setStatus(WL_STATUS.UNSUPPORTED);
                return Promise.resolve(false);
            }
            if (!isVisible()) {
                setStatus(WL_STATUS.HIDDEN);
                return Promise.resolve(false);
            }
            if (lock) { return Promise.resolve(true); }
            if (pending) { return pending; }
            generation += 1;
            var token = generation;
            pending = Promise.resolve().then(function () {
                return req('screen');
            }).then(function (l) {
                pending = null;
                if (!desired || !isVisible() || token !== generation) {
                    if (l && typeof l.release === 'function') {
                        try { l.release(); } catch (e) { /* fail harmlessly */ }
                    }
                    return false;
                }
                lock = l;
                setStatus(WL_STATUS.ACTIVE);
                if (l && typeof l.addEventListener === 'function') {
                    l.addEventListener('release', function () {
                        if (lock !== l) { return; }
                        lock = null;
                        setStatus(WL_STATUS.RELEASED);
                        if (desired && isVisible()) { acquire(); }
                    });
                }
                return true;
            }).catch(function () {
                pending = null;
                if (token !== generation) { return false; }
                lock = null;
                setStatus(WL_STATUS.DENIED);
                return false;
            });
            return pending;
        }

        function dropLock(nextStatus, keepDesired) {
            if (!keepDesired) { desired = false; }
            generation += 1;
            pending = null;
            var held = lock;
            lock = null;
            if (held && typeof held.release === 'function') {
                try { held.release(); } catch (e) { /* fail harmlessly */ }
            }
            setStatus(nextStatus);
        }

        function release() {
            dropLock(WL_STATUS.RELEASED, false);
        }

        function onVisibilityChange() {
            if (isVisible()) {
                if (desired && !lock) { acquire(); }
            } else {
                dropLock(WL_STATUS.HIDDEN, true);
            }
        }

        return {
            acquire: acquire,
            release: release,
            onVisibilityChange: onVisibilityChange,
            isSupported: function () { return supported; },
            status: function () { return status; },
            STATUS: WL_STATUS
        };
    }


    // ------------------------------------------------------------------ //

    return {
        CHECKLIST_KEYS: CHECKLIST_KEYS,
        UPDATE_NOTICE_KEY: UPDATE_NOTICE_KEY,
        GPS_STATUS: GPS_STATUS,
        WL_STATUS: WL_STATUS,
        isChecklistKey: isChecklistKey,
        collectChecklistKeys: collectChecklistKeys,
        validateAppConfig: validateAppConfig,
        nowISO: nowISO,
        expiryStatus: expiryStatus,
        pushPage: pushPage,
        backPage: backPage,
        normalizeFragmentTarget: normalizeFragmentTarget,
        isDuplicateBackEvent: isDuplicateBackEvent,
        anchoredScrollTop: anchoredScrollTop,
        shouldStopGpsOnPause: shouldStopGpsOnPause,
        snapshotFromDom: snapshotFromDom,
        applySnapshot: applySnapshot,
        serialize: serialize,
        deserialize: deserialize,
        merge: merge,
        createGpsController: createGpsController,
        createWakeLockController: createWakeLockController
    };
}));
