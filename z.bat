del phicsfog.apk
copy ".\platforms\android\app\build\outputs\apk\release\app-release-unsigned.apk" .
zipalign -v 4 app-release-unsigned.apk phicsfog.apk
