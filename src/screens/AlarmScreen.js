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
    if (user) await recordDose(user, medicineId, 'taken');
    navigation.replace('Home');
  };

  const onSkip = async () => {
    await stopAlarm();
    const user = await getSession();
    if (user) {
      await recordDose(user, medicineId, 'snoozed');
      const meds = await getMedicines(user);
      const med = meds.find((m) => m.id === medicineId);
      const snooze = med?.snoozeMinutes || 10;
      await scheduleSnooze({
        medicineId,
        medicineName: medicineName || med?.name || 'medicine',
        minutes: snooze,
      });
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
      <Text style={styles.question}>Did you take it?</Text>

      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.btn, styles.btnYes]} onPress={onTook}>
          <Text style={styles.btnTextYes}>✓</Text>
          <Text style={styles.btnLabel}>Took it</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, styles.btnNo]} onPress={onSkip}>
          <Text style={styles.btnTextNo}>✗</Text>
          <Text style={styles.btnLabel}>Snooze</Text>
        </TouchableOpacity>
      </View>
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
  btnRow: { flexDirection: 'row' },
  btn: {
    width: 140,
    height: 140,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
  },
  btnYes: { backgroundColor: '#4CAF50' },
  btnNo: { backgroundColor: '#e53935' },
  btnTextYes: { color: '#fff', fontSize: 64, fontWeight: '700' },
  btnTextNo: { color: '#fff', fontSize: 64, fontWeight: '700' },
  btnLabel: { color: '#fff', fontSize: 14, marginTop: 4, fontWeight: '600' },
});
