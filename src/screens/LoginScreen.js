import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { loginUser, registerUser, importLocalMedicinesOnce } from '../utils/storage';
import { resyncAlarmsFromCloud } from '../utils/sync';

export default function LoginScreen({ navigation }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [asGuardian, setAsGuardian] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Missing info', 'Enter a username and password.');
      return;
    }
    setBusy(true);
    const fn = mode === 'login' ? loginUser : registerUser;
    const res = await fn(username.trim(), password);
    setBusy(false);
    if (!res.ok) {
      Alert.alert('Failed', res.error);
      return;
    }
    if (mode === 'register') {
      const lr = await loginUser(username.trim(), password);
      if (!lr.ok) {
        Alert.alert('Failed', lr.error);
        return;
      }
    }
    if (asGuardian) {
      navigation.replace('GuardianDashboard');
      return;
    }
    // First cloud login (patient): import any medicines left in old on-device
    // storage, then (re)schedule local alarms from the cloud list.
    try {
      const imported = await importLocalMedicinesOnce();
      await resyncAlarmsFromCloud();
      if (imported > 0) {
        Alert.alert(
          'Medicines imported',
          `${imported} medicine(s) from this device were added to your account.`
        );
      }
    } catch (e) {}
    navigation.replace('Home');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>Pill Reminder</Text>
      <Text style={styles.subtitle}>
        {asGuardian
          ? mode === 'login'
            ? 'Guardian log in'
            : 'Create a guardian account'
          : mode === 'login'
          ? 'Welcome back'
          : 'Create your account'}
      </Text>

      <View style={styles.roleRow}>
        <TouchableOpacity
          style={[styles.roleBtn, !asGuardian && styles.roleBtnOn]}
          onPress={() => setAsGuardian(false)}
        >
          <Text style={[styles.roleText, !asGuardian && styles.roleTextOn]}>
            I take medicines
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.roleBtn, asGuardian && styles.roleBtnOn]}
          onPress={() => setAsGuardian(true)}
        >
          <Text style={[styles.roleText, asGuardian && styles.roleTextOn]}>
            I'm a guardian
          </Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder="Username"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
        <Text style={styles.buttonText}>
          {busy ? '...' : mode === 'login' ? 'Log in' : 'Register'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        <Text style={styles.switchText}>
          {mode === 'login'
            ? "Don't have an account? Register"
            : 'Already have an account? Log in'}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    padding: 24,
  },
  logo: {
    fontSize: 36,
    fontWeight: '700',
    color: '#4CAF50',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  roleRow: {
    flexDirection: 'row',
    backgroundColor: '#eee',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  roleBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  roleBtnOn: { backgroundColor: '#fff', elevation: 1 },
  roleText: { color: '#666', fontWeight: '600', fontSize: 13 },
  roleTextOn: { color: '#222' },
  switchText: {
    color: '#4CAF50',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
  },
});
