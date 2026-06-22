import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { getSession, recordDose, getMedicines } from '../utils/storage';
import { scheduleSnooze } from '../utils/notifications';

export default function AlarmScreen({ route, navigation }) {
  const { medicineId, medicineName } = route.params || {};

  useEffect(() => {
    activateKeepAwakeAsync('alarm');
    Vibration.vibrate([0, 800, 400, 800], true);
    return () => {
      Vibration.cancel();
      deactivateKeepAwake('alarm');
    };
  }, []);

  const onTook = async () => {
    Vibration.cancel();
    const user = await getSession();
    if (user) await recordDose(user, medicineId, 'taken');
    navigation.replace('Home');
  };

  const onSkip = async () => {
    Vibration.cancel();
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
  time: {
    color: '#fff',
    fontSize: 64,
    fontWeight: '300',
    marginBottom: 16,
  },
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
  btnRow: { flexDirection: 'row', gap: 24 },
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
