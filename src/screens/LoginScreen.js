import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import {
  loginUser,
  logoutUser,
  importLocalMedicinesOnce,
} from '../utils/storage';
import { resyncAlarmsFromCloud } from '../utils/sync';
import { getMyProfile } from '../utils/guardianCloud';
import { ROLES, roleMatchesAccount, useRole } from '../utils/role';
import { Button, Field, Input, Segmented } from '../components/ui';
import { runningUpdate } from '../utils/updates';
import { colors, type } from '../theme';

const appVersion = require('../../app.json').expo.version;
const buildInfo = runningUpdate();

export default function LoginScreen({ navigation }) {
  const { setRole } = useRole();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [asGuardian, setAsGuardian] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Missing info', 'Enter a username and password.');
      return;
    }
    const wantedRole = asGuardian ? ROLES.GUARDIAN : ROLES.PATIENT;

    setBusy(true);
    try {
      const login = await loginUser(username.trim(), password);
      if (!login.ok) {
        Alert.alert('Failed', login.error);
        return;
      }

      // Patient and guardian are separate account types. Refuse a mismatch
      // rather than dropping someone into the wrong flow.
      const profile = await getMyProfile();
      if (profile && !roleMatchesAccount(wantedRole, profile)) {
        await logoutUser();
        Alert.alert(
          asGuardian ? 'Not a guardian account' : 'Not a patient account',
          asGuardian
            ? `@${profile.username} takes medicines. Choose "I take medicines", or register a separate guardian account.`
            : `@${profile.username} is a guardian account. Choose "I'm a guardian" to sign in.`
        );
        return;
      }

      if (wantedRole === ROLES.PATIENT) {
        // First cloud login (patient): import any medicines left in old
        // on-device storage, then (re)schedule local alarms from the cloud list.
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
      }

      // Swapping the role swaps the whole screen set, so there is nothing to
      // navigate to — the navigator re-renders into the right flow.
      setRole(wantedRole);
    } finally {
      setBusy(false);
    }
  };

  const role = asGuardian ? 'guardian' : 'patient';
  const subtitle = asGuardian ? 'Guardian log in' : 'Welcome back';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Text style={styles.logo}>Pill Reminder</Text>
          <Text style={styles.tagline}>Medication &amp; Guardian Platform</Text>
        </View>

        <Text style={styles.subtitle}>{subtitle}</Text>

        <Segmented
          style={styles.roleToggle}
          value={role}
          onChange={(next) => setAsGuardian(next === 'guardian')}
          options={[
            { value: 'patient', label: 'I take medicines' },
            { value: 'guardian', label: "I'm a guardian" },
          ]}
        />

        <Field label="Username">
          <Input
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
        </Field>

        <Field label="Password">
          <Input
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </Field>

        <Button
          title={busy ? '…' : 'Log in'}
          onPress={submit}
          disabled={busy}
          role={role}
          style={styles.submit}
        />

        <Text
          style={[styles.switchText, { color: asGuardian ? colors.teal700 : colors.emerald700 }]}
          onPress={() => navigation.navigate('Register')}
        >
          Don't have an account? Register
        </Text>

        {/* Which build is running, on the FIRST screen — before any login.
            The same line exists in Settings, but Settings is behind an
            account, so it is unreachable exactly when it is most needed:
            when registration itself is not behaving and the question is
            whether the app is even running the code you think it is. */}
        <Text style={styles.build}>
          {`v${appVersion} · ${buildInfo.short}`}
          {buildInfo.embedded ? ' (as installed)' : ''}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brand: { alignItems: 'center', marginBottom: 8 },
  logo: {
    ...type.h1,
    color: colors.emerald600,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    color: colors.muted,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 20,
  },
  roleToggle: { marginBottom: 20 },
  submit: { marginTop: 6 },
  switchText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 13.5,
    fontWeight: '700',
  },
  build: {
    textAlign: 'center',
    marginTop: 26,
    fontSize: 11,
    color: colors.muted,
  },
});
