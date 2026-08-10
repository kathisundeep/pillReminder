import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSession, logoutUser } from '../utils/storage';
import { clearStoredRole, useRole } from '../utils/role';
import { getLinkedUsers, pairWithCode } from '../utils/guardianCloud';
import {
  Screen,
  Content,
  ProfileHeader,
  IconButton,
  Card,
  CardTitle,
  CardSubtitle,
  Button,
  Field,
  Input,
  Avatar,
  EmptyState,
} from '../components/ui';
import { colors, radius, shadow } from '../theme';

export default function GuardianDashboardScreen({ navigation }) {
  const { setRole } = useRole();
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
    await clearStoredRole();
    setRole(null); // swaps the navigator back to the Login flow
  };

  return (
    <Screen>
      <ProfileHeader
        name={me || ''}
        subtitle="Guardian Dashboard"
        role="guardian"
        right={
          <IconButton label="🚪" accessibilityLabel="Log out" onPress={onLogout} />
        }
      />

      <Content>
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
          <Button
            title={busy ? 'Linking…' : 'Link'}
            onPress={onPair}
            disabled={busy}
            role="guardian"
          />
        </Card>

        <Text style={styles.listLabel}>People you look after</Text>

        {loading ? (
          <ActivityIndicator color={colors.teal600} style={{ marginTop: 20 }} />
        ) : users.length === 0 ? (
          <EmptyState
            icon="🤝"
            title="No one linked yet"
            body="Link a person above to start looking after them."
          />
        ) : (
          users.map((u) => (
            <View key={u.userId} style={styles.userCard}>
              <View style={styles.userHead}>
                <Avatar name={u.name || u.username} role="guardian" size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{u.name || u.username}</Text>
                  <Text style={styles.userSub}>@{u.username} · Active link</Text>
                </View>
              </View>

              <View style={styles.userActions}>
                <Button
                  title="📋  View medicines"
                  variant="neutral"
                  onPress={() =>
                    navigation.navigate('GuardianUser', {
                      userId: u.userId,
                      username: u.username,
                    })
                  }
                />
                <Button
                  title="📊  View health report"
                  variant="neutral"
                  onPress={() =>
                    navigation.navigate('HealthReport', {
                      userId: u.userId,
                      username: u.username,
                    })
                  }
                />
                <Button
                  title="➕  Propose a medicine"
                  role="guardian"
                  onPress={() =>
                    navigation.navigate('AddMedicine', {
                      requestUserId: u.userId,
                      requestUsername: u.username,
                    })
                  }
                />
              </View>
            </View>
          ))
        )}

        {/* A guardian raises requests but had nowhere to see what happened to
            them — the screen existed and was simply not reachable from this
            half of the app. */}
        <Button
          title="📩  Requests you've sent"
          variant="neutral"
          role="guardian"
          onPress={() => navigation.navigate('Approvals')}
        />
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeInput: { letterSpacing: 6, fontWeight: '800', textAlign: 'center' },
  listLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  userCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 14,
    ...shadow.soft,
  },
  userHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  userName: { fontSize: 16, fontWeight: '800', color: colors.heading },
  userSub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  userActions: { gap: 8 },
});
