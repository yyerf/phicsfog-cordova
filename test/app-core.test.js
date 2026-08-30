'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../www/js/app-core.js');
const GEOLOCATION_PATCH = require('../scripts/patch-geolocation-approximate.js');

// ---------------------------------------------------------------- //
// Expiry
// ---------------------------------------------------------------- //
test('expiryStatus: valid before expiry', () => {
    assert.strictEqual(C.expiryStatus('2027-12-31T23:59:59+08:00', '2026-08-29T00:00:00Z'), 'valid');
});
test('expiryStatus: expired at expiry instant', () => {
    // 2027-12-31 23:59:59 +08:00 == 2027-12-31 15:59:59Z
    assert.strictEqual(C.expiryStatus('2027-12-31T23:59:59+08:00', '2027-12-31T15:59:59Z'), 'expired');
});
test('expiryStatus: expired after expiry', () => {
    assert.strictEqual(C.expiryStatus('2027-12-31T23:59:59+08:00', '2028-01-01T00:00:00Z'), 'expired');
});
test('expiryStatus: rejects invalid dates', () => {
    assert.strictEqual(C.expiryStatus('not-a-date', '2026-08-29T00:00:00Z'), 'invalid');
    assert.strictEqual(C.expiryStatus('2027-12-31T23:59:59+08:00', 'not-a-date'), 'invalid');
});

test('application configuration validates required identity and URLs', () => {
    const config = require('../www/js/app-config.js');
    assert.deepStrictEqual(C.validateAppConfig(config), { valid: true, errors: [] });
    const invalid = Object.assign({}, config, { appId: 'example.invalid', expiresAt: 'never' });
    const result = C.validateAppConfig(invalid);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.includes('invalid appId'));
    assert.ok(result.errors.includes('invalid expiresAt'));
});

// ---------------------------------------------------------------- //
// Checklist keys
// ---------------------------------------------------------------- //
test('isChecklistKey / collectChecklistKeys filter', () => {
    assert.ok(C.isChecklistKey('OSCcheckboxValues'));
    assert.ok(!C.isChecklistKey('hasShownUpdateNotice822'));
    const filtered = C.collectChecklistKeys(['OSCcheckboxValues', 'junk', 'LSCcheckboxValues', 'expiry-dialog-marker']);
    assert.deepStrictEqual(filtered, ['OSCcheckboxValues', 'LSCcheckboxValues']);
});
test('all legacy checklist keys are preserved', () => {
    [
        'checkboxValues', 'CRcheckboxValues', 'FASCcheckboxValues', 'ICcheckboxValues',
        'IIScheckboxValues', 'LSCcheckboxValues', 'OSCcheckboxValues', 'PAGcheckboxValues',
        'PSCcheckboxValues'
    ].forEach((k) => assert.ok(C.isChecklistKey(k), k));
});

// ---------------------------------------------------------------- //
// Navigation history
// ---------------------------------------------------------------- //
test('pushPage/backPage basic', () => {
    let stack = [];
    stack = C.pushPage(stack, 'home');
    stack = C.pushPage(stack, 'about');
    stack = C.pushPage(stack, 'tools');
    const back = C.backPage(stack);
    assert.strictEqual(back.current, 'tools');
    assert.strictEqual(back.page, 'about');
    assert.deepStrictEqual(back.stack, ['home', 'about']);
});
test('backPage at root returns empty', () => {
    const r = C.backPage(['home']);
    assert.strictEqual(r.current, 'home');
    assert.strictEqual(r.page, '');
    assert.deepStrictEqual(r.stack, []);
});
test('pushPage does not duplicate the current page', () => {
    assert.deepStrictEqual(C.pushPage(['home', 'tools'], 'tools'), ['home', 'tools']);
});
test('fragment targets reject inert or unsafe jQuery selectors', () => {
    assert.strictEqual(C.normalizeFragmentTarget('#collapse4'), '#collapse4');
    assert.strictEqual(C.normalizeFragmentTarget(' #section.one '), '#section.one');
    assert.strictEqual(C.normalizeFragmentTarget('#'), '');
    assert.strictEqual(C.normalizeFragmentTarget(''), '');
    assert.strictEqual(C.normalizeFragmentTarget('#[invalid'), '');
    assert.strictEqual(C.normalizeFragmentTarget('https://example.com/#collapse4'), '');
});
test('duplicate hardware-back events are debounced per native gesture', () => {
    assert.strictEqual(C.isDuplicateBackEvent(0, 1000, 350), false);
    assert.strictEqual(C.isDuplicateBackEvent(1000, 1001, 350), true);
    assert.strictEqual(C.isDuplicateBackEvent(1000, 1349, 350), true);
    assert.strictEqual(C.isDuplicateBackEvent(1000, 1350, 350), false);
});
test('accordion scroll keeps its heading below the measured fixed header', () => {
    assert.strictEqual(C.anchoredScrollTop(129, 63, 12), 54);
    assert.strictEqual(C.anchoredScrollTop(60, 63, 12), 0);
    assert.strictEqual(C.anchoredScrollTop(100, -10, -4), 100);
    assert.strictEqual(C.anchoredScrollTop('invalid', 63, 12), 0);
});
test('GPS pause cleanup leaves the native permission request intact', () => {
    assert.strictEqual(C.shouldStopGpsOnPause(C.GPS_STATUS.REQUESTING), false);
    assert.strictEqual(C.shouldStopGpsOnPause(C.GPS_STATUS.ACTIVE), true);
    assert.strictEqual(C.shouldStopGpsOnPause(C.GPS_STATUS.STOPPED), false);
});
test('Android 12+ approximate-location patch is guarded and idempotent', () => {
    const source = [
        '            if(hasPermisssion(permissionsToCheck))',
        '        if(context != null) {',
        '            for (int i=0; i<grantResults.length; i++) {'
    ].join('\n') + '\n';
    const patched = GEOLOCATION_PATCH.patchSource(source);
    assert.match(patched, /Build\.VERSION_CODES\.S/);
    assert.match(patched, /ACCESS_COARSE_LOCATION/);
    assert.strictEqual(GEOLOCATION_PATCH.patchSource(patched), patched);
});

// ---------------------------------------------------------------- //
// Checklist serialization
// ---------------------------------------------------------------- //
test('snapshotFromDom and applySnapshot round-trip', () => {
    const dom = [{ id: 'a', checked: true }, { id: 'b', checked: false }];
    const snap = C.snapshotFromDom(dom);
    assert.deepStrictEqual(snap, { a: true, b: false });
    const applied = {};
    C.applySnapshot(snap, (id, checked) => { applied[id] = checked; });
    assert.deepStrictEqual(applied, { a: true, b: false });
});
test('serialize/deserialize round-trip and bad input', () => {
    assert.deepStrictEqual(C.deserialize(C.serialize({ x: 1 })), { x: 1 });
    assert.deepStrictEqual(C.deserialize('not json'), {});
    assert.deepStrictEqual(C.deserialize(null), {});
});
test('merge lets DOM win and keeps stored keys', () => {
    const merged = C.merge({ a: true, b: false }, { a: false });
    assert.deepStrictEqual(merged, { a: false, b: false });
});

// ---------------------------------------------------------------- //
// GPS controller
// ---------------------------------------------------------------- //
function fakeGeo() {
    const callbacks = { getSuccess: null, getError: null, watchSuccess: null, watchError: null };
    const geo = {
        cleared: [],
        lastWatch: null,
        getCurrentPosition(s, e) { callbacks.getSuccess = s; callbacks.getError = e; },
        watchPosition(s, e) { callbacks.watchSuccess = s; callbacks.watchError = e; geo.lastWatch = 7; return 7; },
        clearWatch(id) { geo.cleared.push(id); geo.lastWatch = null; }
    };
    return { geo, callbacks };
}

function statusRecorder() {
    const out = [];
    return { out, cb: (s) => out.push(s) };
}

test('GPS: start requests one watch, active on success', () => {
    const { geo, callbacks } = fakeGeo();
    const rec = statusRecorder();
    const gps = C.createGpsController({ geo, onStatus: rec.cb });
    assert.strictEqual(gps.start(), true);
    assert.strictEqual(gps.isRunning(), true);
    assert.strictEqual(rec.out[0], 'requesting');
    callbacks.watchSuccess({ coords: { latitude: 10, longitude: 122, accuracy: 5 } });
    assert.strictEqual(rec.out.includes('active'), true);
    assert.strictEqual(gps.lastPosition().coords.latitude, 10);
    assert.strictEqual(rec.out.includes('stopped'), false);
    assert.strictEqual(callbacks.getSuccess, null);
});
test('GPS: unsupported (no geo) reports unavailable and returns false', () => {
    const rec = statusRecorder();
    const gps = C.createGpsController({ geo: null, onStatus: rec.cb });
    assert.strictEqual(gps.start(), false);
    assert.strictEqual(rec.out.includes('unavailable'), true);
});
test('GPS: denied codes to denied status', () => {
    const { geo, callbacks } = fakeGeo();
    const rec = statusRecorder();
    const gps = C.createGpsController({ geo, onStatus: rec.cb });
    gps.start();
    callbacks.watchError({ code: 1 });
    assert.strictEqual(rec.out.includes('denied'), true);
    assert.strictEqual(gps.isRunning(), false);
    assert.deepStrictEqual(geo.cleared, [7]);
});
test('GPS: timeout and unavailable codes', () => {
    const { geo, callbacks } = fakeGeo();
    const rec = statusRecorder();
    const gps = C.createGpsController({ geo, onStatus: rec.cb });
    gps.start();
    callbacks.watchError({ code: 3 });
    assert.strictEqual(rec.out.includes('timeout'), true);
    assert.strictEqual(gps.isRunning(), false);
    const g2 = fakeGeo();
    const rec2 = statusRecorder();
    const gps2 = C.createGpsController({ geo: g2.geo, onStatus: rec2.cb });
    gps2.start();
    g2.callbacks.watchError({ code: 2 });
    assert.strictEqual(rec2.out.includes('unavailable'), true);
    assert.strictEqual(gps2.isRunning(), false);
});
test('GPS: repeated Start does not create a second watch', () => {
    const { geo } = fakeGeo();
    let watches = 0;
    const original = geo.watchPosition;
    geo.watchPosition = (...args) => { watches++; return original(...args); };
    const gps = C.createGpsController({ geo });
    assert.strictEqual(gps.start(), true);
    assert.strictEqual(gps.start(), true);
    assert.strictEqual(watches, 1);
});
test('GPS: synchronous WebView failure is reported and stopped', () => {
    const rec = statusRecorder();
    const gps = C.createGpsController({
        geo: { watchPosition() { throw new Error('provider failed'); }, clearWatch() {} },
        onStatus: rec.cb
    });
    assert.strictEqual(gps.start(), false);
    assert.strictEqual(gps.isRunning(), false);
    assert.ok(rec.out.includes('error'));
});
test('GPS: stop clears the watch and stops updates', () => {
    const { geo, callbacks } = fakeGeo();
    const rec = statusRecorder();
    const gps = C.createGpsController({ geo, onStatus: rec.cb });
    gps.start();
    assert.strictEqual(geo.lastWatch, 7);
    gps.stop();
    assert.deepStrictEqual(geo.cleared, [7]);
    assert.strictEqual(gps.isRunning(), false);
    assert.strictEqual(rec.out.includes('stopped'), true);
    // late success after stop is ignored (no re-emit of active)
    const before = rec.out.filter((s) => s === 'active').length;
    callbacks.watchSuccess({ coords: { latitude: 1, longitude: 1, accuracy: 1 } });
    assert.strictEqual(rec.out.filter((s) => s === 'active').length, before);
});

// ---------------------------------------------------------------- //
// Wake Lock controller
// ---------------------------------------------------------------- //
test('wake lock: unsupported when no request fn', async () => {
    const rec = statusRecorder();
    const wl = C.createWakeLockController({ requestWakeLock: null, onStatus: rec.cb });
    assert.strictEqual(wl.isSupported(), false);
    assert.strictEqual(wl.status(), 'unsupported');
    assert.strictEqual(await wl.acquire(), false);
});
test('wake lock: acquire active and re-acquire on visibility regain', async () => {
    let visible = true;
    const rec = statusRecorder();
    let requests = 0;
    const fakeReq = () => { requests++; return Promise.resolve({ release() { rec.out.push('released-internal'); }, addEventListener() {} }); };
    const wl = C.createWakeLockController({
        requestWakeLock: fakeReq,
        isVisible: () => visible,
        onStatus: rec.cb
    });
    assert.strictEqual(await wl.acquire(), true);
    assert.strictEqual(rec.out.includes('active'), true);
    // hide -> suspend; visible again -> re-acquire
    visible = false;
    wl.onVisibilityChange();
    assert.strictEqual(rec.out.includes('hidden'), true);
    visible = true;
    wl.onVisibilityChange();
    await wl.acquire();
    assert.strictEqual(requests, 2);
    assert.strictEqual(rec.out.includes('active'), true);
});
test('wake lock: acquire hidden returns false without requesting', async () => {
    let requests = 0;
    const wl = C.createWakeLockController({
        requestWakeLock: () => { requests++; return Promise.resolve({}); },
        isVisible: () => false
    });
    assert.strictEqual(await wl.acquire(), false);
    assert.strictEqual(requests, 0);
    assert.strictEqual(wl.status(), 'hidden');
});
test('wake lock: rejected request -> denied, fails harmlessly', async () => {
    const rec = statusRecorder();
    const wl = C.createWakeLockController({
        requestWakeLock: () => Promise.reject(new Error('denied')),
        onStatus: rec.cb
    });
    assert.strictEqual(await wl.acquire(), false);
    assert.strictEqual(rec.out.includes('denied'), true);
});
test('wake lock: a request resolving after visibility loss is released, not activated', async () => {
    let visible = true;
    let resolveRequest;
    let releases = 0;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const wl = C.createWakeLockController({
        requestWakeLock: () => request,
        isVisible: () => visible
    });
    const acquiring = wl.acquire();
    await Promise.resolve();
    visible = false;
    wl.onVisibilityChange();
    resolveRequest({ release() { releases++; }, addEventListener() {} });
    assert.strictEqual(await acquiring, false);
    assert.strictEqual(releases, 1);
    assert.strictEqual(wl.status(), 'hidden');
});
