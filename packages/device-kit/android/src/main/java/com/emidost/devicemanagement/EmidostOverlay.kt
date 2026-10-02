package com.emidost.devicemanagement

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Full-screen covers (lock / reminder / app-lock). SYSTEM_ALERT_WINDOW.
 * Falls back to launching the app when the overlay permission is missing.
 */
object EmidostOverlay {
  @Volatile private var view: View? = null
  private val handler = Handler(Looper.getMainLooper())

  fun isShowing(): Boolean = view != null

  fun show(c: Context, mode: String, title: String, body: String, extra: String?) {
    handler.post {
      dismissInternal(c)
      val ctx = c.applicationContext
      try {
        val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val params = WindowManager.LayoutParams(
          WindowManager.LayoutParams.MATCH_PARENT,
          WindowManager.LayoutParams.MATCH_PARENT,
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
          else WindowManager.LayoutParams.TYPE_SYSTEM_ALERT,
          WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
          PixelFormat.TRANSLUCENT,
        )
        params.gravity = Gravity.TOP or Gravity.START

        val root = LinearLayout(ctx).apply {
          orientation = LinearLayout.VERTICAL
          // Ink ramp surface (matches the redesigned lock screen; never pure black)
          setBackgroundColor(Color.parseColor("#161D29"))
          gravity = Gravity.CENTER
          setPadding(48, 48, 48, 48)
        }
        val titleView = TextView(ctx).apply {
          text = title
          setTextColor(Color.parseColor("#F4F1EA"))
          textSize = 26f
          gravity = Gravity.CENTER
        }
        val bodyView = TextView(ctx).apply {
          text = body
          setTextColor(Color.parseColor("#A6AEBE"))
          textSize = 16f
          gravity = Gravity.CENTER
          setPadding(0, 24, 0, 24)
        }
        root.addView(titleView)
        root.addView(bodyView)

        if (mode == "call" && extra != null) {
          val call = Button(ctx).apply {
            text = "Show call screen"
            setTextColor(Color.parseColor("#F4F1EA"))
            setBackgroundColor(Color.parseColor("#4F46E5"))
          }
          call.setOnClickListener {
            dismissInternal(ctx)
            try {
              ctx.startActivity(
                android.content.Intent(android.content.Intent.ACTION_DIAL)
                  .setData(android.net.Uri.parse("tel:$extra"))
                  .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
              )
            } catch (_: Exception) {}
          }
          root.addView(call)
        }

        // The lock cover must never block emergency access.
        if (mode == "lock") {
          val emergency = Button(ctx).apply {
            text = "Emergency 112"
            setTextColor(Color.parseColor("#F4F1EA"))
            setBackgroundColor(Color.parseColor("#B91C1C"))
          }
          emergency.setOnClickListener {
            dismissInternal(ctx)
            try {
              ctx.startActivity(
                android.content.Intent(android.content.Intent.ACTION_DIAL)
                  .setData(android.net.Uri.parse("tel:112"))
                  .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
              )
            } catch (_: Exception) {}
          }
          root.addView(emergency)
        }

        wm.addView(root, params)
        view = root
      } catch (_: Exception) {
        // No overlay permission: fall back to the app's own lock screen.
        DeviceActions.launchApp(ctx)
      }
    }
  }

  fun dismiss(c: Context) {
    handler.post { dismissInternal(c) }
  }

  private fun dismissInternal(c: Context) {
    val v = view ?: return
    try {
      val wm = c.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      wm.removeView(v)
    } catch (_: Exception) {}
    view = null
  }
}
