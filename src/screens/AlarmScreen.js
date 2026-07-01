import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Audio, InterruptionModeAndroid } from 'expo-av';
import { getSession, recordDose, getMedicines, getMedicine } from '../utils/storage';
import { scheduleSnooze } from '../utils/notifications';
import { notifyGuardianTaken, sweepMissedDoses } from '../utils/guardian';

const ALARM_PATTERN = [0, 800, 400, 800, 400, 800];

export default function AlarmScreen({ route, navigation }) {
  const { medicineId, medicineName } = route.params || {};
  const soundRef = useRef(null);

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

        let source = require('../../assets/sounds/alarm.wav');
        if (medicineId && medicineId !== 'TEST') {
          try {
            const user = await getSession();
            if (user) {
              const med = await getMedicine(user, medicineId);
              if (med?.alarmToneUri) source = { uri: med.alarmToneUri };
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
      await recordDose(user, medicineId, 'taken');
      await notifyGuardianTaken(user, medicineName || 'medicine');
    }
    navigation.replace('Home');
  };

  const onReschedule = async (minutes) => {
    await stopAlarm();
    const user = await getSession();
    if (user) {
      await recordDose(user, medicineId, 'snoozed');
      const meds = await getMedicines(user);
      const med = meds.find((m) => m.id === medicineId);
      await scheduleSnooze({
        medicineId,
        medicineName: medicineName || med?.name || 'medicine',
        minutes,
      });
    }
    navigation.replace('Home');
  };

  const onSkip = async () => {
    await stopAlarm();
    const user = await getSession();
    if (user) {
      // Explicit skip — guardian is alerted by the missed-dose sweep.
      await recordDose(user, medicineId, 'skipped');
      sweepMissedDoses();
    }
    navigation.replace('Home');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.time}>
        {new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>
      <Text style={styles.subtitle}>Time to take your</Text>
      <Text style={styles.medName}>{medicineName || 'medicine'}</Text>
      <Text style={styles.question}>What would you like to do?</Text>

      <TouchableOpacity style={styles.takenBtn} onPress={onTook}>
        <Text style={styles.takenBtnText}>✓  Taken</Text>
      </TouchableOpacity>

      <View style={styles.rescheduleRow}>
        <TouchableOpacity
          style={styles.rescheduleBtn}
          onPress={() => onReschedule(5)}
        >
          <Text style={styles.rescheduleText}>Reschedule 5 min</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rescheduleBtn}
          onPress={() => onReschedule(10)}
        >
          <Text style={styles.rescheduleText}>Reschedule 10 min</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.skipBtn} onPress={onSkip}>
        <Text style={styles.skipText}>✗  Skip this dose</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1b5e20',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  time: { color: '#fff', fontSize: 64, fontWeight: '300', marginBottom: 16 },
  subtitle: { color: '#c8e6c9', fontSize: 18 },
  medName: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '700',
    marginVertical: 12,
    textAlign: 'center',
  },
  question: {
    color: '#c8e6c9',
    fontSize: 18,
    marginTop: 24,
    marginBottom: 32,
  },
  takenBtn: {
    backgroundColor: '#4CAF50',
    paddingVertical: 22,
    paddingHorizontal: 40,
    borderRadius: 16,
    alignItems: 'center',
    alignSelf: 'stretch',
    marginBottom: 16,
  },
  takenBtnText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  rescheduleRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  rescheduleBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 6,
  },
  rescheduleText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  skipBtn: {
    backgroundColor: '#e53935',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  skipText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
