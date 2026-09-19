package expo.modules.ringtones

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

// Arms alarms with AlarmManager.setAlarmClock — the call clock apps use. It
// fires on time even in Doze, which a scheduled notification does not
// guarantee. A repeating alarm is armed for its next occurrence only, and
// re-armed each time it fires.
object AlarmScheduler {
  const val ACTION_FIRE = "expo.modules.ringtones.ALARM_FIRE"
  const val ACTION_QUIET = "expo.modules.ringtones.ALARM_QUIET"
  const val EXTRA_ID = "alarmId"

  // How long an unanswered alarm rings before it goes quiet.
  const val RING_MILLIS = 60_000L

  fun nextTrigger(alarm: Alarm, now: Long): Long {
    if (alarm.isOneShot) return alarm.oneShotAt
    val cal = Calendar.getInstance().apply {
      timeInMillis = now
      set(Calendar.HOUR_OF_DAY, alarm.hour)
      set(Calendar.MINUTE, alarm.minute)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (alarm.weekday == 0) {
      if (cal.timeInMillis <= now) cal.add(Calendar.DAY_OF_YEAR, 1)
    } else {
      val ahead = (alarm.weekday - cal.get(Calendar.DAY_OF_WEEK) + 7) % 7
      cal.add(Calendar.DAY_OF_YEAR, ahead)
      if (cal.timeInMillis <= now) cal.add(Calendar.DAY_OF_YEAR, 7)
    }
    return cal.timeInMillis
  }

  private fun alarmManager(context: Context) =
    context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private fun broadcast(context: Context, action: String, id: String, code: Int): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java)
      .setAction(action)
      .putExtra(EXTRA_ID, id)
    return PendingIntent.getBroadcast(
      context,
      code,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun fireCode(id: String) = id.hashCode()
  private fun quietCode(id: String) = id.hashCode() xor 0x5a5a5a5a

  private fun canExact(am: AlarmManager): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()

  fun schedule(context: Context, alarm: Alarm) {
    val am = alarmManager(context)
    val at = nextTrigger(alarm, System.currentTimeMillis())
    val operation = broadcast(context, ACTION_FIRE, alarm.id, fireCode(alarm.id))
    if (canExact(am)) {
      // Tapping the system's "next alarm" indicator opens the app.
      val show = AlarmNotifier.openApp(context, alarm, null, AlarmNotifier.notificationId(alarm.id))
      am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), operation)
    } else {
      // Exact alarms refused by the user: still fire, a little late at worst.
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
    }
  }

  fun cancel(context: Context, id: String) {
    val am = alarmManager(context)
    am.cancel(broadcast(context, ACTION_FIRE, id, fireCode(id)))
    am.cancel(broadcast(context, ACTION_QUIET, id, quietCode(id)))
  }

  // One minute after ringing starts, the notification is re-posted silently.
  fun scheduleQuiet(context: Context, id: String) {
    val am = alarmManager(context)
    val at = System.currentTimeMillis() + RING_MILLIS
    val operation = broadcast(context, ACTION_QUIET, id, quietCode(id))
    if (canExact(am)) {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
    } else {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
    }
  }

  fun scheduleAll(context: Context) {
    val store = AlarmStore(context)
    val now = System.currentTimeMillis()
    // A one-shot whose moment passed while the phone was off is dropped rather
    // than fired late in a burst.
    val stale = store.all().filter { it.isOneShot && it.oneShotAt < now - RING_MILLIS }
    stale.forEach { store.remove(it.id) }
    store.all().forEach { schedule(context, it) }
  }
}
