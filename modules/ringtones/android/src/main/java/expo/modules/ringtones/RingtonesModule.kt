package expo.modules.ringtones

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Access to the sounds already on the phone, and notification channels that can
// use them.
//
// Two things here cannot be done through expo-notifications:
//
//  1. Listing the device's ringtones at all. RingtoneManager is the only way,
//     and it has no JS binding.
//
//  2. Giving a channel a content:// sound. expo-notifications resolves its
//     `sound` string to a bundled res/raw resource, so a user-chosen ringtone
//     can never reach it. NotificationChannel.setSound() takes any Uri, which
//     is what this exposes.
//
// Channels are immutable once created — Android deliberately hands their
// settings to the user — so a sound change means a NEW channel, keyed by the
// sound itself. deleteChannel() exists so old ones do not pile up in the
// system settings list.

class RingtonesModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  private val notificationManager: NotificationManager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override fun definition() = ModuleDefinition {
    Name("Ringtones")

    // Returns [{ uri, title, type }] where type is alarm | ringtone | notification.
    //
    // Alarms come first and are the sensible default: they are designed to be
    // heard through sleep, which is exactly this app's job. A gentle message
    // chime is a poor way to be reminded of a dose.
    Function("getRingtones") {
      val wanted = listOf(
        RingtoneManager.TYPE_ALARM to "alarm",
        RingtoneManager.TYPE_RINGTONE to "ringtone",
        RingtoneManager.TYPE_NOTIFICATION to "notification"
      )

      val seen = mutableSetOf<String>()
      val out = mutableListOf<Map<String, String>>()

      for ((type, label) in wanted) {
        try {
          val manager = RingtoneManager(context)
          manager.setType(type)
          val cursor = manager.cursor ?: continue

          cursor.use {
            var position = 0
            while (it.moveToNext()) {
              val uri = manager.getRingtoneUri(position)?.toString()
              val title = it.getString(RingtoneManager.TITLE_COLUMN_INDEX)
              // The same file is often registered under several types.
              if (uri != null && title != null && seen.add(uri)) {
                out.add(mapOf("uri" to uri, "title" to title, "type" to label))
              }
              position += 1
            }
          }
        } catch (e: Exception) {
          // A missing media provider or a revoked permission must not take the
          // whole list down — the other types still work, and the bundled
          // tones are always there as a fallback.
          continue
        }
      }

      out
    }

    // Creates (or replaces) an alarm channel whose sound is an arbitrary Uri.
    // Passing null for soundUri leaves the channel silent.
    Function("ensureAlarmChannel") { channelId: String, name: String, soundUri: String? ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false

      // USAGE_ALARM is why this matters: it plays at alarm volume and through
      // Do Not Disturb, rather than at notification volume where it can be
      // inaudible on a phone lying face-down on a bedside table.
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

      val channel = NotificationChannel(
        channelId,
        name,
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        if (soundUri != null) setSound(Uri.parse(soundUri), attributes) else setSound(null, null)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
        setBypassDnd(true)
        lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
      }

      notificationManager.createNotificationChannel(channel)
      true
    }

    Function("deleteChannel") { channelId: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      notificationManager.deleteNotificationChannel(channelId)
      true
    }

    Function("listChannelIds") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function emptyList<String>()
      notificationManager.notificationChannels.map { it.id }
    }

    // What sound a channel REALLY has. The user can change it in system
    // settings and Android gives that the final say, so this reports what is
    // actually set rather than what we asked for.
    Function("channelSound") { channelId: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function null
      notificationManager.getNotificationChannel(channelId)?.sound?.toString()
    }
  }
}
