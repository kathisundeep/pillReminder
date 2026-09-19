package expo.modules.ringtones

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// An alarm's moment has come (ACTION_FIRE), or its minute of ringing is up
// (ACTION_QUIET). Runs without the app — the JS side may not be alive at all.
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(AlarmScheduler.EXTRA_ID) ?: return
    val store = AlarmStore(context)
    val alarm = store.get(id) ?: return

    when (intent.action) {
      AlarmScheduler.ACTION_FIRE -> {
        AlarmNotifier.post(context, alarm, ringing = true)
        AlarmScheduler.scheduleQuiet(context, alarm.id)
        // A repeating alarm is armed for its next time straight away; a
        // one-shot is kept until its quiet step, which still needs it.
        if (!alarm.isOneShot) AlarmScheduler.schedule(context, alarm)
      }
      AlarmScheduler.ACTION_QUIET -> {
        // Only if it is still unanswered — answering dismisses it.
        val nid = AlarmNotifier.notificationId(alarm.id)
        if (AlarmNotifier.isShowing(context, nid)) {
          AlarmNotifier.post(context, alarm, ringing = false)
        }
        if (alarm.isOneShot) store.remove(alarm.id)
      }
    }
  }
}

// AlarmManager forgets every alarm on reboot, and on an app update. Re-arm
// them from the store.
class AlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED -> AlarmScheduler.scheduleAll(context)
    }
  }
}
