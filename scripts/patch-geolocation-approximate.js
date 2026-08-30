'use strict';

/*
 * cordova-plugin-geolocation 5.0.0 treats Android 12+'s user-selected
 * approximate permission as a complete denial when enableHighAccuracy is
 * requested. Patch the generated, disposable Android source after prepare so
 * COARSE remains a valid foreground grant while FINE stays optional. The
 * exact-string guards intentionally fail a build if the pinned plugin source
 * changes, rather than silently producing an unpatched release.
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'PHICS FOG: accept Android approximate foreground location';

function patchSource(source) {
    if (source.includes(MARKER)) { return source; }

    const permissionCheck = '            if(hasPermisssion(permissionsToCheck))\n';
    const patchedPermissionCheck =
        '            // ' + MARKER + '\n' +
        '            boolean hasApproximatePermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&\n' +
        '                    PermissionHelper.hasPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION);\n' +
        '            if(hasPermisssion(permissionsToCheck) || hasApproximatePermission)\n';

    const resultStart = '        if(context != null) {\n' +
        '            for (int i=0; i<grantResults.length; i++) {\n';
    const patchedResultStart = '        if(context != null) {\n' +
        '            // ' + MARKER + '\n' +
        '            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&\n' +
        '                    PermissionHelper.hasPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)) {\n' +
        '                result = new PluginResult(PluginResult.Status.OK, Build.VERSION.SDK_INT);\n' +
        '                context.sendPluginResult(result);\n' +
        '                return;\n' +
        '            }\n' +
        '            for (int i=0; i<grantResults.length; i++) {\n';

    if (!source.includes(permissionCheck) || !source.includes(resultStart)) {
        throw new Error('Pinned cordova-plugin-geolocation source did not match the expected 5.0.0 implementation.');
    }
    return source.replace(permissionCheck, patchedPermissionCheck)
        .replace(resultStart, patchedResultStart);
}

function patchApproximateLocation(context) {
    const platforms = (context.opts && context.opts.platforms) || [];
    if (!platforms.includes('android')) { return; }

    const javaFile = path.join(
        context.opts.projectRoot,
        'platforms', 'android', 'app', 'src', 'main', 'java',
        'org', 'apache', 'cordova', 'geolocation', 'Geolocation.java'
    );
    if (!fs.existsSync(javaFile)) {
        throw new Error('Generated cordova-plugin-geolocation Android source was not found during after_prepare.');
    }
    const source = fs.readFileSync(javaFile, 'utf8');
    const updated = patchSource(source);
    if (updated !== source) { fs.writeFileSync(javaFile, updated, 'utf8'); }
}

patchApproximateLocation.patchSource = patchSource;
module.exports = patchApproximateLocation;
