// Retailer-only config plugin: copies the vendored AOSP adb client bundle
// (apps/retailer/android-assets/adb/{adb,lib/*,NOTICE.md,SHA256SUMS},
// Termux android-tools 37.0.0-2 aarch64, RUNPATH patched origin-relative)
// into the android project's app/src/main/assets/adb/ at prebuild, so the
// device-kit bridge can read the binary and its library closure by asset
// name at runtime.
//
// The customer app deliberately does NOT register this plugin: the customer
// APK must never carry an adb client. EmidostAdbBridge reports
// "adb binary missing" there, honestly.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = function withAdbAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'android-assets', 'adb');
      const dest = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        'adb',
      );
      if (!fs.existsSync(src)) {
        throw new Error(`adb assets missing at ${src}; run the lead's fetch/patch step first`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true, force: true });
      return cfg;
    },
  ]);
};
