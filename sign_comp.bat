set path=%path%;E:\other drive\drived\xampp\htdocs\cordova\phicsfog\node_modules\cordova\bin
cordova build android --release -- --keystore=knpn.jks --storePassword=N@k@l1m0tk0 --alias=knpn --password=nakalim0tk0 --packageType=apk
del phicsfog.apk
copy .\platforms\android\app\build\outputs\apk\release\app-release.apk .\phicsfog.apk

