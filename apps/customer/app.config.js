// apps/customer/app.config.js
// Dynamic layer over app.json. app.json is static JSON and cannot read
// process.env, so the one build-time value that must come from the environment
// lives here: the Android google-services.json path.
//
// On EAS it comes from the GOOGLE_SERVICES_JSON file env var (see SETUP.md);
// for a local prebuild it falls back to the gitignored
// apps/customer/google-services.json. The ./plugin-firebase config plugin
// applies the com.google.gms.google-services Gradle plugin, and this field is
// what actually copies the JSON to android/app/google-services.json at prebuild
// so that plugin can find it (its absence is what failed the first EAS build:
// ":app:processReleaseGoogleServices > File google-services.json is missing").
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './google-services.json',
  },
});
