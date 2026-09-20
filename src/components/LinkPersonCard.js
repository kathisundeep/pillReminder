import React, { useState } from 'react';
import { StyleSheet, Alert } from 'react-native';
import { pairWithCode } from '../utils/guardianCloud';
import { Card, CardTitle, CardSubtitle, Button, Field, Input } from './ui';
import { track } from '../utils/telemetry';

// The username + 6-digit code form a guardian uses to link to a person.
// `onLinked(username)` runs after a successful link.
export default function LinkPersonCard({ onLinked }) {
  const [uname, setUname] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const onPair = async () => {
    if (!uname.trim() || !code.trim())
      return Alert.alert('Missing', "Enter the person's username and their 6-digit code.");
    setBusy(true);
    const res = await pairWithCode(uname, code);
    setBusy(false);
    if (!res.ok) {
      Alert.alert('Could not link', res.error || 'Invalid username or code.');
      return;
    }
    track('guardian_linked');
    const who = res.user?.username || uname;
    setUname('');
    setCode('');
    Alert.alert('Linked', `You are now the guardian for ${who}.`);
    onLinked?.(who);
  };

  return (
    <Card>
      <CardTitle>Link a person</CardTitle>
      <CardSubtitle>
        Ask them to open PillReminder → ♥ Guardian → "Generate pairing code",
        then enter their username and the 6-digit code here.
      </CardSubtitle>
      <Field>
        <Input
          placeholder="Their username"
          autoCapitalize="none"
          autoCorrect={false}
          value={uname}
          onChangeText={setUname}
        />
      </Field>
      <Field>
        <Input
          placeholder="6-digit code"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={setCode}
          style={styles.codeInput}
        />
      </Field>
      <Button title={busy ? 'Linking…' : 'Link'} onPress={onPair} disabled={busy} role="guardian" />
    </Card>
  );
}

const styles = StyleSheet.create({
  codeInput: { letterSpacing: 6, fontWeight: '800', textAlign: 'center' },
});
