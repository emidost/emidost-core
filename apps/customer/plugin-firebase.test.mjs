// Evidence test for plugin-firebase.js: runs the two Gradle text transforms
// against an Expo-SDK-51-style build.gradle fixture and asserts the exact
// Firebase console lines land, idempotently.
import { applyRootGradle, applyAppGradle } from './plugin-firebase.js';

const ROOT_FIXTURE = `// Top-level build file where you can add configuration options common to all sub-projects/modules.
buildscript {
    ext {
        buildToolsVersion = findProperty('android.buildToolsVersion') ?: '34.0.0'
        minSdkVersion = Integer.parseInt(findProperty('android.minSdkVersion') ?: '23')
        compileSdkVersion = Integer.parseInt(findProperty('android.compileSdkVersion') ?: '34')
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath('com.android.tools.build:gradle')
        classpath('com.facebook.react:react-native-gradle-plugin')
    }
}

allprojects {
    repositories {
        maven {
            url(new File(['node', '--print', "require.resolve('expo/package.json')"].execute(null, rootDir).text.trim(), '../android/maven'))
        }
    }
}
`;

const APP_FIXTURE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

def enableProguardInReleaseBuilds = false

android {
    namespace "com.emidost.customer"
    defaultConfig {
        applicationId "com.emidost.customer"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0.0"
    }
}
`;

const rootOnce = applyRootGradle(ROOT_FIXTURE);
const rootTwice = applyRootGradle(rootOnce);
const appOnce = applyAppGradle(APP_FIXTURE);
const appTwice = applyAppGradle(appOnce);

const checks = [
  ['root gains google-services classpath', rootOnce.includes("classpath 'com.google.gms:google-services:4.4.2'")],
  ['root is idempotent', rootOnce === rootTwice],
  ['root classpath sits inside buildscript dependencies', rootOnce.indexOf('classpath') < rootOnce.indexOf('allprojects')],
  ['app gains google-services apply', appOnce.includes("apply plugin: 'com.google.gms.google-services'")],
  ['app is idempotent', appOnce === appTwice],
  ['app apply is a new top-level line at the end', appOnce.trimEnd().endsWith("apply plugin: 'com.google.gms.google-services'")],
];

let fails = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) fails += 1;
}
process.exit(fails === 0 ? 0 : 1);
