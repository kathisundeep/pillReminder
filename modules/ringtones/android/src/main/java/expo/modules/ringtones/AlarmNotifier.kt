package expo.modules.ringtones

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// Posts the alarm itself.
//
// The sound belongs to ONE channel, "Medicine alarms". Android lets the user
// change a channel's sound from Settings → Apps → PillReminder → Notifications,
// with any tone on the phone — that is the tone picker. FLAG_INSISTENT makes
// that sound repeat until the alarm is answered; after a minute the scheduler
// re-posts it on a silent channel so it stops ringing but keeps its buttons.
object AlarmNotifier {
  const val CHANNEL = "medicine-alarm"
  const val QUIET_CHANNEL = "medicine-alarm-quiet"

  fun notificationId(alarmId: String) = alarmId.hashCode() and 0x7fffffff

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // Created once. After that the settings are the user's: Android ignores
    // any change the app makes to an existing channel, sound included.
    if (nm.getNotificationChannel(CHANNEL) == null) {
      val channel = NotificationChannel(CHANNEL, "Medicine alarms", NotificationManager.IMPORTANCE_HIGH)
      channel.description = "Rings when a medicine is due. Tap Sound to choose the alarm tone."
      val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: Settings.System.DEFAULT_ALARM_ALERT_URI
      channel.setSound(
        sound,
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      channel.enableVibration(true)
      channel.vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
      channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      channel.setBypassDnd(true)
      nm.createNotificationChannel(channel)
    }
    if (nm.getNotificationChannel(QUIET_CHANNEL) == null) {
      val quiet = NotificationChannel(QUIET_CHANNEL, "Unanswered alarms", NotificationManager.IMPORTANCE_LOW)
      quiet.description = "An alarm that rang for a minute without an answer."
      quiet.setSound(null, null)
      quiet.enableVibration(false)
      quiet.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      nm.createNotificationChannel(quiet)
    }
  }

  fun channelSound(context: Context): Uri? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    }
    ensureChannels(context)
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return nm.getNotificationChannel(CHANNEL)?.sound
  }

  private fun smallIcon(context: Context): Int {
    val res = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (res != 0) res else context.applicationInfo.icon
  }

  // Opens the app with the alarm in the URL, e.g.
  //   pillreminder://alarm?nid=…&data={…}&action=TAKEN
  // The app reads it through React Native's Linking (ACTION_VIEW + data).
  fun openApp(context: Context, alarm: Alarm, action: String?, nid: Int): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent().setPackage(context.packageName)
    val uri = Uri.Builder()
      .scheme("pillreminder")
      .authority("alarm")
      .appendQueryParameter("alarmId", alarm.id)
      .appendQueryParameter("nid", nid.toString())
      .appendQueryParameter("data", alarm.data)
      .apply { if (action != null) appendQueryParameter("action", action) }
      .build()
    launch.action = Intent.ACTION_VIEW
    launch.data = uri
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val slot = when (action) { "TAKEN" -> 1; "RESCHEDULE" -> 2; "SKIP" -> 3; else -> 0 }
    return PendingIntent.getActivity(
      context,
      nid * 4 + slot,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  fun post(context: Context, alarm: Alarm, ringing: Boolean) {
    ensureChannels(context)
    val nid = notificationId(alarm.id)
    val builder = NotificationCompat.Builder(context, if (ringing) CHANNEL else QUIET_CHANNEL)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(alarm.title)
      .setContentText(alarm.body)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(if (ringing) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_DEFAULT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setColor(0xFF4CAF50.toInt())
      .setAutoCancel(true)
      .setContentIntent(openApp(context, alarm, null, nid))
      .addAction(0, "Taken", openApp(context, alarm, "TAKEN", nid))
      .addAction(0, "Reschedule", openApp(context, alarm, "RESCHEDULE", nid))
      .addAction(0, "Skip", openApp(context, alarm, "SKIP", nid))
    if (ringing && AlarmStore(context).fullScreen) {
      builder.setFullScreenIntent(openApp(context, alarm, null, nid), true)
    }
    if (!ringing) builder.setSilent(true)

    val notification = builder.build()
    if (ringing) notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(context).notify(nid, notification)
    } catch (e: SecurityException) {
      // Notifications turned off for the app — nothing can be shown.
    }
  }

  fun isShowing(context: Context, nid: Int): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return nm.activeNotifications.any { it.id == nid }
  }

  fun dismiss(context: Context, nid: Int) {
    NotificationManagerCompat.from(context).cancel(nid)
  }
}
