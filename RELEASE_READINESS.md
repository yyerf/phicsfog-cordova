# PH ICS FOG 8.2.2 release readiness

Automated checks deliberately do not claim to prove external facts. A signed
release remains blocked until every item below has evidence recorded by the
release owner.

## Required before signing

- [ ] Add the authoritative 8.2.0 source and record its origin/date or commit.
- [ ] Diff every guide page and asset against this workspace; carry forward all
      8.2.0 content before accepting any 8.2.2 functional edit.
- [x] Retrieved the official 512×512 artwork from the public Google Play listing
      on 2026-08-30, saved it as `resources/android/icon-master.png`, regenerated
      legacy/adaptive/monochrome/splash resources, and visually inspected them.
      The source checksum is recorded in `resources/README.md`.
- [x] Kept the upload keystore outside the repository at
      `/home/yyerf/phicsfog-release/knpn.jks`; it is byte-identical to the old
      tracked key and contains alias `knpn`.
- [ ] Confirm that Play Console > App integrity > Upload key certificate is
      `37:23:2C:81:7D:51:D3:D9:38:F1:0F:3B:F3:E1:E0:4F:21:BF:39:96:0E:46:AE:D6:22:E7:98:D3:82:FE:44:BE`,
      then copy that value into the ignored `build.release.json`.
- [ ] Confirm in Play Console that 80202 exceeds every active, draft, internal,
      closed, open, and production artifact.
- [ ] Publish `privacy-policy.html` through GitHub Pages and verify the public URL.
      It returned HTTP 404 when checked on 2026-08-30.

## Play Console gates

- [ ] Replace the public listing's obsolete `https://phicsfog.glitch.me/` privacy
      URL with `https://yyerf.github.io/phicsfog-cordova/privacy-policy.html`.
      The old URL was still visible on the public listing on August 30, 2026.
- [ ] Update the description so it no longer implies that the guide becomes
      unusable after a limited period; 8.2.2 only displays a dismissible warning.
- [ ] Review the just-in-time foreground-location disclosure and declare only
      approximate/precise foreground location access.
- [ ] Re-submit Data Safety as no data collected and no data shared only after
      checking the final signed artifact and observed WebView traffic.
- [ ] If a safe upload cannot be completed by August 31, request the available
      target-API extension to November 1 in Play Console immediately.

## Required validation evidence

- [x] On 2026-08-30, all 26 source/static tests, the exact toolchain check, and
      artifact verification passed. The installable debug-signed QA APK reports
      `com.knpn.phicsfog`, 8.2.2/80202, min 24, target 36, the expected foreground
      location permissions only, and a valid APK signature.

- [ ] Run `npm ci`, `npm test`, `npm run prepare:android`, and `npm run debug` from
      a clean checkout using Node 22, JDK 17, Platform 36, and Build Tools 36.0.0.
- [ ] Complete device/emulator QA on API 24, 30, 33, 35, and 36, including
      rotation, gestures/back, system bars, offline use, forms, and process restart.
- [ ] Observe WebView traffic and confirm no requests occur except user-selected
      links that leave the app.
- [ ] Install the current Play production 8.2.0, create checklist progress, then
      upgrade through Play internal testing and confirm the progress survives.
- [ ] Upload the verified signed AAB to Internal testing and clear Play's
      pre-launch report before a 10% / 50% / 100% staged rollout.

## Security note

The old upload key and plaintext password remain exposed in Git history because
history will not be rewritten. Keeping that key is an explicit risk decision; an
upload-key reset in Play Console is the only complete remediation.
