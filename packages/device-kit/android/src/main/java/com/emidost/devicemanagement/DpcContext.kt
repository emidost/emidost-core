package com.emidost.devicemanagement

import android.content.Context
import android.os.Build

/**
 * Device-protected storage wrapper. createDeviceProtectedStorageContext()
 * exists only on API 24+; on older devices (minSdk 23) fall back to the
 * plain context so the stores never crash on NoSuchMethodError.
 */
object DpcContext {
  fun wrap(c: Context): Context =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) c.createDeviceProtectedStorageContext() else c
}
