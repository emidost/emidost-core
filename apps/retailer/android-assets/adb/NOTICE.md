# Vendored AOSP adb client — provenance and integrity

These files are a vendored build of the AOSP `adb` client (Apache-2.0) so the
retailer app can perform the Android wireless-debugging pairing handshake
(SPAKE2 over TLS 1.3, ALPN `adbpair`) on-device. No public Java/Kotlin TLS API
exposes the required PSK mode; running the real adb client is the same approach
Termux uses.

Source: official Termux repository
(https://packages.termux.dev/apt/termux-main), package `android-tools`
version 37.0.0-2 (aarch64) and its runtime library dependencies:
abseil-cpp 20260526.0, brotli 1.2.0, fmt 1:11.2.0-1, libc++ 30, liblz4
1.10.0-1, libprotobuf 2:35.1, pcre2 10.49, zlib 1.3.2, zstd 1.5.7-1
(only the shared libraries that `adb` links were bundled).

License: the adb client is part of the Android Open Source Project
(Apache License 2.0). Each bundled library carries its own upstream license
(zlib, BSD-3, MIT, Apache-2.0); full texts are available in the respective
upstream packages.

Modification: every ELF DT_RUNPATH was patched from the Termux prefix
(`/data/data/com.termux/files/usr/lib`) to origin-relative paths so the bundle
runs from the app's private files dir on any device:
- `adb`: RUNPATH `$ORIGIN/../lib` (expected layout: `.../emidost-adb/bin/adb`
  + `.../emidost-adb/lib/*`)
- all shared libraries: RUNPATH `$ORIGIN`
- `libc++_shared.so` carries no RUNPATH (system-only dependencies).

Runtime layout (extracted by EmidostAdbBridge at first use):
`<filesDir>/emidost-adb/bin/adb` + `<filesDir>/emidost-adb/lib/*`

## SHA-256 (of the shipped, RUNPATH-patched bytes)

```text
eabd694d4004f4e98667c2b6c72622292f17ba318b2fbe13393440858b5f9a8f  adb
```
Full per-file list: `SHA256SUMS` next to this file.

Verification script that produced this bundle (download → extract → dependency
closure → RUNPATH patch): `.review/adb-bin/{extract2,resolve,patch}.py`.
