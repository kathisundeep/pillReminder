import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Field, Input } from './ui';
import { colors, type } from '../theme';

// The 6-digit code step, shared by forgot password and change phone.
//
// While the server has no SMS provider (test mode), send-otp returns the code
// and it is shown here, loudly — the same notice registration shows.
export default function CodeEntry({ testCode, code, onChangeCode, onSubmit, onResend, role }) {
  const accent = role === 'guardian' ? colors.teal700 : colors.emerald700;
  return (
    <>
      {testCode ? (
        <View style={styles.testMode}>
          <Text style={styles.testModeTitle}>TEST MODE — no SMS was sent</Text>
          <Text style={styles.testModeCode} selectable>
            {testCode}
          </Text>
          <Text style={styles.testModeBody}>
            No SMS provider is configured on the server, so the code is shown
            here instead. It must be turned off before real users.
          </Text>
        </View>
      ) : null}
      <Field label="6-digit code">
        <Input
          placeholder="000000"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={onChangeCode}
          onSubmitEditing={onSubmit}
          style={styles.codeInput}
        />
      </Field>
      {onResend ? (
        <Text style={[styles.resend, { color: accent }]} onPress={onResend}>
          Didn't get it? Send a new code
        </Text>
      ) : null}
    </>
  );
}

// A problem to show above the form, in the app's error style.
export function Problem({ children }) {
  if (!children) return null;
  return <Text style={styles.problem}>{children}</Text>;
}

const styles = StyleSheet.create({
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
  testModeTitle: { ...type.label, color: colors.skipText, fontWeight: '800', letterSpacing: 0.6 },
  testModeCode: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 8,
    color: colors.heading,
    textAlign: 'center',
    paddingVertical: 2,
  },
  testModeBody: { fontSize: 12, lineHeight: 17, color: colors.skipText },
  resend: { fontSize: 13, fontWeight: '700', marginTop: -4, marginBottom: 8 },
  problem: {
    fontSize: 13,
    color: colors.skipText,
    backgroundColor: colors.skipBg,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    lineHeight: 18,
  },
});
