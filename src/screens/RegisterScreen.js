import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {
  Button,
  Field,
  Input,
  Segmented,
  TitleHeader,
} from '../components/ui';
import { ROLES, useRole } from '../utils/role';
import {
  usernameError,
  phoneError,
  passwordError,
  isUsernameAvailable,
  isPhoneAvailable,
  sendPhoneCode,
  verifyPhoneCode,
  createAccount,
  normalisePhone,
  PASSWORD_MIN,
} from '../utils/onboarding';
import PhoneInput from '../components/PhoneInput';
import { detectCountry, composePhone, splitPhone, nationalDigits } from '../utils/countries';
import { colors, type } from '../theme';

// Registration in steps, so each answer is checked before the next is asked.
//
// Filling in six fields and being told at the end that the username is taken is
// the failure this avoids. Availability is checked before the phone step, and
// the phone is checked before an SMS is ever paid for.
const STEPS = ['role', 'username', 'phone', 'code', 'password'];

export default function RegisterScreen({ navigation }) {
  const { setRole } = useRole();
  const [step, setStep] = useState('role');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const [asGuardian, setAsGuardian] = useState(false);
  const [username, setUsername] = useState('');
  // The country is preselected from the phone's own settings, and the field
  // below holds only the national part — the two are joined into E.164 at the
  // moment of submission so the two can never drift apart.
  const [country, setCountry] = useState(() => detectCountry());
  const [national, setNational] = useState('');
  const [code, setCode] = useState('');
  // Only ever set when the server says no SMS provider is configured. It is
  // shown loudly rather than quietly filled in, so a test build can never be
  // mistaken for a working one.
  const [testCode, setTestCode] = useState(null);

  const phone = composePhone(country, national);
  const [claimToken, setClaimToken] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const role = asGuardian ? 'guardian' : 'patient';
  const stepIndex = STEPS.indexOf(step);

  const go = (next) => {
    setProblem(null);
    setStep(next);
  };

  const back = () => {
    if (stepIndex <= 0) {
      navigation.goBack();
      return;
    }
    go(STEPS[stepIndex - 1]);
  };

  // ---- step handlers ------------------------------------------------------
  const submitUsername = async () => {
    const problemText = usernameError(username);
    if (problemText) return setProblem(problemText);

    setBusy(true);
    try {
      const res = await isUsernameAvailable(username);
      // A failed check is not a free pass: without an answer we cannot know the
      // name is free, and letting it through would fail at account creation.
      if (!res.ok) return setProblem(res.error || 'Could not check that username.');
      if (!res.available) return setProblem('That username is taken. Try another.');
      go('phone');
    } finally {
      setBusy(false);
    }
  };

  // Someone pasting a full international number into the national field is
  // common enough to handle: adopt the country it names rather than treating
  // the dial code as part of the subscriber number.
  const onChangeNational = (text) => {
    if (String(text).trim().startsWith('+')) {
      const split = splitPhone(text);
      if (split) {
        setCountry(split.country);
        setNational(nationalDigits(split.national));
        return;
      }
    }
    setNational(text);
  };

  const submitPhone = async () => {
    const problemText = phoneError(phone);
    if (problemText) return setProblem(problemText);

    setBusy(true);
    try {
      // Check before spending an SMS.
      const free = await isPhoneAvailable(phone, asGuardian);
      if (free.ok && free.available === false) {
        return setProblem(
          asGuardian
            ? 'This number already has a guardian account. Log in instead.'
            : 'This number already has a patient account. Log in instead.'
        );
      }
      const sent = await sendPhoneCode(phone, asGuardian);
      if (!sent.ok) return setProblem(sent.error);
      setTestCode(sent.testMode ? sent.testCode : null);
      go('code');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    try {
      const res = await verifyPhoneCode(phone, asGuardian, code);
      if (!res.ok) return setProblem(res.error);
      setClaimToken(res.claimToken);
      go('password');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      const sent = await sendPhoneCode(phone, asGuardian);
      setProblem(sent.ok ? 'A new code is on its way.' : sent.error);
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    const problemText = passwordError(password, confirm);
    if (problemText) return setProblem(problemText);

    setBusy(true);
    try {
      const res = await createAccount({
        username,
        password,
        phone,
        isGuardian: asGuardian,
        claimToken,
      });
      if (!res.ok) return setProblem(res.error);
      // The navigator swaps to the new flow; the details step follows there.
      setRole(asGuardian ? ROLES.GUARDIAN : ROLES.PATIENT);
    } finally {
      setBusy(false);
    }
  };

  // ---- rendering ----------------------------------------------------------
  const CONTENT = {
    role: {
      title: 'Who is this account for?',
      hint: 'A guardian looks after someone else and takes no medicines here. You can create both with the same phone number.',
      body: (
        <Segmented
          value={role}
          onChange={(next) => setAsGuardian(next === 'guardian')}
          options={[
            { value: 'patient', label: 'I take medicines' },
            { value: 'guardian', label: "I'm a guardian" },
          ]}
        />
      ),
      action: { label: 'Continue', onPress: () => go('username') },
    },

    username: {
      title: 'Choose a username',
      hint: 'This is what your guardian types to pair with you. It cannot be changed later.',
      body: (
        <Field label="Username">
          <Input
            placeholder="e.g. sundeep"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            onSubmitEditing={submitUsername}
            returnKeyType="next"
          />
        </Field>
      ),
      action: { label: 'Check and continue', onPress: submitUsername },
    },

    phone: {
      title: 'Your phone number',
      hint: 'Used to verify this account and to get you back in if you forget your password.',
      body: (
        <Field label="Phone number">
          <PhoneInput
            role={role}
            country={country}
            onChangeCountry={setCountry}
            value={national}
            onChangeText={onChangeNational}
            onSubmitEditing={submitPhone}
          />
        </Field>
      ),
      action: { label: 'Send code', onPress: submitPhone },
    },

    code: {
      title: 'Enter the code',
      hint: `We sent a 6-digit code to ${normalisePhone(phone) || phone}. It expires in 10 minutes.`,
      body: (
        <>
          {testCode ? (
            <View style={styles.testMode}>
              <Text style={styles.testModeTitle}>
                TEST MODE — no SMS was sent
              </Text>
              <Text style={styles.testModeCode} selectable>
                {testCode}
              </Text>
              <Text style={styles.testModeBody}>
                No SMS provider is configured on the server, so the code is
                shown here instead. Anyone could register as anyone while this
                is on — it must be turned off before real users.
              </Text>
            </View>
          ) : null}

          <Field label="6-digit code">
            <Input
              placeholder="000000"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
              onSubmitEditing={submitCode}
              style={styles.codeInput}
            />
          </Field>
          <Text style={styles.resend} onPress={resend}>
            Didn't get it? Send a new code
          </Text>
        </>
      ),
      action: { label: 'Verify', onPress: submitCode },
    },

    password: {
      title: 'Create a password',
      hint: `At least ${PASSWORD_MIN} characters, with a letter and a number.`,
      body: (
        <>
          <Field label="Password">
            <Input
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </Field>
          <Field label="Confirm password">
            <Input
              placeholder="Type it again"
              secureTextEntry
              value={confirm}
              onChangeText={setConfirm}
              onSubmitEditing={submitPassword}
            />
          </Field>
        </>
      ),
      action: { label: 'Create account', onPress: submitPassword },
    },
  }[step];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TitleHeader title="Create your account" onClose={back} />

      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View
            key={s}
            style={[
              styles.progressBar,
              i <= stepIndex && {
                backgroundColor: asGuardian ? colors.teal600 : colors.emerald600,
              },
            ]}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.stepCount}>
          Step {stepIndex + 1} of {STEPS.length}
        </Text>
        <Text style={styles.title}>{CONTENT.title}</Text>
        <Text style={styles.hint}>{CONTENT.hint}</Text>

        <View style={styles.body}>{CONTENT.body}</View>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}

        {busy ? (
          <ActivityIndicator
            color={asGuardian ? colors.teal600 : colors.emerald600}
            style={styles.spinner}
          />
        ) : (
          <Button
            title={CONTENT.action.label}
            onPress={CONTENT.action.onPress}
            role={role}
          />
        )}

        <Text style={styles.switchText} onPress={() => navigation.goBack()}>
          Already have an account? Log in
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  progress: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: colors.surface,
    paddingBottom: 14,
  },
  progressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  scroll: { padding: 24, paddingTop: 28 },
  stepCount: {
    ...type.label,
    color: colors.muted,
    marginBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.heading },
  hint: {
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  body: { marginBottom: 8 },
  codeInput: { letterSpacing: 8, fontWeight: '800', textAlign: 'center', fontSize: 20 },
  testMode: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.skipText,
    backgroundColor: colors.skipBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    gap: 6,
  },
  testModeTitle: {
    ...type.label,
    color: colors.skipText,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  testModeCode: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 8,
    color: colors.heading,
    textAlign: 'center',
    paddingVertical: 2,
  },
  testModeBody: { fontSize: 12, lineHeight: 17, color: colors.skipText },
  resend: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.emerald700,
    marginTop: -4,
    marginBottom: 8,
  },
  problem: {
    fontSize: 13,
    color: colors.skipText,
    backgroundColor: colors.skipBg,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    lineHeight: 18,
  },
  spinner: { paddingVertical: 18 },
  switchText: {
    textAlign: 'center',
    marginTop: 22,
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.muted,
  },
});
