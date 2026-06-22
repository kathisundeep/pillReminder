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
import { loginUser, registerUser } from '../utils/storage';

export default function LoginScreen({ navigation }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

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
    navigation.replace('Home');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>Pill Reminder</Text>
      <Text style={styles.subtitle}>
        {mode === 'login' ? 'Welcome back' : 'Create your account'}
      </Text>

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
  switchText: {
    color: '#4CAF50',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
  },
});
