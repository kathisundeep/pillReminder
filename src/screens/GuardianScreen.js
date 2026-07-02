import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getMyProfile,
  updateMySettings,
  generatePairingCode,
  getMyActiveGuardian,
  revokeGuardian,
} from '../utils/guardianCloud';

const GRACE_OPTIONS = [5, 15, 30, 60];

export default function GuardianScreen() {
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
  const notifyMode = settings.notifyMode || 'missed';
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
          `1. Install the app and tap "Guardian login".\n` +
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
      <View style={styles.center}>
        <ActivityIndicator color="#4CAF50" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
    >
      <Text style={styles.intro}>
        A guardian signs in on their own phone and can see your medicines and get
        alerted if you miss a dose.
      </Text>

      {/* Current guardian */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Your guardian</Text>
        {guardian ? (
          <>
            <Text style={styles.guardianName}>
              {guardian.guardianName || guardian.guardianUsername}
            </Text>
            <Text style={styles.sub}>@{guardian.guardianUsername} · linked</Text>
            <TouchableOpacity onPress={onRemove}>
              <Text style={styles.removeText}>Remove guardian</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.sub}>No guardian linked yet.</Text>
        )}
      </View>

      {/* Invite / change */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          {guardian ? 'Change guardian' : 'Invite a guardian'}
        </Text>
        <Text style={styles.sub}>
          Your username is <Text style={styles.bold}>{profile?.username}</Text>.
          Generate a one-time code and share it. When your new guardian uses it,
          any previous guardian is removed.
        </Text>

        {code ? (
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{code}</Text>
            <Text style={styles.codeHint}>Share with your guardian (expires in 30 days)</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryBtn, busy && styles.btnDisabled]}
          onPress={onGenerate}
          disabled={busy}
        >
          <Text style={styles.primaryBtnText}>
            {busy ? 'Working…' : code ? 'Generate a new code' : 'Generate pairing code'}
          </Text>
        </TouchableOpacity>
        {code ? (
          <TouchableOpacity style={styles.ghostBtn} onPress={shareInvite}>
            <Text style={styles.ghostBtnText}>Share invite</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Alert settings */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Alerts</Text>
        <Text style={styles.label}>Alert my guardian if I'm late by</Text>
        <View style={styles.row}>
          {GRACE_OPTIONS.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, grace === m && styles.chipOn]}
              onPress={() => patchSettings({ graceMinutes: m })}
            >
              <Text style={[styles.chipText, grace === m && styles.chipTextOn]}>
                {m} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.label}>Also notify when I take a dose</Text>
          <Switch
            value={notifyMode === 'both'}
            onValueChange={(v) => patchSettings({ notifyMode: v ? 'both' : 'missed' })}
            trackColor={{ true: '#4CAF50' }}
          />
        </View>

        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.label}>Require my approval for guardian changes</Text>
            <Text style={styles.sub}>
              When on, a guardian's "add medicine" waits for you to approve.
            </Text>
          </View>
          <Switch
            value={approvalRequired}
            onValueChange={(v) => patchSettings({ approvalRequired: v })}
            trackColor={{ true: '#4CAF50' }}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 8 },
  guardianName: { fontSize: 17, fontWeight: '700', color: '#2e7d32', marginTop: 4 },
  sub: { fontSize: 13, color: '#777', marginTop: 4, lineHeight: 18 },
  bold: { fontWeight: '800', color: '#333' },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginTop: 14, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  chipOn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  chipText: { color: '#333', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  codeBox: {
    backgroundColor: '#f1f8e9',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginVertical: 12,
  },
  codeText: { fontSize: 40, fontWeight: '800', letterSpacing: 8, color: '#2e7d32' },
  codeHint: { fontSize: 12, color: '#777', marginTop: 6 },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: '#4CAF50',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
  ghostBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#4CAF50',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  ghostBtnText: { color: '#4CAF50', fontWeight: '700' },
  removeText: {
    color: '#e53935',
    marginTop: 12,
    textDecorationLine: 'underline',
  },
});
