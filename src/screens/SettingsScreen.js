import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Screen,
  Content,
  TitleHeader,
  Card,
  CardTitle,
  CardSubtitle,
  Button,
  Avatar,
  Pill,
} from '../components/ui';
import { getMyDetails } from '../utils/profile';
import { logoutUser } from '../utils/storage';
import { clearStoredRole, useRole, ROLES } from '../utils/role';
import { colors } from '../theme';

// What a user may and may not change about themselves.
//
// Editable here: name, gender, date of birth, height, country.
// Elsewhere:     weight (Trackers — one source of truth).
// Never:         username, because a guardian pairs against it, and the role,
//                because it decides which half of the app you are in. Both are
//                pinned server-side by the guard_profile_columns trigger, so
//                this screen is agreeing with the database rather than being
//                the only thing enforcing it.
export default function SettingsScreen({ navigation }) {
  const { role, setRole } = useRole();
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setDetails(await getMyDetails());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onLogout = async () => {
    await logoutUser();
    await clearStoredRole();
    setRole(null);
  };

  const notYet = (what) =>
    Alert.alert(
      `${what} is not available yet`,
      'This needs the backend to be reachable first.'
    );

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.emerald600} />
        </View>
      </Screen>
    );
  }

  const isGuardian = role === ROLES.GUARDIAN;
  const brandRole = isGuardian ? 'guardian' : 'patient';

  return (
    <Screen>
      <TitleHeader title="Settings" onClose={() => navigation.goBack()} />
      <Content>
        <Card>
          <View style={styles.identity}>
            <Avatar
              name={details?.full_name || details?.username}
              role={brandRole}
              size={52}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {details?.full_name || details?.username || ''}
              </Text>
              <Text style={styles.handle}>@{details?.username}</Text>
            </View>
            <Pill
              bg={isGuardian ? colors.teal50 : colors.emerald50}
              color={isGuardian ? colors.teal700 : colors.emerald700}
            >
              {isGuardian ? 'Guardian' : 'Patient'}
            </Pill>
          </View>

          <Text style={styles.locked}>
            Your username and account type cannot be changed — a guardian pairs
            using your username.
          </Text>
        </Card>

        <Card>
          <CardTitle>Your details</CardTitle>
          <CardSubtitle>
            {details?.date_of_birth || details?.height_cm || details?.gender
              ? [
                  details?.age != null ? `${details.age} years` : null,
                  details?.gender
                    ? details.gender === 'undisclosed'
                      ? null
                      : details.gender
                    : null,
                  details?.height_cm ? `${details.height_cm} cm` : null,
                  details?.country || null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Nothing recorded yet.'
              : 'Nothing recorded yet — this helps your health report.'}
          </CardSubtitle>
          <Button
            title="Edit name, gender, date of birth, height, country"
            variant="neutral"
            onPress={() =>
              navigation.navigate('ProfileDetails', { editing: true })
            }
          />
          {!isGuardian ? (
            <Text style={styles.hint}>
              Weight is recorded in Trackers, so there is only one figure to
              trust.
            </Text>
          ) : null}
        </Card>

        <Card>
          <CardTitle>Sign-in &amp; recovery</CardTitle>
          <CardSubtitle>
            {details?.phone
              ? `Verified number ${details.phone}`
              : 'No phone number on this account.'}
          </CardSubtitle>
          <View style={{ gap: 8 }}>
            <Button
              title="Change password"
              variant="neutral"
              onPress={() => notYet('Changing your password')}
            />
            <Button
              title="Change phone number"
              variant="neutral"
              onPress={() => notYet('Changing your phone number')}
            />
          </View>
          <Text style={styles.hint}>
            Changing your number needs a fresh code sent to the new one — it is
            what gets you back in if you forget your password.
          </Text>
        </Card>

        {!isGuardian ? (
          <Card>
            <CardTitle>Care &amp; plan</CardTitle>
            <View style={{ gap: 8 }}>
              <Button
                title="♥  Guardian"
                variant="neutral"
                onPress={() => navigation.navigate('Guardian')}
              />
              <Button
                title="⭐  Plans & subscription"
                variant="neutral"
                onPress={() => navigation.navigate('Plans')}
              />
            </View>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Legal</CardTitle>
          <View style={{ gap: 8 }}>
            <Button
              title="Privacy policy"
              variant="neutral"
              onPress={() => notYet('The privacy policy')}
            />
            <Button
              title="Terms and conditions"
              variant="neutral"
              onPress={() => notYet('The terms and conditions')}
            />
          </View>
        </Card>

        <Button title="Log out" variant="danger" onPress={onLogout} />
      </Content>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontSize: 17, fontWeight: '800', color: colors.heading },
  handle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  locked: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 14,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 10,
  },
});
