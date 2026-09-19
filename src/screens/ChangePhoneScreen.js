import React, { useState } from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { Button, Field, Input, TitleHeader, Screen, Content } from '../components/ui';
import PhoneInput from '../components/PhoneInput';
import CodeEntry, { Problem } from '../components/CodeEntry';
import usePhoneNumber from '../utils/usePhoneNumber';
import {
  phoneError,
  normalisePhone,
  sendPhoneCode,
  verifyPhoneCode,
  changePhone,
} from '../utils/onboarding';
import { useRole, ROLES } from '../utils/role';
import { type } from '../theme';

// Signed in: move the account to a new number. A code goes to the NEW number
// (it becomes the way back in after a forgotten password), and the current
// password confirms it is really the account holder asking.
export default function ChangePhoneScreen({ navigation }) {
  const { role } = useRole();
  const asGuardian = role === ROLES.GUARDIAN;
  const brand = asGuardian ? 'guardian' : 'patient';
  const number = usePhoneNumber();
  const [step, setStep] = useState('phone'); // phone | code
  const [code, setCode] = useState('');
  const [testCode, setTestCode] = useState(null);
  const [claimToken, setClaimToken] = useState(null);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

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
      const sent = await sendPhoneCode(number.phone, asGuardian, 'change_phone');
      if (!sent.ok) return setProblem(sent.error);
      setTestCode(sent.testMode ? sent.testCode : null);
      setClaimToken(null);
      setCode('');
      setProblem(null);
      setStep('code');
    });

  const resend = () =>
    run(async () => {
      const sent = await sendPhoneCode(number.phone, asGuardian, 'change_phone');
      if (sent.ok) {
        setTestCode(sent.testMode ? sent.testCode : null);
        setClaimToken(null);
      }
      setProblem(sent.ok ? 'A new code is on its way.' : sent.error);
    });

  const confirmChange = () =>
    run(async () => {
      if (!String(password)) return setProblem('Enter your current password.');
      // A verified code is spent once; keep its claim so a mistyped password
      // can be retried without a new code.
      let claim = claimToken;
      if (!claim) {
        const res = await verifyPhoneCode(number.phone, asGuardian, code, 'change_phone');
        if (!res.ok) return setProblem(res.error);
        claim = res.claimToken;
        setClaimToken(claim);
      }
      const done = await changePhone({ phone: number.phone, claimToken: claim, password });
      if (!done.ok) return setProblem(done.error);
      Alert.alert('Number changed', `Your account now uses ${done.phone || normalisePhone(number.phone)}.`);
      navigation.goBack();
    });

  return (
    <Screen>
      <TitleHeader title="Change phone number" onClose={() => navigation.goBack()} />
      <Content>
        {step === 'phone' ? (
          <>
            <Text style={styles.hint}>
              Enter your new number. We will send it a code — it is what gets
              you back in if you forget your password.
            </Text>
            <Problem>{problem}</Problem>
            <Field label="New phone number">
              <PhoneInput
                role={brand}
                country={number.country}
                onChangeCountry={number.setCountry}
                value={number.national}
                onChangeText={number.onChangeNational}
                onSubmitEditing={sendCode}
              />
            </Field>
            <Button title={busy ? '…' : 'Send code'} onPress={sendCode} disabled={busy} role={brand} />
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Enter the code sent to {normalisePhone(number.phone) || number.phone}, and your
              current password.
            </Text>
            <Problem>{problem}</Problem>
            {claimToken ? null : (
              <CodeEntry
                role={brand}
                testCode={testCode}
                code={code}
                onChangeCode={setCode}
                onResend={resend}
              />
            )}
            <Field label="Current password">
              <Input
                placeholder="Current password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={confirmChange}
              />
            </Field>
            <Button
              title={busy ? '…' : 'Change number'}
              onPress={confirmChange}
              disabled={busy}
              role={brand}
            />
            <Text style={styles.back} onPress={() => setStep('phone')}>
              Use a different number
            </Text>
          </>
        )}
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { ...type.subtitle, marginBottom: 14 },
  back: { ...type.meta, textAlign: 'center', marginTop: 14, fontWeight: '700' },
});
