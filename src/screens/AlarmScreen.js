import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Vibration, ScrollView } from 'react-native';
import * as Notifications from 'expo-notifications';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Audio, InterruptionModeAndroid } from 'expo-av';
import { getSession } from '../utils/storage';
import {
  alarmMedicineIds,
  medicinesForAlarm,
  takeDoses,
  snoozeDoses,
  skipDoses,
} from '../utils/alarmActions';
import MedThumb from '../components/MedThumb';
import { Button } from '../components/ui';
import { holdUpdates } from '../utils/updates';
import { resolveSound } from '../utils/sounds';
import { colors, radius, formFor } from '../theme';

const TONE_SOURCES = {
  alarm: require('../../assets/sounds/alarm.wav'),
  chime: require('../../assets/sounds/chime.wav'),
  bell: require('../../assets/sounds/bell.wav'),
  siren: require('../../assets/sounds/siren.wav'),
  gentle: require('../../assets/sounds/gentle.wav'),
};

const ALARM_PATTERN = [0, 800, 400, 800, 400, 800];

// The full-screen alarm. One alarm can carry several medicines due at the same
// time; each gets its own card, with its photo, and its own Taken / Snooze /
// Skip. The screen closes once every one of them has an answer.
export default function AlarmScreen({ route, navigation }) {
  const params = route.params || {};
  const { slot = null, notificationId = null } = params;
  const soundRef = useRef(null);
  // Shown straight away from what the notification carried, then filled in
  // (photo, form, colour, snooze time) once the medicines load.
  const [meds, setMeds] = useState(() => placeholders(params));
  const [answers, setAnswers] = useState({});

  useEffect(() => {
    let cancelled = false;

    // An over-the-air reload here would dismiss the alarm without recording
    // anything, which reads to the user as a dose that silently vanished.
    const releaseUpdateHold = holdUpdates();

    activateKeepAwakeAsync('alarm');
    Vibration.vibrate(ALARM_PATTERN, true);

    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
          shouldDuckAndroid: false,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          staysActiveInBackground: true,
        });

        let source = TONE_SOURCES.alarm;
        const ids = alarmMedicineIds(params).filter((id) => id !== 'TEST');
        if (ids.length) {
          try {
            const user = await getSession();
            if (user) {
              // Medicines ride along in the offline cache, so photos still
              // show when the alarm fires with no network.
              const found = await medicinesForAlarm(ids);
              if (!cancelled && found.length) {
                setMeds((prev) => prev.map((p) => found.find((m) => m.id === p.id) || p));
              }
              // One alarm, one sound: the first medicine's tone. A device
              // ringtone resolves to a content:// URI, a bundled tone to a
              // required asset; resolveSound falls back to a bundled tone if
              // the chosen sound has gone — silence is the one outcome an
              // alarm cannot have.
              const chosen = await resolveSound(found[0]?.toneId);
              source = chosen.uri
                ? { uri: chosen.uri }
                : TONE_SOURCES[chosen.sound] || TONE_SOURCES.alarm;
            }
          } catch (e) {}
        }

        const { sound } = await Audio.Sound.createAsync(source, {
          isLooping: true,
          volume: 1.0,
          shouldPlay: true,
        });
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
      } catch (e) {
        try {
          const fallback = await Audio.Sound.createAsync(
            require('../../assets/sounds/alarm.wav'),
            { isLooping: true, volume: 1.0, shouldPlay: true }
          );
          if (cancelled) {
            await fallback.sound.unloadAsync();
            return;
          }
          soundRef.current = fallback.sound;
        } catch (_) {}
      }
    })();

    return () => {
      cancelled = true;
      releaseUpdateHold();
      Vibration.cancel();
      deactivateKeepAwake('alarm');
      (async () => {
        try {
          if (soundRef.current) {
            await soundRef.current.stopAsync();
            await soundRef.current.unloadAsync();
            soundRef.current = null;
          }
        } catch (e) {}
      })();
    };
  }, []);

  const stopAlarm = async () => {
    Vibration.cancel();
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } catch (e) {}
  };

  const pending = meds.filter((m) => !answers[m.id]);

  // Records the answer for `targets`, and leaves once nothing is left open.
  // The sound stops at the first answer: the person is here and dealing with it.
  const answer = async (targets, status) => {
    await stopAlarm();
    const user = await getSession();
    if (status === 'taken') await takeDoses(user, targets, slot);
    else if (status === 'snoozed') await snoozeDoses(user, targets, slot, targets[0].snoozeMinutes || 10);
    else await skipDoses(user, targets, slot);

    const next = { ...answers };
    for (const m of targets) next[m.id] = status;
    setAnswers(next);
    if (meds.every((m) => next[m.id])) {
      if (notificationId) {
        try {
          await Notifications.dismissNotificationAsync(notificationId);
        } catch (e) {}
      }
      navigation.replace('Home');
    }
  };

  const many = meds.length > 1;

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <Text style={styles.eyebrow}>PillReminder alarm</Text>
        <Text style={styles.time}>
          {new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
        {many ? (
          <Text style={styles.count}>
            {pending.length} of {meds.length} medicines to take
          </Text>
        ) : null}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[styles.listContent, !many && styles.listSingle]}
      >
        {meds.map((med) => (
          <MedCard
            key={med.id || 'medicine'}
            med={med}
            large={!many}
            answer={answers[med.id]}
            onAnswer={(status) => answer([med], status)}
          />
        ))}
      </ScrollView>

      {many && pending.length > 1 ? (
        <Button
          title={`✓  Take all ${pending.length}`}
          onPress={() => answer(pending, 'taken')}
          style={styles.takeAll}
        />
      ) : null}
    </View>
  );
}

const ANSWER_LABEL = {
  taken: '✓  Taken',
  snoozed: '⏰  Snoozed',
  skipped: '✕  Skipped',
};

function MedCard({ med, large, answer, onAnswer }) {
  const snooze = med.snoozeMinutes || 10;
  return (
    <View style={[styles.medCard, answer && styles.medCardDone]}>
      <MedThumb med={med} size={large ? (med.photo ? 132 : 96) : med.photo ? 96 : 64} />
      <Text style={[styles.medName, !large && styles.medNameSmall]}>{med.name || 'medicine'}</Text>
      <Text style={styles.medMeta}>
        {formFor(med.form || 'Tablet').label}
        {` • Snooze ${snooze} min`}
      </Text>

      {answer ? (
        <Text style={[styles.answer, styles[`answer_${answer}`]]}>{ANSWER_LABEL[answer]}</Text>
      ) : (
        <View style={styles.actions}>
          <Button title="✓  Mark taken" onPress={() => onAnswer('taken')} style={styles.action} />
          <Button
            title={`Snooze ${snooze} minutes`}
            variant="ghost"
            onPress={() => onAnswer('snoozed')}
            style={styles.action}
          />
          <Button
            title="Skip this dose"
            variant="danger"
            onPress={() => onAnswer('skipped')}
            style={styles.action}
          />
        </View>
      )}
    </View>
  );
}

// What the alarm can show before anything loads: the ids and names the
// notification carried. An older single-medicine alarm has just one of each.
function placeholders(params) {
  const ids = alarmMedicineIds(params);
  const names = params.medicineNames || (params.medicineName ? [params.medicineName] : []);
  if (!ids.length) return [{ id: null, name: names[0] || null }];
  return ids.map((id, i) => ({ id, name: names[i] || (ids.length === 1 ? names[0] : null) }));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.alarmBg,
    padding: 24,
    paddingBottom: 16,
  },
  top: { alignItems: 'center', paddingTop: 24, paddingBottom: 12 },
  eyebrow: {
    fontSize: 12,
    color: colors.alarmMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  time: {
    fontSize: 52,
    fontWeight: '800',
    color: colors.alarmAccent,
    marginTop: 6,
  },
  count: { fontSize: 14, color: colors.alarmBody, marginTop: 4, fontWeight: '600' },
  list: { flex: 1 },
  listContent: { gap: 14, paddingVertical: 8 },
  listSingle: { flexGrow: 1, justifyContent: 'center' },
  medCard: {
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 22,
    paddingHorizontal: 18,
  },
  medCardDone: { opacity: 0.55 },
  medName: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
  },
  medNameSmall: { fontSize: 22 },
  medMeta: { fontSize: 13.5, color: colors.alarmBody, textAlign: 'center' },
  actions: { gap: 10, width: '100%', marginTop: 4 },
  action: { width: '100%' },
  answer: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  answer_taken: { color: colors.alarmAccent },
  answer_snoozed: { color: '#7dd3fc' },
  answer_skipped: { color: '#fca5a5' },
  takeAll: { width: '100%', marginTop: 12 },
});
