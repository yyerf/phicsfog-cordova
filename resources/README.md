# Android artwork release gate

The checked-in launcher and splash resources are generated from the official
512×512 icon published on the app's Google Play listing. The master was retrieved
on 2026-08-30 from the listing for `com.knpn.phicsfog` and has SHA-256:

`2adab31ee556c6fc41a9982cdbd08c95ae286b6133febf8a600b8a0ba8331732`

Before signing 8.2.2:

To regenerate the Android resources:

1. Confirm the icon displayed at
   `https://play.google.com/store/apps/details?id=com.knpn.phicsfog` has not changed.
2. Save its original 512×512 PNG as `resources/android/icon-master.png`.
3. Run `python3 tools/generate-icons.py` with Pillow installed.
4. Inspect legacy, adaptive, monochrome, and splash rendering on a device.

`npm run release` refuses to sign while the official master is missing or too
small. Do not generate or upscale the old low-resolution repository artwork.
