import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Switch, Alert, Share, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getMyProfile,
  updateMySettings,
  generatePairingCode,
  getMyActiveGuardian,
  revokeGuardian,
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
  const [guardian, setGuardian] = useState(null);
  const [code, setCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const p = await getMyProfile();
    setProfile(p);
    setGuardian(await getMyActiveGuardian());
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

  const onRemove = () => {
    Alert.alert('Remove guardian', 'Stop sharing with your guardian?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await revokeGuardian();
          load();
        },
      },
    ]);
  };

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
          <CardTitle>Your guardian</CardTitle>
          {guardian ? (
            <>
              <View style={styles.guardianRow}>
                <Avatar
                  name={guardian.guardianName || guardian.guardianUsername}
                  role="guardian"
                  size={44}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.guardianName}>
                    {guardian.guardianName || guardian.guardianUsername}
                  </Text>
                  <Text style={styles.sub}>
                    @{guardian.guardianUsername} · linked
                  </Text>
                </View>
              </View>
              <Button
                title="Remove guardian"
                variant="neutral"
                onPress={onRemove}
                textStyle={{ color: colors.danger }}
              />
            </>
          ) : (
            <CardSubtitle>
              A guardian signs in on their own phone and can see your medicines
              and be alerted if you miss a dose. No guardian linked yet.
            </CardSubtitle>
          )}
        </Card>

        <Card>
          <CardTitle>{guardian ? 'Change guardian' : 'Invite a guardian'}</CardTitle>
          <CardSubtitle>
            Your username is {profile?.username}. Generate a one-time code and
            share it — when your new guardian uses it, any previous guardian is
            removed.
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
