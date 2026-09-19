import React, { useState } from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { Button, Field, Input, TitleHeader, Screen, Content } from '../components/ui';
import { Problem } from '../components/CodeEntry';
import { changePassword, PASSWORD_MIN } from '../utils/onboarding';
import { useRole, ROLES } from '../utils/role';
import { type } from '../theme';

// Signed in: the current password, then the new one twice. Forgotten the
// current one? "Forgot password?" on the login screen resets it by phone.
export default function ChangePasswordScreen({ navigation }) {
  const { role } = useRole();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await changePassword({ current, next, confirm });
      if (!res.ok) return setProblem(res.error);
      Alert.alert('Password changed', 'Use your new password next time you log in.');
      navigation.goBack();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TitleHeader title="Change password" onClose={() => navigation.goBack()} />
      <Content>
        <Text style={styles.hint}>
          New password: at least {PASSWORD_MIN} characters, with a letter and a number.
        </Text>
        <Problem>{problem}</Problem>
        <Field label="Current password">
          <Input placeholder="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
        </Field>
        <Field label="New password">
          <Input placeholder="New password" secureTextEntry value={next} onChangeText={setNext} />
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
        <Button
          title={busy ? '…' : 'Save new password'}
          onPress={save}
          disabled={busy}
          role={role === ROLES.GUARDIAN ? 'guardian' : 'patient'}
        />
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { ...type.subtitle, marginBottom: 14 },
});
