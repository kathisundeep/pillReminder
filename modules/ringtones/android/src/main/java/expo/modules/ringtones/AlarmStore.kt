package expo.modules.ringtones

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// One medicine alarm: a time of day (every day, or one weekday), or a one-shot
// snooze at an exact moment. `data` is the JSON the app reads back when the
// alarm is answered (which medicines, which slot).
data class Alarm(
  val id: String,
  val hour: Int,
  val minute: Int,
  // 0 = every day; 1..7 = Sunday..Saturday (Calendar.DAY_OF_WEEK, and the
  // same numbering expo-notifications used, so the JS side is unchanged).
  val weekday: Int,
  val title: String,
  val body: String,
  val data: String,
  // Epoch millis for a one-shot (snooze); 0 for a repeating alarm.
  val oneShotAt: Long
) {
  val isOneShot: Boolean get() = oneShotAt > 0

  fun toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("hour", hour)
    .put("minute", minute)
    .put("weekday", weekday)
    .put("title", title)
    .put("body", body)
    .put("data", data)
    .put("oneShotAt", oneShotAt)

  companion object {
    fun fromJson(o: JSONObject) = Alarm(
      id = o.getString("id"),
      hour = o.optInt("hour", 0),
      minute = o.optInt("minute", 0),
      weekday = o.optInt("weekday", 0),
      title = o.optString("title", "Time for your medicine"),
      body = o.optString("body", ""),
      data = o.optString("data", "{}"),
      oneShotAt = o.optLong("oneShotAt", 0L)
    )
  }
}

// Alarms are kept on the device so they can be re-armed after a reboot or an
// app update without the app running — AlarmManager forgets everything then.
class AlarmStore(context: Context) {
  private val prefs = context.getSharedPreferences("pill_alarms", Context.MODE_PRIVATE)

  fun all(): List<Alarm> {
    val raw = prefs.getString(KEY_ALARMS, "[]") ?: "[]"
    val arr = try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
    return (0 until arr.length()).mapNotNull {
      try { Alarm.fromJson(arr.getJSONObject(it)) } catch (e: Exception) { null }
    }
  }

  fun get(id: String): Alarm? = all().firstOrNull { it.id == id }

  fun save(alarms: List<Alarm>) {
    val arr = JSONArray()
    alarms.forEach { arr.put(it.toJson()) }
    prefs.edit().putString(KEY_ALARMS, arr.toString()).apply()
  }

  fun put(alarm: Alarm) = save(all().filter { it.id != alarm.id } + alarm)

  fun remove(id: String) = save(all().filter { it.id != id })

  // Full screen over the lock screen, or a notification only — a user setting.
  var fullScreen: Boolean
    get() = prefs.getBoolean(KEY_FULL_SCREEN, true)
    set(value) { prefs.edit().putBoolean(KEY_FULL_SCREEN, value).apply() }

  companion object {
    private const val KEY_ALARMS = "alarms"
    private const val KEY_FULL_SCREEN = "fullScreen"
  }
}
