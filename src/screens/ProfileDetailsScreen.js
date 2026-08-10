import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  CardTitle,
  CardSubtitle,
  Button,
  Chip,
  ChipGroup,
  Field,
  Input,
} from '../components/ui';
import {
  GENDERS,
  getMyDetails,
  completeOnboarding,
  skipOnboarding,
} from '../utils/profile';
import { colors } from '../theme';

// The details step, shown once after registration.
//
// Skippable on purpose. The app's job is reminding someone to take medicine;
// that must not be gated behind a form an anxious or elderly user is filling in
// at nine in the evening. Home carries a quiet prompt until it is finished.
export default function ProfileDetailsScreen({ route, navigation }) {
  const editing = route.params?.editing === true;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState(null);
  const [dob, setDob] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [country, setCountry] = useState('');
  const [weightKg, setWeightKg] = useState('');

  const load = useCallback(async () => {
    const details = await getMyDetails();
    if (details) {
      setFullName(details.full_name || '');
      setGender(details.gender || null);
      setDob(details.date_of_birth || '');
      setHeightCm(details.height_cm != null ? String(details.height_cm) : '');
      setCountry(details.country || '');
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const done = () => {
    if (editing) navigation.goBack();
    else navigation.navigate('Home');
  };

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await completeOnboarding({
        full_name: fullName.trim() || null,
        gender,
        date_of_birth: dob.trim() || null,
        height_cm: heightCm.trim(),
        country: country.trim() || null,
        weightKg: weightKg.trim(),
      });
      if (!res.ok) return setProblem(res.error);
      done();
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await skipOnboarding();
      done();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.emerald600} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TitleHeader
        title={editing ? 'Your details' : 'A little about you'}
        onClose={editing ? () => navigation.goBack() : undefined}
      />
      <Content>
        <Card>
          {!editing ? (
            <>
              <CardTitle>This helps your health report</CardTitle>
              <CardSubtitle>
                Every field is optional and you can change them later in
                Settings. Your reminders already work without any of this.
              </CardSubtitle>
            </>
          ) : null}

          <Field label="Full name">
            <Input
              placeholder="e.g. Sundeep Kathi"
              value={fullName}
              onChangeText={setFullName}
            />
          </Field>

          <Field label="Gender">
            <ChipGroup>
              {GENDERS.map((g) => (
                <Chip
                  key={g.id}
                  label={g.label}
                  active={gender === g.id}
                  onPress={() => setGender(gender === g.id ? null : g.id)}
                />
              ))}
            </ChipGroup>
          </Field>

          <Field label="Date of birth">
            <Input
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
              value={dob}
              onChangeText={setDob}
            />
          </Field>
          <Text style={styles.note}>
            Your age is worked out from this, so it stays right as years pass.
          </Text>

          <Field label="Height (cm)">
            <Input
              placeholder="e.g. 172"
              keyboardType="numeric"
              value={heightCm}
              onChangeText={setHeightCm}
            />
          </Field>

          <Field label="Country">
            <Input
              placeholder="e.g. India"
              value={country}
              onChangeText={setCountry}
            />
          </Field>

          {!editing ? (
            <>
              <Field label="Current weight (kg)">
                <Input
                  placeholder="e.g. 71"
                  keyboardType="numeric"
                  value={weightKg}
                  onChangeText={setWeightKg}
                />
              </Field>
              <Text style={styles.note}>
                Saved as your first weight reading. Weight lives in Trackers
                from here on, so there is only ever one figure to trust.
              </Text>
            </>
          ) : null}
        </Card>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}

        <View style={{ gap: 8 }}>
          <Button
            title={busy ? 'Saving…' : editing ? 'Save changes' : 'Save and continue'}
            onPress={save}
            disabled={busy}
          />
          {!editing ? (
            <Button
              title="Skip for now"
              variant="neutral"
              onPress={skip}
              disabled={busy}
            />
          ) : null}
        </View>
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  note: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: -8,
    marginBottom: 14,
  },
  problem: {
    fontSize: 13,
    color: colors.skipText,
    backgroundColor: colors.skipBg,
    borderRadius: 10,
    padding: 12,
    lineHeight: 18,
  },
});
