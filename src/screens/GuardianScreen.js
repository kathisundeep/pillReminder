import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Share,
  ActivityIndicator,
} from 'react-native';
import {
  getSession,
  getGuardian,
  setGuardian,
  clearGuardian,
  getOwnPushToken,
} from '../utils/storage';
import {
  registerForPushTokenAsync,
  sendGuardianPush,
} from '../utils/guardian';

const GRACE_OPTIONS = [5, 15, 30, 60];

export default function GuardianScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState('');
  const [pushToken, setPushToken] = useState('');
  const [graceMinutes, setGraceMinutes] = useState(30);
  const [notifyMode, setNotifyMode] = useState('missed');
  const [busy, setBusy] = useState(false);

  const [myCode, setMyCode] = useState(null);
  const [loadingCode, setLoadingCode] = useState(true);

  useEffect(() => {
    (async () => {
      const u = await getSession();
      setUser(u);
      if (u) {
        const g = await getGuardian(u);
        if (g) {
          setEnabled(!!g.enabled);
          setName(g.name || '');
          setPushToken(g.pushToken || '');
          setGraceMinutes(g.graceMinutes || 30);
          setNotifyMode(g.notifyMode || 'missed');
        }
      }
      // Resolve this device's own pairing code (so it can be a guardian).
      let token = await getOwnPushToken();
      if (!token) token = await registerForPushTokenAsync();
      setMyCode(token);
      setLoadingCode(false);
    })();
  }, []);

  const onSave = async () => {
    if (enabled) {
      if (!name.trim()) return Alert.alert('Missing', "Enter the guardian's name.");
      if (!pushToken.trim() || !pushToken.includes('ExponentPushToken'))
        return Alert.alert(
          'Invalid code',
          "Paste the guardian's pairing code. It looks like ExponentPushToken[xxxxxxxx]."
        );
    }
    setBusy(true);
    try {
      await setGuardian(user, {
        enabled,
        name: name.trim(),
        pushToken: pushToken.trim(),
        graceMinutes,
        notifyMode,
      });
      Alert.alert(
        'Saved',
        enabled
          ? `${name.trim()} will be alerted if you miss a dose by more than ${graceMinutes} minutes.`
          : 'Guardian alerts are turned off.'
      );
      navigation.goBack();
    } catch (e) {
      Alert.alert('Save failed', String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    if (!pushToken.trim() || !pushToken.includes('ExponentPushToken'))
      return Alert.alert('Invalid code', "Paste the guardian's pairing code first.");
    setBusy(true);
    const ok = await sendGuardianPush(pushToken.trim(), {
      title: 'Test alert from PillReminder',
      body: `${user || 'Your dependent'} set you as their guardian. Alerts will arrive here.`,
    });
    setBusy(false);
    Alert.alert(
      ok ? 'Test sent' : 'Could not send',
      ok
        ? "If the code is correct, the guardian's phone should buzz now."
        : 'Check the pairing code and that both phones have internet.'
    );
  };

  const onRemove = () => {
    Alert.alert('Remove guardian', 'Stop alerting your guardian?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await clearGuardian(user);
          setEnabled(false);
          setName('');
          setPushToken('');
          navigation.goBack();
        },
      },
    ]);
  };

  const shareMyCode = async () => {
    if (!myCode) return;
    try {
      await Share.share({
        message: `Add me as your guardian in PillReminder. Paste this pairing code:\n\n${myCode}`,
      });
    } catch (e) {}
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>
        A guardian gets a notification on their phone if you don't take a
        medicine in time — so they can call you or bring it over.
      </Text>

      {/* ---- Set up MY guardian ---- */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Alert my guardian</Text>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ true: '#4CAF50' }}
          />
        </View>

        <Text style={styles.label}>Guardian's name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Priya (daughter)"
          value={name}
          onChangeText={setName}
          editable={enabled}
        />

        <Text style={styles.label}>Guardian's pairing code</Text>
        <TextInput
          style={[styles.input, styles.codeInput]}
          placeholder="ExponentPushToken[...]"
          value={pushToken}
          onChangeText={setPushToken}
          editable={enabled}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Text style={styles.hint}>
          Ask your guardian to open this screen on their phone and tap “Share my
          code”, then paste it here.
        </Text>

        <Text style={styles.label}>Notify guardian this long after a missed/skipped dose</Text>
        <View style={styles.row}>
          {GRACE_OPTIONS.map((m) => (
            <TouchableOpacity
              key={m}
              disabled={!enabled}
              style={[
                styles.chip,
                graceMinutes === m && styles.chipOn,
                !enabled && styles.chipDisabled,
              ]}
              onPress={() => setGraceMinutes(m)}
            >
              <Text
                style={[styles.chipText, graceMinutes === m && styles.chipTextOn]}
              >
                {m} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>When to notify the guardian</Text>
        <View style={styles.modeCol}>
          <TouchableOpacity
            disabled={!enabled}
            style={[
              styles.modeOption,
              notifyMode === 'missed' && styles.modeOptionOn,
              !enabled && styles.chipDisabled,
            ]}
            onPress={() => setNotifyMode('missed')}
          >
            <Text
              style={[
                styles.modeTitle,
                notifyMode === 'missed' && styles.modeTitleOn,
              ]}
            >
              Only missed / skipped
            </Text>
            <Text style={styles.modeSub}>
              Alert the guardian only when a dose is missed or skipped.
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!enabled}
            style={[
              styles.modeOption,
              notifyMode === 'both' && styles.modeOptionOn,
              !enabled && styles.chipDisabled,
            ]}
            onPress={() => setNotifyMode('both')}
          >
            <Text
              style={[
                styles.modeTitle,
                notifyMode === 'both' && styles.modeTitleOn,
              ]}
            >
              Taken and missed
            </Text>
            <Text style={styles.modeSub}>
              Also send a confirmation to the guardian each time a dose is taken.
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, busy && styles.btnDisabled]}
          onPress={onSave}
          disabled={busy}
        >
          <Text style={styles.primaryBtnText}>
            {busy ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>

        {enabled && (
          <TouchableOpacity style={styles.ghostBtn} onPress={onTest} disabled={busy}>
            <Text style={styles.ghostBtnText}>Send test alert to guardian</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={onRemove}>
          <Text style={styles.removeText}>Remove guardian</Text>
        </TouchableOpacity>
      </View>

      {/* ---- I am a guardian for someone ---- */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>I'm a guardian</Text>
        <Text style={styles.hint}>
          Share this device's pairing code with the person you look after. They
          paste it into the section above on their phone.
        </Text>
        {loadingCode ? (
          <ActivityIndicator style={{ marginTop: 14 }} color="#4CAF50" />
        ) : myCode ? (
          <>
            <View style={styles.codeBox}>
              <Text selectable style={styles.codeBoxText}>
                {myCode}
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={shareMyCode}>
              <Text style={styles.primaryBtnText}>Share my code</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.warn}>
            Couldn't get a pairing code. Enable notifications and open this on a
            real device (not an emulator).
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
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
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  codeInput: { minHeight: 64, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: '#888', marginTop: 8, lineHeight: 17 },
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
  chipDisabled: { opacity: 0.5 },
  chipText: { color: '#333', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  modeCol: { marginTop: 2 },
  modeOption: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  modeOptionOn: { borderColor: '#4CAF50', backgroundColor: '#f1f8e9' },
  modeTitle: { fontSize: 15, fontWeight: '700', color: '#333' },
  modeTitleOn: { color: '#2e7d32' },
  modeSub: { fontSize: 12, color: '#888', marginTop: 3, lineHeight: 16 },
  primaryBtn: {
    marginTop: 18,
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
    textAlign: 'center',
    marginTop: 14,
    textDecorationLine: 'underline',
  },
  codeBox: {
    backgroundColor: '#f1f8e9',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  codeBoxText: { fontSize: 13, color: '#33691e', fontFamily: 'monospace' },
  warn: { color: '#e65100', marginTop: 12, fontSize: 13 },
});
