package com.emidost.devicemanagement

import android.app.WallpaperManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint

/**
 * Reminder wallpaper (SET_WALLPAPER). Renders an EMI reminder bitmap on-device
 * (no upload, works offline) and sets it as the system wallpaper, or clears it
 * back to the default. SET_WALLPAPER is a normal install-time permission.
 */
object EmidostWallpaper {
  fun setReminder(c: Context, text: String): Boolean {
    return try {
      WallpaperManager.getInstance(c).setBitmap(render(text))
      true
    } catch (_: Exception) { false }
  }

  fun clear(c: Context): Boolean {
    return try { WallpaperManager.getInstance(c).clear(); true } catch (_: Exception) { false }
  }

  /** Reminder text composed from cached plan state; used by the command + SMS paths. */
  fun reminderText(c: Context): String {
    val due = SyncStateStore.getDueDate(c)
    val amount = SyncStateStore.getEmiAmount(c)
    val phone = SmsCommandStore.retailerPhone(c)
    val lines = mutableListOf<String>()
    lines.add(if (amount.isNotBlank()) "EMI due: Rs $amount" else "EMI payment due")
    if (due.isNotBlank()) lines.add("Due date $due")
    if (phone.isNotBlank()) lines.add("Call $phone")
    return lines.joinToString("\n")
  }

  private fun render(text: String): Bitmap {
    val w = 1080
    val h = 1920
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    canvas.drawColor(Color.parseColor("#0F141C"))
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.parseColor("#F4F1EA")
      textSize = 56f
      textAlign = Paint.Align.CENTER
    }
    val lines = text.split("\n")
    var y = h / 2f - (lines.size - 1) * 44f
    for (line in lines) {
      canvas.drawText(line, w / 2f, y, paint)
      y += 88f
    }
    return bmp
  }
}
