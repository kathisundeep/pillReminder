import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Vibration } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Audio, InterruptionModeAndroid } from 'expo-av';
import { getSession, recordDose, getMedicines, getMedicine } from '../utils/storage';
import { scheduleSnooze, toneById } from '../utils/notifications';
import { notifyGuardianTaken, sweepMissedDoses } from '../utils/guardian';
import MedThumb from '../components/MedThumb';
import { Button } from '../components/ui';
import { colors, radius, formFor } from '../theme';

const TONE_SOURCES = {
  alarm: require('../../assets/sounds/alarm.wav'),
  chime: require('../../assets/sounds/chime.wav'),
  bell: require('../../assets/sounds/bell.wav'),
  siren: require('../../assets/sounds/siren.wav'),
  gentle: require('../../assets/sounds/gentle.wav'),
};

const ALARM_PATTERN = [0, 800, 400, 800, 400, 800];

export default function AlarmScreen({ route, navigation }) {
  const { medicineId, medicineName, slot = null } = route.params || {};
  const [snoozeMinutes, setSnoozeMinutes] = useState(10);
  const soundRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [form, setForm] = useState('Tablet');
  const [color, setColor] = useState(null);

  useEffect(() => {
    let cancelled = false;

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
        if (medicineId && medicineId !== 'TEST') {
          try {
            const user = await getSession();
            if (user) {
              const med = await getMedicine(user, medicineId);
              const tone = toneById(med?.toneId);
              source = TONE_SOURCES[tone.sound] || TONE_SOURCES.alarm;
              // The photo rides along in the offline medicines cache, so it
              // still shows when the alarm fires with no network.
              if (med?.photo && !cancelled) setPhoto(med.photo);
              if (med?.snoozeMinutes && !cancelled) setSnoozeMinutes(med.snoozeMinutes);
              if (med?.form && !cancelled) setForm(med.form);
              if (med?.color && !cancelled) setColor(med.color);
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

  const onTook = async () => {
    await stopAlarm();
    const user = await getSession();
    if (user) {
      await recordDose(user, medicineId, 'taken', slot);
      await notifyGuardianTaken(user, medicineName || 'medicine');
    }
    navigation.replace('Home');
  };

  const onReschedule = async (minutes) => {
    await stopAlarm();
    const user = await getSession();
    if (user) {
      await recordDose(user, medicineId, 'snoozed', slot);
      const meds = await getMedicines(user);
      const med = meds.find((m) => m.id === medicineId);
      await scheduleSnooze({
        medicineId,
        medicineName: medicineName || med?.name || 'medicine',
        minutes,
        toneId: med?.toneId,
        slot,
      });
    }
    navigation.replace('Home');
  };

  const onSkip = async () => {
    await stopAlarm();
    const user = await getSession();
    if (user) {
      // Explicit skip — guardian is alerted by the missed-dose sweep.
      await recordDose(user, medicineId, 'skipped', slot);
      sweepMissedDoses();
    }
    navigation.replace('Home');
  };

  const med = { name: medicineName, photo, form, color };

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
      </View>

      <View style={styles.middle}>
        <View style={styles.medCard}>
          <MedThumb med={med} size={photo ? 132 : 96} />
          <Text style={styles.medName}>{medicineName || 'medicine'}</Text>
          <Text style={styles.medMeta}>
            {formFor(form).label}
            {snoozeMinutes ? ` • Snooze ${snoozeMinutes} min` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button title="✓  Mark taken" onPress={onTook} style={styles.action} />
        <Button
          title={`Snooze ${snoozeMinutes} minutes`}
          variant="ghost"
          onPress={() => onReschedule(snoozeMinutes)}
          style={styles.action}
        />
        <Button
          title="Skip this dose"
          variant="danger"
          onPress={onSkip}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.alarmBg,
    padding: 24,
    justifyContent: 'space-between',
  },
  top: { alignItems: 'center', paddingTop: 24 },
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
  middle: { flex: 1, justifyContent: 'center' },
  medCard: {
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  medName: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
  },
  medMeta: { fontSize: 13.5, color: colors.alarmBody, textAlign: 'center' },
  actions: { gap: 10, paddingBottom: 12 },
  action: { width: '100%' },
});
