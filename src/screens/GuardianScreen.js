import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert, Share, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getMyProfile,
  updateMySettings,
  generatePairingCode,
  getMyGuardians,
  getMyGuardianAllowance,
  removeGuardian,
} from '../utils/guardianCloud';
import { NOTIFY_MODES, notifyModeOf } from '../utils/guardian';
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
  Avatar,
} from '../components/ui';
import { colors, radius } from '../theme';

const GRACE_OPTIONS = [5, 15, 30, 60];

export default function GuardianScreen({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [guardians, setGuardians] = useState([]);
  const [allowance, setAllowance] = useState({ limit: 0, used: 0 });
  const [code, setCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = await getMyProfile();
    setProfile(p);
    const [list, allow] = await Promise.all([getMyGuardians(), getMyGuardianAllowance()]);
    setGuardians(list);
    setAllowance(allow);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      setCode(null); // never keep a stale code on screen
    }, [load])
  );

  const settings = profile?.settings || {};
  const grace = settings.graceMinutes || 30;
  const notifyMode = notifyModeOf(profile);
  const approvalRequired = settings.approvalRequired !== false;

  const patchSettings = async (patch) => {
    const next = await updateMySettings(patch);
    setProfile((p) => ({ ...p, settings: next }));
  };

  const onGenerate = async () => {
    setBusy(true);
    try {
      const c = await generatePairingCode();
      setCode(c);
    } catch (e) {
      Alert.alert('Could not create code', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const shareInvite = async () => {
    if (!code || !profile) return;
    try {
      await Share.share({
        message:
          `Be my guardian on PillReminder.\n\n` +
          `1. Install the app and tap "I'm a guardian".\n` +
          `2. Enter my username: ${profile.username}\n` +
          `3. Enter this code: ${code}\n\n(Code expires in 30 days.)`,
      });
    } catch (e) {}
  };

  const onRemove = (g) => {
    Alert.alert('Remove guardian', `Stop sharing with @${g.username}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeGuardian(g.guardianId);
          load();
        },
      },
    ]);
  };

  // Room on the plan for another guardian?
  const { limit, used } = allowance;
  const canInvite = used < limit;

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.teal600} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TitleHeader title="Guardian" onClose={() => navigation.goBack()} />
      <Content>
        <Card>
          <CardTitle>Your guardians</CardTitle>
          <Text style={styles.allowance}>
            {limit === 0
              ? 'Your plan does not include a guardian.'
              : `Your plan allows ${limit} guardian${limit > 1 ? 's' : ''} · ${used} linked`}
          </Text>
          {guardians.length ? (
            guardians.map((g) => (
              <View key={g.guardianId} style={styles.guardianRow}>
                <Avatar name={g.name || g.username} role="guardian" size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.guardianName}>{g.name || g.username}</Text>
                  <Text style={styles.sub}>@{g.username} · linked</Text>
                </View>
                <Button
                  title="Remove"
                  variant="neutral"
                  onPress={() => onRemove(g)}
                  textStyle={{ color: colors.danger }}
                  accessibilityLabel={`Remove @${g.username}`}
                />
              </View>
            ))
          ) : (
            <CardSubtitle>
              A guardian signs in on their own phone and can see your medicines
              and be alerted if you miss a dose. No guardian linked yet.
            </CardSubtitle>
          )}
        </Card>

        {canInvite ? (
          <Card>
            <CardTitle>Invite a guardian</CardTitle>
            <CardSubtitle>
              Your username is {profile?.username}. Generate a one-time code and
              share it with the person who will look after you.
            </CardSubtitle>

            {code ? (
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{String(code).split('').join(' ')}</Text>
                <Text style={styles.codeHint}>
                  Share with your guardian (expires in 30 days)
                </Text>
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              <Button
                title={busy ? 'Working…' : code ? 'Generate a new code' : 'Generate pairing code'}
                onPress={onGenerate}
                disabled={busy}
                role="guardian"
              />
              {code ? (
                <Button title="Share invite" variant="neutral" onPress={shareInvite} />
              ) : null}
            </View>
          </Card>
        ) : (
          <Card>
            <CardTitle>{limit === 0 ? 'Guardians need a plan' : 'Your plan is full'}</CardTitle>
            <CardSubtitle>
              {limit === 0
                ? 'Choose a plan with 1, 2 or 3 guardians to invite someone to look after you.'
                : `All ${limit} guardian place${limit > 1 ? 's are' : ' is'} taken. Upgrade your plan, or remove a guardian to invite someone else.`}
            </CardSubtitle>
            <Button title="See plans" onPress={() => navigation.navigate('Plans')} role="guardian" />
          </Card>
        )}

        <Card>
          <CardTitle>Alerts</CardTitle>

          <Field label="Alert my guardian if I'm late by">
            <ChipGroup>
              {GRACE_OPTIONS.map((m) => (
                <Chip
                  key={m}
                  label={`${m} min`}
                  active={grace === m}
                  onPress={() => patchSettings({ graceMinutes: m })}
                />
              ))}
            </ChipGroup>
          </Field>

          <Field label="Notify my guardian">
            <ChipGroup>
              {NOTIFY_MODES.map((m) => (
                <Chip
                  key={m.id}
                  label={m.label}
                  active={notifyMode === m.id}
                  onPress={() => patchSettings({ notifyMode: m.id })}
                />
              ))}
            </ChipGroup>
          </Field>

          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.switchLabel}>
                Require my approval for guardian changes
              </Text>
              <Text style={styles.sub}>
                When on, a guardian's "add medicine" waits for you to approve.
              </Text>
            </View>
            <Switch
              value={approvalRequired}
              onValueChange={(v) => patchSettings({ approvalRequired: v })}
              trackColor={{ true: colors.emerald600 }}
            />
          </View>
        </Card>
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  allowance: { fontSize: 13, color: colors.muted, marginBottom: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  guardianRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  guardianName: { fontSize: 16, fontWeight: '800', color: colors.heading },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 2, lineHeight: 18 },
  codeBox: {
    backgroundColor: colors.cardSubtle,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    alignItems: 'center',
    marginBottom: 14,
  },
  codeText: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 4,
    color: colors.heading,
  },
  codeHint: { fontSize: 12, color: colors.muted, marginTop: 8 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  switchLabel: { fontSize: 14, fontWeight: '700', color: colors.heading },
});
