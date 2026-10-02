// Expo config plugin: declares the DeviceAdminReceiver, accessibility service,
// foreground service, and permissions in the consuming app's manifest, and
// applies the app label ("wifi" for the customer app is set in its app.json).
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withEmidostDeviceKit(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    const receivers = app.receiver ?? [];
    const services = app.service ?? [];

    const has = (list, name) => list.some((n) => n.$?.['android:name'] === name);

    if (!has(receivers, 'com.emidost.devicemanagement.EmidostDeviceAdminReceiver')) {
      receivers.push({
        $: {
          'android:name': 'com.emidost.devicemanagement.EmidostDeviceAdminReceiver',
          'android:permission': 'android.permission.BIND_DEVICE_ADMIN',
          'android:exported': 'true',
        },
        'meta-data': [{
          $: { 'android:name': 'android.app.device_admin', 'android:resource': '@xml/emidost_device_admin' },
        }],
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.app.action.DEVICE_ADMIN_ENABLED' } }],
        }],
      });
    }
    if (!has(receivers, 'com.emidost.devicemanagement.EmidostBootReceiver')) {
      receivers.push({
        $: {
          'android:name': 'com.emidost.devicemanagement.EmidostBootReceiver',
          'android:exported': 'true',
          'android:directBootAware': 'true',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }] },
          { action: [{ $: { 'android:name': 'android.intent.action.LOCKED_BOOT_COMPLETED' } }] },
          { action: [{ $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } }] },
        ],
      });
    }
    if (!has(receivers, 'com.emidost.devicemanagement.EmidostSmsReceiver')) {
      receivers.push({
        $: {
          'android:name': 'com.emidost.devicemanagement.EmidostSmsReceiver',
          'android:exported': 'true',
          'android:permission': 'android.permission.BROADCAST_SMS',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }] }],
      });
    }
    if (!has(receivers, 'com.emidost.devicemanagement.EmidostSimSentinelReceiver')) {
      receivers.push({
        $: {
          'android:name': 'com.emidost.devicemanagement.EmidostSimSentinelReceiver',
          'android:exported': 'true',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.intent.action.SIM_STATE_CHANGED' } }] },
          { action: [{ $: { 'android:name': 'android.intent.action.AIRPLANE_MODE_CHANGED' } }] },
        ],
      });
    }
    if (!has(services, 'com.emidost.devicemanagement.EmidostCommandService')) {
      services.push({
        $: {
          'android:name': 'com.emidost.devicemanagement.EmidostCommandService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
        },
      });
    }
    if (!has(services, 'com.emidost.devicemanagement.EmidostAccessibilityService')) {
      services.push({
        $: {
          'android:name': 'com.emidost.devicemanagement.EmidostAccessibilityService',
          'android:exported': 'false',
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
          'android:label': '@string/emidost_a11y_label',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] }],
        'meta-data': [{
          $: {
            'android:name': 'android.accessibilityservice',
            'android:resource': '@xml/emidost_accessibility',
          },
        }],
      });
    }

    app.receiver = receivers;
    app.service = services;
    return cfg;
  });
};
