package expo.modules.ringtones

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class RingtonesPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(AlarmActivityListener())
}

// When the app is opened BY an alarm (pillreminder://alarm…), let it show over
// the lock screen and wake the display — what makes the full-screen alarm
// actually visible on a locked phone. Opened any other way, it never does, so
// the app is not exposed on the lock screen; releaseLockScreen() undoes it
// once the alarm screen closes.
class AlarmActivityListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    current = WeakReference(activity)
    apply(activity, activity.intent)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    current?.get()?.let { apply(it, intent) }
    return false
  }

  companion object {
    private var current: WeakReference<Activity>? = null

    private fun isAlarm(intent: Intent?): Boolean {
      val data = intent?.data ?: return false
      return data.scheme == "pillreminder" && data.host == "alarm"
    }

    fun apply(activity: Activity, intent: Intent?) {
      if (!isAlarm(intent)) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(true)
        activity.setTurnScreenOn(true)
      } else {
        @Suppress("DEPRECATION")
        activity.window.addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
      }
    }

    fun release(activity: Activity) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(false)
        activity.setTurnScreenOn(false)
      } else {
        @Suppress("DEPRECATION")
        activity.window.clearFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
      }
    }
  }
}
