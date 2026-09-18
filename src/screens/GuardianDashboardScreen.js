import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getSession, logoutUser } from '../utils/storage';
import { clearStoredRole, useRole } from '../utils/role';
import { getLinkedUsers } from '../utils/guardianCloud';
import LinkPersonCard from '../components/LinkPersonCard';
import { registerForPushTokenAsync, getPushRegistrationError } from '../utils/guardian';
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
  const [loading, setLoading] = useState(true);
  const [pushProblem, setPushProblem] = useState(null);

  // A guardian who cannot receive pushes misses every alert without knowing,
  // so re-check on each visit and say so on screen.
  const checkPush = useCallback(async () => {
    const token = await registerForPushTokenAsync();
    setPushProblem(token ? null : getPushRegistrationError());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMe(await getSession());
    setUsers(await getLinkedUsers());
    setLoading(false);
    checkPush();
  }, [checkPush]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
          <View style={styles.headerActions}>
            {/* Once someone is linked the code form moves off the dashboard;
                linking another person is one tap away here. */}
            {users.length > 0 ? (
              <IconButton
                label="🔗"
                accessibilityLabel="Link another person"
                onPress={() => navigation.navigate('GuardianLink')}
              />
            ) : null}
            <IconButton label="🚪" accessibilityLabel="Log out" onPress={onLogout} />
          </View>
        }
      />

      <Content>
        {pushProblem ? (
          <Card style={styles.pushWarning}>
            <CardTitle>⚠️ You will not get alerts</CardTitle>
            <CardSubtitle>{pushProblem}</CardSubtitle>
            <Button title="Try again" variant="neutral" onPress={checkPush} />
          </Card>
        ) : null}

        {!loading && users.length === 0 ? <LinkPersonCard onLinked={load} /> : null}

        <Text style={styles.listLabel}>People you look after</Text>

        {loading ? (
          <ActivityIndicator color={colors.teal600} style={{ marginTop: 20 }} />
        ) : users.length === 0 ? (
          <EmptyState
            icon="🤝"
            title="No one linked yet"
            body="Use the form above to link the person you look after."
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
                  title="💊  Today's medicines"
                  role="guardian"
                  onPress={() =>
                    navigation.navigate('GuardianUser', {
                      userId: u.userId,
                      username: u.username,
                    })
                  }
                />
                <View style={styles.userActionRow}>
                  <Button
                    title="🗓  Calendar"
                    variant="neutral"
                    style={styles.half}
                    onPress={() =>
                      navigation.navigate('Calendar', { userId: u.userId, username: u.username })
                    }
                  />
                  <Button
                    title="📄  Health report"
                    variant="neutral"
                    style={styles.half}
                    onPress={() =>
                      navigation.navigate('HealthReport', {
                        userId: u.userId,
                        username: u.username,
                      })
                    }
                  />
                </View>
                <View style={styles.userActionRow}>
                  <Button
                    title="🩺  Add reading"
                    variant="neutral"
                    style={styles.half}
                    onPress={() =>
                      navigation.navigate('Trackers', { userId: u.userId, username: u.username })
                    }
                  />
                  <Button
                    title="➕  Propose"
                    variant="neutral"
                    style={styles.half}
                    onPress={() =>
                      navigation.navigate('AddMedicine', {
                        requestUserId: u.userId,
                        requestUsername: u.username,
                      })
                    }
                  />
                </View>
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
  pushWarning: { borderWidth: 1, borderColor: colors.danger },
  headerActions: { flexDirection: 'row', gap: 8 },
  userActionRow: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
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
