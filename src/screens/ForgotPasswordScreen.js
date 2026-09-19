import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Button, Field, Input, Segmented, TitleHeader, Screen } from '../components/ui';
import PhoneInput from '../components/PhoneInput';
import CodeEntry, { Problem } from '../components/CodeEntry';
import usePhoneNumber from '../utils/usePhoneNumber';
import {
  phoneError,
  normalisePhone,
  sendPhoneCode,
  verifyPhoneCode,
  resetPassword,
  PASSWORD_MIN,
} from '../utils/onboarding';
import { colors, type } from '../theme';

// Getting back in without the password: a code to the account's phone, then a
// new password. The account is found by its number and its type — the same
// number may hold one patient and one guardian account.
export default function ForgotPasswordScreen({ route, navigation }) {
  const [asGuardian, setAsGuardian] = useState(!!route?.params?.asGuardian);
  const number = usePhoneNumber();
  const [step, setStep] = useState('phone'); // phone | code | password | done
  const [code, setCode] = useState('');
  const [testCode, setTestCode] = useState(null);
  const [claimToken, setClaimToken] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [username, setUsername] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

  const role = asGuardian ? 'guardian' : 'patient';
  const go = (next) => {
    setProblem(null);
    setStep(next);
  };

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const bad = phoneError(number.phone);
      if (bad) return setProblem(bad);
      const sent = await sendPhoneCode(number.phone, asGuardian, 'reset');
      if (!sent.ok) return setProblem(sent.error);
      setTestCode(sent.testMode ? sent.testCode : null);
      go('code');
    });

  const resend = () =>
    run(async () => {
      const sent = await sendPhoneCode(number.phone, asGuardian, 'reset');
      if (sent.ok) setTestCode(sent.testMode ? sent.testCode : null);
      setProblem(sent.ok ? 'A new code is on its way.' : sent.error);
    });

  const checkCode = () =>
    run(async () => {
      const res = await verifyPhoneCode(number.phone, asGuardian, code, 'reset');
      if (!res.ok) return setProblem(res.error);
      setClaimToken(res.claimToken);
      go('password');
    });

  const save = () =>
    run(async () => {
      const res = await resetPassword({
        phone: number.phone,
        isGuardian: asGuardian,
        claimToken,
        password,
        confirm,
      });
      if (!res.ok) return setProblem(res.error);
      setUsername(res.username || null);
      go('done');
    });

  const steps = {
    phone: {
      title: 'Forgot your password?',
      hint: 'Enter the phone number on your account. We will send it a code.',
      body: (
        <>
          <Segmented
            style={styles.roleToggle}
            value={role}
            onChange={(next) => setAsGuardian(next === 'guardian')}
            options={[
              { value: 'patient', label: 'I take medicines' },
              { value: 'guardian', label: "I'm a guardian" },
            ]}
          />
          <Field label="Phone number">
            <PhoneInput
              role={role}
              country={number.country}
              onChangeCountry={number.setCountry}
              value={number.national}
              onChangeText={number.onChangeNational}
              onSubmitEditing={sendCode}
            />
          </Field>
        </>
      ),
      action: { label: 'Send code', onPress: sendCode },
    },
    code: {
      title: 'Enter the code',
      hint: `If ${normalisePhone(number.phone) || number.phone} has a ${
        asGuardian ? 'guardian' : 'patient'
      } account, a 6-digit code is on its way. It expires in 10 minutes.`,
      body: (
        <CodeEntry
          role={role}
          testCode={testCode}
          code={code}
          onChangeCode={setCode}
          onSubmit={checkCode}
          onResend={resend}
        />
      ),
      action: { label: 'Verify', onPress: checkCode },
    },
    password: {
      title: 'Choose a new password',
      hint: `At least ${PASSWORD_MIN} characters, with a letter and a number.`,
      body: (
        <>
          <Field label="New password">
            <Input placeholder="New password" secureTextEntry value={password} onChangeText={setPassword} />
          </Field>
          <Field label="Confirm new password">
            <Input
              placeholder="Type it again"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={save}
            />
          </Field>
        </>
      ),
      action: { label: 'Set new password', onPress: save },
    },
    done: {
      title: 'Password changed',
      hint: 'Log in with your new password.',
      body: username ? (
        <View style={styles.username}>
          <Text style={styles.usernameLabel}>Your username</Text>
          <Text style={styles.usernameValue} selectable>
            @{username}
          </Text>
        </View>
      ) : null,
      action: {
        label: 'Log in',
        onPress: () => navigation.navigate('Login', { username: username || '', asGuardian }),
      },
    },
  };
  const current = steps[step];

  return (
    <Screen>
      <TitleHeader title="Reset password" onClose={() => navigation.goBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.hint}>{current.hint}</Text>
          <Problem>{problem}</Problem>
          {current.body}
          <Button
            title={busy ? '…' : current.action.label}
            onPress={current.action.onPress}
            disabled={busy}
            role={role}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 24, paddingBottom: 48 },
  title: { ...type.title, fontSize: 22, marginBottom: 6 },
  hint: { ...type.subtitle, marginBottom: 18 },
  roleToggle: { marginBottom: 16 },
  username: {
    backgroundColor: colors.cardSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    alignItems: 'center',
    gap: 4,
  },
  usernameLabel: { ...type.meta },
  usernameValue: { fontSize: 20, fontWeight: '800', color: colors.heading },
});
