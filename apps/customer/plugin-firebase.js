// apps/customer/plugin-firebase.js
// Managed-Expo equivalent of the Firebase console's Gradle instructions.
// expo-notifications already bundles firebase-messaging:24.0.1 and the FCM
// manifest metadata, but it does NOT apply the google-services Gradle plugin,
// so google-services.json values would never reach the Firebase SDK at
// runtime ("Default FirebaseApp is not initialized"). This plugin injects
// the two Gradle lines into the files Expo prebuild generates, idempotently,
// so EAS/local prebuilds get a working FCM setup every time.
//
// BoM is deliberately NOT added: the only Firebase product used is
// firebase-messaging, which arrives via expo-notifications (24.0.1). The BoM
// becomes relevant only if we later add direct Firebase SDKs (e.g. raw FCM
// HTTP v1 sending instead of the Expo Push Service).

const { withProjectBuildGradle, withAppBuildGradle } = require('expo/config-plugins');

const ROOT_CLASSPATH = "classpath 'com.google.gms:google-services:4.4.2'";
const APP_APPLY = "apply plugin: 'com.google.gms.google-services'";

/** Inject the google-services classpath into a root build.gradle (Groovy). */
function applyRootGradle(contents) {
  if (contents.includes('com.google.gms:google-services') || contents.includes('com.google.gms.google-services')) return contents;
  const marker = 'buildscript {';
  const idx = contents.indexOf(marker);
  if (idx === -1) return contents; // unexpected template; leave untouched
  const deps = contents.indexOf('dependencies {', idx);
  if (deps === -1) return contents;
  const insertAt = contents.indexOf('\n', deps) + 1;
  return contents.slice(0, insertAt) + `        ${ROOT_CLASSPATH}\n` + contents.slice(insertAt);
}

/** Apply the google-services plugin in the app-level build.gradle. */
function applyAppGradle(contents) {
  if (contents.includes('com.google.gms.google-services')) return contents;
  return contents.replace(/\s*$/, '') + `\n\n${APP_APPLY}\n`;
}

module.exports = function withFirebase(config) {
  config = withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyRootGradle(cfg.modResults.contents);
    return cfg;
  });
  config = withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyAppGradle(cfg.modResults.contents);
    return cfg;
  });
  return config;
};

module.exports.applyRootGradle = applyRootGradle;
module.exports.applyAppGradle = applyAppGradle;
