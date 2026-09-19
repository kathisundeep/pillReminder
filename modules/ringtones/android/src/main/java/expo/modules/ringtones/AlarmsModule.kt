package expo.modules.ringtones

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

// The app's medicine alarms, rung by the phone itself. See AlarmScheduler,
// AlarmNotifier and AlarmReceiver.
class AlarmsModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("PillAlarms")

    // Replaces every repeating alarm with this list (JSON array). Pending
    // one-shot snoozes are kept: the user asked for them.
    Function("setRepeatingAlarms") { json: String ->
      val incoming = JSONArray(json).let { arr ->
        (0 until arr.length()).map { Alarm.fromJson(arr.getJSONObject(it)).copy(oneShotAt = 0L) }
      }
      val store = AlarmStore(context)
      val (oneShots, repeating) = store.all().partition { it.isOneShot }
      repeating.forEach { AlarmScheduler.cancel(context, it.id) }
      store.save(oneShots + incoming)
      incoming.forEach { AlarmScheduler.schedule(context, it) }
      AlarmNotifier.ensureChannels(context)
      incoming.size
    }

    // A single alarm at an exact moment (JSON object with oneShotAt).
    Function("addOneShot") { json: String ->
      val alarm = Alarm.fromJson(JSONObject(json))
      AlarmStore(context).put(alarm)
      AlarmScheduler.schedule(context, alarm)
      alarm.id
    }

    Function("cancelAll") {
      val store = AlarmStore(context)
      store.all().forEach { AlarmScheduler.cancel(context, it.id) }
      store.save(emptyList())
    }

    // Answered: stop the ringing and take the alarm off the screen.
    Function("dismiss") { nid: Int ->
      AlarmNotifier.dismiss(context, nid)
    }

    Function("setFullScreen") { on: Boolean ->
      AlarmStore(context).fullScreen = on
    }

    Function("getFullScreen") {
      AlarmStore(context).fullScreen
    }

    // Android 14+ asks the user before an app may show alarms full screen.
    Function("canUseFullScreen") {
      if (Build.VERSION.SDK_INT >= 34) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.canUseFullScreenIntent()
      } else {
        true
      }
    }

    Function("openFullScreenSettings") {
      val intent = if (Build.VERSION.SDK_INT >= 34) {
        Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
          .setData(Uri.parse("package:${context.packageName}"))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
          .setData(Uri.parse("package:${context.packageName}"))
      }
      startSettings(intent)
    }

    // Settings → Apps → PillReminder → Notifications → Medicine alarms, where
    // the user picks the alarm tone from every sound on the phone.
    Function("openSoundSettings") {
      AlarmNotifier.ensureChannels(context)
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          .putExtra(Settings.EXTRA_CHANNEL_ID, AlarmNotifier.CHANNEL)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
          .setData(Uri.parse("package:${context.packageName}"))
      }
      startSettings(intent)
    }

    // The tone the user chose, to show its name and to play it on the alarm
    // screen. Null when the channel is silent.
    Function("getSoundUri") {
      AlarmNotifier.channelSound(context)?.toString()
    }

    Function("getSoundTitle") {
      val uri = AlarmNotifier.channelSound(context) ?: return@Function null
      try {
        RingtoneManager.getRingtone(context, uri)?.getTitle(context)
      } catch (e: Exception) {
        null
      }
    }

    // The alarm screen has closed: stop showing the app over the lock screen.
    Function("releaseLockScreen") {
      val activity = appContext.currentActivity ?: return@Function null
      activity.runOnUiThread { AlarmActivityListener.release(activity) }
      null
    }
  }

  private fun startSettings(intent: Intent): Boolean {
    return try {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    } catch (e: Exception) {
      false
    }
  }
}
