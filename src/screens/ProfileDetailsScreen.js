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
  Segmented,
} from '../components/ui';
import {
  GENDERS,
  getMyDetails,
  completeOnboarding,
  skipOnboarding,
} from '../utils/profile';
import {
  HEIGHT_UNITS, WEIGHT_UNITS,
  heightToDisplay, heightToCm,
  weightToDisplay, weightToKg,
  isoToDisplay, displayToIso, formatDateInput, ageFromIso,
} from '../utils/units';
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
  // Held in the DISPLAY form, DD/MM/YYYY, and converted on save. Keeping it as
  // typed is what lets the slashes appear while typing.
  const [dob, setDob] = useState('');
  const [heightUnit, setHeightUnit] = useState('cm');
  const [weightUnit, setWeightUnit] = useState('kg');
  const [heightCm, setHeightCm] = useState('');
  const [country, setCountry] = useState('');
  const [weightKg, setWeightKg] = useState('');

  const load = useCallback(async () => {
    const details = await getMyDetails();
    if (details) {
      setFullName(details.full_name || '');
      setGender(details.gender || null);
      setDob(isoToDisplay(details.date_of_birth) || '');
      setHeightCm(
        details.height_cm != null ? heightToDisplay(details.height_cm, 'cm') : ''
      );
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
        date_of_birth: displayToIso(dob) || null,
        // Always centimetres in storage, whatever unit was on screen.
        height_cm: heightToCm(heightCm, heightUnit) ?? '',
        country: country.trim() || null,
        weightKg: weightToKg(weightKg, weightUnit) ?? '',
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
              placeholder="28/01/2000"
              keyboardType="number-pad"
              autoCorrect={false}
              maxLength={10}
              value={dob}
              onChangeText={(text) => setDob(formatDateInput(text, dob))}
            />
          </Field>
          <Text style={styles.note}>
            Day first, as DD/MM/YYYY. Your age is worked out from this, so it
            stays right as years pass.
            {ageFromIso(displayToIso(dob)) != null
              ? `  That makes you ${ageFromIso(displayToIso(dob))}.`
              : ''}
          </Text>

          <Field label="Height">
            <View style={styles.unitRow}>
              <Input
                style={{ flex: 1 }}
                placeholder={heightUnit === 'cm' ? 'e.g. 172' : 'e.g. 68'}
                keyboardType="numeric"
                value={heightCm}
                onChangeText={setHeightCm}
              />
              <Segmented
                style={styles.unitToggle}
                value={heightUnit}
                onChange={(next) => {
                  // Convert what is on screen so switching units does not
                  // reinterpret 172 cm as 172 inches.
                  const cm = heightToCm(heightCm, heightUnit);
                  setHeightUnit(next);
                  if (cm != null) setHeightCm(heightToDisplay(cm, next));
                }}
                options={HEIGHT_UNITS.map((u) => ({ value: u.id, label: u.label }))}
              />
            </View>
          </Field>

          <Field label="Country">
            <Input
              placeholder="e.g. India"
              value={country}
              onChangeText={setCountry}
            />
          </Field>

          <Field label="Weight">
            <View style={styles.unitRow}>
              <Input
                style={{ flex: 1 }}
                placeholder={weightUnit === 'kg' ? 'e.g. 71' : 'e.g. 156'}
                keyboardType="numeric"
                value={weightKg}
                onChangeText={setWeightKg}
              />
              <Segmented
                style={styles.unitToggle}
                value={weightUnit}
                onChange={(next) => {
                  const kg = weightToKg(weightKg, weightUnit);
                  setWeightUnit(next);
                  if (kg != null) setWeightKg(weightToDisplay(kg, next));
                }}
                options={WEIGHT_UNITS.map((u) => ({ value: u.id, label: u.label }))}
              />
            </View>
          </Field>
          <Text style={styles.note}>
            Recorded here rather than in Trackers, so there is one figure to
            trust. Each save is kept, so the chart still shows how it changes.
          </Text>
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
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unitToggle: { width: 132 },
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
