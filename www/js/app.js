/*
 * PH ICS FOG - application controller.
 *
 * Replaces the old per-fragment inline scripts. Centralizes:
 *  - a single deviceready cascade (no more race where an unavailable
 *    keep-awake plugin blocks the home page)
 *  - navigation (navbar, back button, collapsible anchors)
 *  - the Screen Wake Lock API (replaces the retired keep-awake plugin)
 *  - checklist persistence (stable storage keys)
 *  - the update / expiry dialogs
 *  - the local-only GPS tool on the Tools page
 *  - external links opened as user-initiated Android intents
 *  - cleanup when pages change (stop GPS, hide transient UI)
 */
(function () {
    'use strict';

    var CONFIG = (typeof APP_CONFIG !== 'undefined') ? APP_CONFIG : {};
    var CORE = (typeof APP_CORE !== 'undefined') ? APP_CORE : {};

    var $ = window.jQuery;
    var historyStack = [];
    var currentNode = 'home';
    var gps = null;
    var wakelock = null;
    var pageRequest = null;
    var pageGeneration = 0;
    var embedRequests = [];
    var expiryWarningShown = false;
    var lastBackEventAt = 0;

    // ---------------------------------------------------------------- //
    // Bootstrap: wait for Cordova's deviceready, with a DOM-ready fallback
    // so the app still runs in a plain browser (e.g. for QA / automated
    // checks). Cordova is always the primary path on device.
    // ---------------------------------------------------------------- //
    function onReady() {
        if (!window.PHICSFOG_STARTED) {
            window.PHICSFOG_STARTED = true;
            init();
        }
    }

    document.addEventListener('deviceready', onReady, false);
    document.addEventListener('DOMContentLoaded', function () {
        // If Cordova is present it will fire deviceready shortly after; keep
        // this as a last-resort so the home page always loads even if the
        // deviceready event is somehow lost.
        if (typeof cordova === 'undefined') {
            onReady();
        } else {
            setTimeout(function () {
                if (!window.PHICSFOG_STARTED) { onReady(); }
            }, 4000);
        }
    }, false);

    // ---------------------------------------------------------------- //
    // Init
    // ---------------------------------------------------------------- //
    function init() {
        var validation = CORE.validateAppConfig(CONFIG);
        if (!validation.valid && window.console) {
            console.error('Invalid PH ICS FOG application configuration:', validation.errors.join(', '));
        }
        fillVersion();
        setupWakeLock();
        bindEvents();
        loadPage('home', { pushHistory: true });
        showTransientDialogs();
    }

    function fillVersion() {
        var cfg = CONFIG.versionName || '8.2.2';
        $('.version-label').text('Ver.' + cfg);
    }

    // ---------------------------------------------------------------- //
    // Wake Lock (WebView Screen Wake Lock API, replaces the old keep-awake plugin)
    // ---------------------------------------------------------------- //
    function setupWakeLock() {
        wakelock = CORE.createWakeLockController({
            onStatus: function () { /* fail harmlessly; no-op on device */ }
        });
        wakelock.acquire();
        document.addEventListener('visibilitychange', function () {
            if (wakelock) { wakelock.onVisibilityChange(); }
        }, false);
    }

    // ---------------------------------------------------------------- //
    // Navigation
    // ---------------------------------------------------------------- //

    /**
     * Load a guide page into the main container and run post-load setup.
     * opts.pushHistory - record the page in the back-stack (default true).
     */
    function loadPage(page, opts) {
        opts = opts || {};
        if (typeof page !== 'string' || !/^[A-Za-z0-9]+$/.test(page)) { page = 'home'; }

        // Cleanup before swapping content.
        if (gps && gps.isRunning()) { gps.stop(); }
        gps = null;
        embedRequests.forEach(function (request) {
            if (request && typeof request.abort === 'function') { request.abort(); }
        });
        embedRequests = [];
        if (pageRequest && typeof pageRequest.abort === 'function') { pageRequest.abort(); }
        closeCollapsedNav();

        pageGeneration += 1;
        var generation = pageGeneration;
        var main = $('.main-container');
        main.attr('aria-busy', 'true');
        pageRequest = $.ajax({ url: page + '.html', dataType: 'html', cache: true })
            .done(function (html) {
                if (generation !== pageGeneration) { return; }
                pageRequest = null;
                currentNode = page;
                main.html(html).attr('aria-busy', 'false');
                setupPage(page, opts.target || '');
                if (opts.pushHistory !== false) {
                    historyStack = CORE.pushPage(historyStack, page);
                }
            })
            .fail(function (_xhr, status) {
                if (status === 'abort' || generation !== pageGeneration) { return; }
                pageRequest = null;
                main.attr('aria-busy', 'false').html(
                    '<section class="load-error" role="alert">' +
                    '<h1>Guide page unavailable</h1>' +
                    '<p>This local page could not be opened. No internet connection is required.</p>' +
                    '<button type="button" class="btn btn-primary retry-page" data-page="' + page + '">Try again</button>' +
                    '</section>'
                );
            });
    }

    /** Called after a page fragment is injected. */
    function setupPage(page, target) {
        restoreChecklists();
        setupEmbeddedPages();
        setupAccessibleCollapses();
        setupPageCollapseTarget(target);
        if (page === 'tools') { setupToolsGps(); }
        window.scrollTo(0, 0);
        var main = document.querySelector('.main-container');
        if (main) {
            try { main.focus({ preventScroll: true }); } catch (e) { main.focus(); }
        }
    }

    /** Load an embedded form only when its accordion panel is opened. */
    function loadEmbeddedPage(container) {
        var node = $(container);
        var file = node.attr('data-embed');
        var state = node.data('embed-state');
        if (!file || !/^[A-Za-z0-9]+$/.test(file) || state === 'loaded' || state === 'loading') { return; }
        node.data('embed-state', 'loading').attr('aria-busy', 'true');
        var request = $.ajax({ url: file + '.html', dataType: 'html', cache: true })
            .done(function (html) {
                node.html(html).data('embed-state', 'loaded').attr('aria-busy', 'false');
            })
            .fail(function (_xhr, status) {
                if (status === 'abort') { return; }
                node.data('embed-state', 'error').attr('aria-busy', 'false').html(
                    '<p class="embed-error" role="alert">This form image could not be opened. Close and reopen this section to retry.</p>'
                );
            });
        embedRequests.push(request);
    }

    function setupEmbeddedPages() {
        $('.panel-collapse.in [data-embed]').each(function () { loadEmbeddedPage(this); });
    }

    function setupAccessibleCollapses() {
        $('.panel-heading[data-toggle="collapse"]').each(function () {
            var heading = $(this);
            var target = heading.attr('data-target') || '';
            heading.attr({
                role: 'button',
                tabindex: '0',
                'aria-controls': target.charAt(0) === '#' ? target.slice(1) : '',
                'aria-expanded': heading.hasClass('collapsed') ? 'false' : 'true'
            });
        });
    }

    /** Open the collapse requested by the navigation action. */
    function setupPageCollapseTarget(target) {
        target = CORE.normalizeFragmentTarget(target);
        if (!target) { return; }
        var el = $(target);
        if (el.length) {
            $('.panel-collapse.in').not(el).collapse('hide');
            el.collapse('show');
        }
    }

    /** Hardware back / in-app back button. */
    function goBack() {
        var res = CORE.backPage(historyStack);
        historyStack = res.stack;
        if (res.current && res.current !== 'home') {
            if (res.page) {
                loadPage(res.page, { pushHistory: false });
            } else {
                loadPage('home', { pushHistory: false });
            }
        } else {
            // At the root: ask before leaving the app.
            $('#modal-exit').modal('show');
        }
    }

    /** Handle the Android hardware back button. */
    function onBackButton() {
        var now = Date.now();
        if (CORE.isDuplicateBackEvent(lastBackEventAt, now, 350)) { return; }
        lastBackEventAt = now;
        var modal = $('.modal.in').last();
        if (modal.length) {
            modal.modal('hide');
            return;
        }
        if ($('#myNavbar').hasClass('in')) {
            closeCollapsedNav();
            return;
        }
        goBack();
    }

    function closeCollapsedNav() {
        var nav = $('#myNavbar');
        if (nav.length && nav.hasClass('in')) { nav.collapse('hide'); }
    }

    // ---------------------------------------------------------------- //
    // Checklist persistence
    // ---------------------------------------------------------------- //

    /** Storage key for the current page's checklist container, if any. */
    function activeChecklistKey() {
        var box = document.getElementById('checkbox-container');
        return box ? box.getAttribute('data-storage-key') : null;
    }

    function readStorage(key) {
        try { return window.localStorage.getItem(key); } catch (e) { return null; }
    }

    function writeStorage(key, value) {
        try {
            window.localStorage.setItem(key, value);
            return true;
        } catch (e) {
            return false;
        }
    }

    function removeStorage(key) {
        try { window.localStorage.removeItem(key); } catch (e) { /* continue without persistence */ }
    }

    function storageKeys() {
        var keys = [];
        try {
            for (var i = 0; i < window.localStorage.length; i++) {
                var key = window.localStorage.key(i);
                if (key != null) { keys.push(key); }
            }
        } catch (e) { /* return an empty list */ }
        return keys;
    }

    /** Restore the current page's checkboxes from localStorage. */
    function restoreChecklists() {
        var key = activeChecklistKey();
        if (!key) { return; }
        var stored = CORE.deserialize(readStorage(key));
        CORE.applySnapshot(stored, function (id, checked) {
            var el = document.getElementById(id);
            if (el) { el.checked = checked; }
        });
    }

    /** Persist the current page's checkboxes whenever any of them changes. */
    function onCheckboxChange() {
        var key = activeChecklistKey();
        if (!key) { return; }
        var boxes = document.querySelectorAll('#checkbox-container input[type="checkbox"]');
        var snapshot = CORE.snapshotFromDom(Array.prototype.slice.call(boxes));
        writeStorage(key, CORE.serialize(snapshot));
    }

    /** Remove only checklist keys (never the update/expiry markers). */
    function clearChecklistData() {
        var keys = CORE.collectChecklistKeys(storageKeys());
        keys.forEach(removeStorage);
        // Refresh the current page so cleared boxes reflect in the DOM.
        loadPage(currentNode, { pushHistory: false });
        $('#modal-clear').modal('hide');
    }

    // ---------------------------------------------------------------- //
    // Tools - local GPS display
    // ---------------------------------------------------------------- //

    /** Wire the Tools page GPS button (starts only on explicit user action). */
    function setupToolsGps() {
        if ($('#gps-explain').length) {
            $('#gps-explain').removeClass('hidden');
        }
        gps = CORE.createGpsController({
            geo: (window.navigator && window.navigator.geolocation) || null,
            onStatus: renderGpsStatus
        });
        $('#gps-start').off('click').on('click', function () {
            if (gps) { gps.start({ enableHighAccuracy: true, timeout: 30000 }); }
        });
        $('#gps-stop').off('click').on('click', function () {
            if (gps) { gps.stop(); }
        });
    }

    function renderGpsStatus(status, detail) {
        var msg = $('#gps-status');
        if (!msg.length) { return; }
        var text = '';
        switch (status) {
        case 'requesting': text = 'Waiting for a location fix...'; break;
        case 'active':
            if (detail && detail.coords) {
                text = 'Latitude: ' + detail.coords.latitude +
                    '\nLongitude: ' + detail.coords.longitude +
                    '\nAccuracy radius: ' + Math.round(detail.coords.accuracy) + ' m';
            } else { text = 'Location acquired.'; }
            break;
        case 'denied': text = 'Location permission was denied.'; break;
        case 'unavailable': text = 'Location service is unavailable or unsupported.'; break;
        case 'timeout': text = 'Location request timed out. Try again or enable location services.'; break;
        case 'error': text = 'An error occurred while reading your location.'; break;
        case 'stopped': text = 'Location updates stopped.'; break;
        default: text = '';
        }
        msg.text(text);
        $('#gps-start').toggleClass('hidden', status === 'active' || status === 'requesting');
        $('#gps-stop').toggleClass('hidden', status !== 'active' && status !== 'requesting');
    }

    // ---------------------------------------------------------------- //
    // Event bindings (delegated)
    // ---------------------------------------------------------------- //
    function bindEvents() {
        // Top-level / dropdown nav links.
        $(document).on('click', 'li.linked[data-page] > a', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var item = $(this).closest('li.linked[data-page]');
            var target = CORE.normalizeFragmentTarget($(this).attr('href'));
            var page = item.attr('data-page');
            loadPage(page, { target: target });
            closeCollapsedNav();
        });

        // In-page "other links" that load another page and open a collapse.
        $(document).on('click', 'a.other-link[data-page]', function (e) {
            e.preventDefault();
            var page = $(this).attr('data-page');
            var target = CORE.normalizeFragmentTarget($(this).attr('href'));
            loadPage(page, { target: target });
        });

        $(document).on('click', '.retry-page[data-page]', function () {
            // Failed requests are never added to history, so a successful
            // retry must always add its page (including the initial home page).
            loadPage($(this).attr('data-page'), { pushHistory: true });
        });

        // In-app back button.
        $(document).on('click', '.backbutton', function (e) {
            e.preventDefault();
            goBack();
        });

        $(document).on('keydown', '.panel-heading[data-toggle="collapse"]', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                $(this).trigger('click');
            }
        });

        $(document).on('show.bs.collapse', '.panel-collapse', function () {
            var id = this.id;
            $('[data-target="#' + id + '"]').attr('aria-expanded', 'true').removeClass('collapsed');
            $(this).find('[data-embed]').each(function () { loadEmbeddedPage(this); });
        });

        $(document).on('hidden.bs.collapse', '.panel-collapse', function () {
            var id = this.id;
            $('[data-target="#' + id + '"]').attr('aria-expanded', 'false').addClass('collapsed');
        });

        // Keep the heading that was activated fully visible below the fixed
        // app bar. Measure the live bar instead of assuming one portrait/text
        // size, and avoid forced motion when the user requests reduced motion.
        $(document).on('shown.bs.collapse', '.panel-collapse', function () {
            var panel = $(this);
            var trigger = panel.prev('[data-toggle="collapse"]');
            if (!trigger.length) {
                trigger = panel.closest('.panel').find('[data-toggle="collapse"]').first();
            }
            var anchor = (trigger.length && trigger.offset()) ? trigger : panel;
            if (anchor.length && anchor.offset()) {
                var header = $('.navbar-fixed-top:visible').first();
                var top = CORE.anchoredScrollTop(
                    anchor.offset().top,
                    header.length ? header.outerHeight() : 0,
                    12
                );
                if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    window.scrollTo(0, top);
                } else {
                    $('html, body').stop(true).animate({ scrollTop: top }, 250);
                }
            }
        });

        $(document).on('click', '.navbar-collapse.in', function (e) {
            var t = $(e.target);
            if (t.is('a') && !t.hasClass('dropdown-toggle')) {
                $(this).collapse('hide');
            }
        });

        // Checklist persistence.
        $(document).on('change', '#checkbox-container input[type="checkbox"]', onCheckboxChange);

        // Clear Data (checklist keys only).
        $(document).on('click', '#btnYesClear', clearChecklistData);

        // Exit confirmation.
        $(document).on('click', '#btnYesExit', function () {
            exitApp();
        });

        // Update dialog buttons. The Update action is an ordinary allow-listed
        // anchor so Cordova opens the Android intent directly from the user's tap.
        $(document).on('click', '#btnContinue', function () {
            $('#modal-expiry').modal('hide');
        });
        $(document).on('click', '#btnUpdateNoticeOK', function () {
            $('#modal-update').modal('hide');
        });

        // Android hardware back button.
        document.addEventListener('backbutton', onBackButton, false);

        // Pause cleanup: stop the GPS watch so no scanning continues off-screen.
        document.addEventListener('pause', function () {
            // The Android permission sheet also pauses this activity. A watch
            // in REQUESTING state has not acquired a location yet, so leave
            // that one native request intact and let its result callback run.
            // Once ACTIVE, every real pause stops it immediately.
            if (gps && gps.isRunning() && CORE.shouldStopGpsOnPause(gps.status())) {
                gps.stop();
            }
            if (wakelock) { wakelock.release(); }
        }, false);
        document.addEventListener('resume', function () {
            if (wakelock) { wakelock.acquire(); }
        }, false);
    }

    function exitApp() {
        if (gps && gps.isRunning()) { gps.stop(); }
        if (wakelock) { wakelock.release(); }
        if (window.navigator.app && typeof window.navigator.app.exitApp === 'function') {
            window.navigator.app.exitApp();
        } else if (window.close) {
            window.close();
        }
    }

    // ---------------------------------------------------------------- //
    // Transient dialogs (update notice + post-expiry warning)
    // ---------------------------------------------------------------- //
    function showTransientDialogs() {
        var expired = CORE.expiryStatus(CONFIG.expiresAt) === 'expired';
        if (expired) {
            // Show the update warning once per cold launch. Update or Continue;
            // the offline guide is NEVER locked or terminated.
            if (!expiryWarningShown) {
                expiryWarningShown = true;
                $('#modal-expiry').modal('show');
            }
        } else if (!readStorage(CORE.UPDATE_NOTICE_KEY)) {
            writeStorage(CORE.UPDATE_NOTICE_KEY, '1');
            $('#modal-update').modal('show');
        }
    }

    // ---------------------------------------------------------------- //
    // Start
    // ---------------------------------------------------------------- //
    if (typeof cordova === 'undefined' && document.readyState === 'complete') {
        onReady();
    }
}());
