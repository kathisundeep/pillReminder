import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSession, logoutUser } from '../utils/storage';
import { getLinkedUsers, pairWithCode } from '../utils/guardianCloud';

export default function GuardianDashboardScreen({ navigation }) {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [uname, setUname] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMe(await getSession());
    setUsers(await getLinkedUsers());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
    setUname('');
    setCode('');
    Alert.alert('Linked', `You are now the guardian for ${res.user?.username || uname}.`);
    load();
  };

  const onLogout = async () => {
    await logoutUser();
    navigation.replace('Login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Guardian</Text>
          <Text style={styles.user}>{me || ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <TouchableOpacity
            style={styles.switchBtn}
            onPress={() => navigation.replace('Home')}
          >
            <Text style={styles.switchText}>My medicines</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout}>
            <Text style={styles.logout}>Log out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Link a person</Text>
          <Text style={styles.sub}>
            Ask them to open PillReminder → ♥ Guardian → "Generate pairing code",
            then enter their username and the 6-digit code here.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Their username"
            autoCapitalize="none"
            value={uname}
            onChangeText={setUname}
          />
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="6-digit code"
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            onPress={onPair}
            disabled={busy}
          >
            <Text style={styles.primaryBtnText}>{busy ? 'Linking…' : 'Link'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.listLabel}>People you look after</Text>
        {loading ? (
          <ActivityIndicator color="#4CAF50" style={{ marginTop: 20 }} />
        ) : users.length === 0 ? (
          <Text style={styles.empty}>No one linked yet.</Text>
        ) : (
          users.map((u) => (
            <TouchableOpacity
              key={u.userId}
              style={styles.userRow}
              onPress={() =>
                navigation.navigate('GuardianUser', {
                  userId: u.userId,
                  username: u.username,
                })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{u.name || u.username}</Text>
                <Text style={styles.userSub}>@{u.username}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8f6' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: 20,
    paddingTop: 24,
    backgroundColor: '#00796b',
  },
  hello: { color: '#b2dfdb', fontSize: 14 },
  user: { color: '#fff', fontSize: 22, fontWeight: '700' },
  switchBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginBottom: 8,
  },
  switchText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  logout: { color: '#fff', textDecorationLine: 'underline' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 1,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 6 },
  sub: { fontSize: 13, color: '#777', lineHeight: 18, marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  codeInput: { letterSpacing: 4, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: '#00796b',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  listLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  empty: { color: '#888', marginTop: 8 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    elevation: 1,
  },
  userName: { fontSize: 16, fontWeight: '700', color: '#222' },
  userSub: { fontSize: 13, color: '#888', marginTop: 2 },
  chevron: { fontSize: 26, color: '#bbb' },
});
