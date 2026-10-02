// Retailer-only config plugin: copies the COMPRESSED adb client bundle
// (adb-bundle.zip, ZIP_DEFLATED level 9, containing bin/adb + lib/*.so,
// Termux android-tools 37.0.0-2 aarch64, RUNPATH patched origin-relative)
// plus its provenance files (NOTICE.md, SHA256SUMS) into the android
// project's app/src/main/assets/adb/ at prebuild. The loose adb/lib
// directory is no longer shipped; EmidostAdbBridge unzips the bundle into
// its files dir on first use (with the loose-asset path kept as a fallback).
//
// The customer app deliberately does NOT register this plugin: the customer
// APK must never carry an adb client. EmidostAdbBridge reports
// "adb binary missing" there, honestly.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const SHIPPED_FILES = ['adb-bundle.zip', 'NOTICE.md', 'SHA256SUMS'];

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
      for (const f of SHIPPED_FILES) {
        const from = path.join(src, f);
        if (!fs.existsSync(from)) {
          throw new Error(`adb asset missing at ${from}; run the lead's fetch/pack step first`);
        }
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(from, path.join(dest, f));
      }
      return cfg;
    },
  ]);
};
