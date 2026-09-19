import React, { useEffect, useRef, useState } from 'react';
import { AppState, Alert, Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ChangePasswordScreen from './src/screens/ChangePasswordScreen';
import ChangePhoneScreen from './src/screens/ChangePhoneScreen';
import ProfileDetailsScreen from './src/screens/ProfileDetailsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import HomeScreen from './src/screens/HomeScreen';
import AddMedicineScreen from './src/screens/AddMedicineScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import GuardianScreen from './src/screens/GuardianScreen';
import GuardianDashboardScreen from './src/screens/GuardianDashboardScreen';
import GuardianUserScreen from './src/screens/GuardianUserScreen';
import GuardianLinkScreen from './src/screens/GuardianLinkScreen';
import ApprovalsScreen from './src/screens/ApprovalsScreen';
import TrackersScreen from './src/screens/TrackersScreen';
import HealthReportScreen from './src/screens/HealthReportScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import PlansScreen from './src/screens/PlansScreen';
import { getSession, pruneOldHistory, logoutUser } from './src/utils/storage';
import { ensureNotificationSetup } from './src/utils/notifications';
import {
  registerForPushTokenAsync,
  registerBackgroundSweep,
  sweepMissedDoses,
} from './src/utils/guardian';
import { alarmMedicineIds, applyAlarmAction, parseAlarmUrl } from './src/utils/alarmActions';
import { dismissAlarm } from './modules/ringtones';
import { resyncAlarmsFromCloud } from './src/utils/sync';
import {
  ROLES,
  RoleProvider,
  resolveRole,
  getStoredRole,
  clearStoredRole,
} from './src/utils/role';
import { checkGuardianSession } from './src/utils/guardianCloud';
import { applyUpdateIfAny } from './src/utils/updates';
import ErrorBoundary from './src/components/ErrorBoundary';

const Stack = createNativeStackNavigator();

export default function App() {
  const [booted, setBooted] = useState(false);
  // null = signed out. Otherwise the ACTIVE FLOW, which decides not just the
  // landing screen but which screens exist at all.
  const [role, setRole] = useState(null);
  const navRef = useRef(null);
  const navReady = useRef(false);
  const pendingAlarmUrl = useRef(null);

  // Each role registers a different set of screens, so a route that exists in
  // one flow is genuinely absent in the other. Navigating to a missing route
  // throws, so check before moving.
  const go = (name, params) => {
    const nav = navRef.current;
    if (!nav) return;
    const routes = nav.getRootState?.()?.routeNames || [];
    if (routes.includes(name)) nav.navigate(name, params);
  };

  // A native alarm's link: an answer from its buttons (applied to every
  // medicine it carries), or a tap that opens the alarm screen.
  const handleAlarmUrl = async (url) => {
    const alarm = parseAlarmUrl(url);
    if (!alarm) return;
    const { data, action, nid } = alarm;
    if (['TAKEN', 'RESCHEDULE', 'SKIP'].includes(action)) {
      dismissAlarm(nid); // stops the ringing
      await applyAlarmAction(await getSession(), action, data);
      go('Home');
    } else {
      go('Alarm', {
        medicineIds: alarmMedicineIds(data),
        slot: data.slot ?? null,
        nativeNid: nid,
      });
    }
  };

  const flushPendingAlarm = () => {
    if (!navReady.current || !pendingAlarmUrl.current) return;
    const url = pendingAlarmUrl.current;
    pendingAlarmUrl.current = null;
    handleAlarmUrl(url);
  };

  // One phone per guardian account. If another phone has signed in to it,
  // sign out here — the server has already stopped sending this phone the
  // people's data and alerts.
  useEffect(() => {
    if (role !== ROLES.GUARDIAN) return undefined;
    let stopped = false;
    const check = async () => {
      if (stopped || (await checkGuardianSession()) !== 'replaced' || stopped) return;
      stopped = true;
      await logoutUser();
      await clearStoredRole();
      setRole(null);
      Alert.alert(
        'Signed out',
        'This guardian account was just signed in on another phone. A guardian account can be used on one phone at a time.'
      );
    };
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    const timer = setInterval(check, 60000);
    return () => {
      stopped = true;
      sub?.remove?.();
      clearInterval(timer);
    };
  }, [role]);

  useEffect(() => {
    (async () => {
      await ensureNotificationSetup();
      const user = await getSession();
      // Open straight into the flow this phone last used, and confirm it with
      // the server afterwards. Waiting on the network here held the splash
      // screen up for every launch.
      const stored = user ? await getStoredRole() : null;
      const activeRole = user ? stored || (await resolveRole()) : null;
      setRole(activeRole);
      setBooted(true);
      if (user && stored) {
        resolveRole().then((fresh) => {
          if (fresh && fresh !== stored) setRole(fresh);
        });
      }

      // Only a patient has medicines to arm alarms for or history to prune.
      if (user && activeRole !== ROLES.GUARDIAN) {
        resyncAlarmsFromCloud();
        pruneOldHistory(); // 2-year retention fallback
      }
      // Both roles register a push token: the patient's device pushes to the
      // guardian, and the guardian's device pushes approval requests back.
      registerForPushTokenAsync();
      registerBackgroundSweep();
      sweepMissedDoses();

      // Last, so a reload cannot cut short the setup above.
      applyUpdateIfAny();
    })();

    // Re-check for missed doses whenever the app returns to the foreground —
    // and pick up any published update, so a change never sits downloaded but
    // unapplied waiting for a cold start that Android may never give it.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      sweepMissedDoses();
      applyUpdateIfAny();
    });

    // Native alarms (Android) open the app with a link rather than a
    // notification response. One that arrives before navigation is ready —
    // a cold start from the alarm — waits for onReady.
    const linkSub = Linking.addEventListener('url', ({ url }) => handleAlarmUrl(url));
    Linking.getInitialURL()
      .then((url) => {
        if (!url) return;
        pendingAlarmUrl.current = url;
        flushPendingAlarm();
      })
      .catch(() => {});

    const receivedSub = Notifications.addNotificationReceivedListener(
      (notification) => {
        const data = notification.request.content.data || {};
        if (data.type === 'pill-alarm') {
          go('Alarm', {
            medicineIds: alarmMedicineIds(data),
            slot: data.slot ?? null,
            notificationId: notification.request.identifier,
          });
        }
      }
    );

    const responseSub = Notifications.addNotificationResponseReceivedListener(
      async (response) => {
        const data = response.notification.request.content.data || {};

        // A guardian asked to add a medicine — take the patient to the
        // approvals screen rather than leaving them to find the banner.
        if (data.type === 'guardian-request') {
          go('Approvals');
          return;
        }

        if (data.type !== 'pill-alarm') return;
        const action = response.actionIdentifier;
        const notificationId = response.notification.request.identifier;

        // Taken / Reschedule / Skip act on every medicine the alarm carries.
        // Anything else is a tap on the notification itself: open the alarm
        // screen, where each medicine can be answered on its own.
        if (['TAKEN', 'RESCHEDULE', 'SKIP'].includes(action)) {
          await applyAlarmAction(await getSession(), action, data);
          try {
            await Notifications.dismissNotificationAsync(notificationId);
          } catch (e) {}
          go('Home');
        } else {
          go('Alarm', {
            medicineIds: alarmMedicineIds(data),
            slot: data.slot ?? null,
            notificationId,
          });
        }
      }
    );

    return () => {
      receivedSub.remove();
      responseSub.remove();
      appStateSub.remove();
      linkSub?.remove?.();
    };
  }, []);

  if (!booted) return null;

  const isGuardian = role === ROLES.GUARDIAN;

  return (
    <ErrorBoundary>
      <RoleProvider value={{ role, setRole }}>
        <NavigationContainer
          ref={navRef}
          onReady={() => {
            navReady.current = true;
            flushPendingAlarm();
          }}
        >
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: {
              backgroundColor: isGuardian ? '#00796b' : '#4CAF50',
            },
            headerTintColor: '#fff',
          }}
        >
          {/* Signed out */}
          {role === null && (
            <>
              <Stack.Screen
                name="Login"
                component={LoginScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Register"
                component={RegisterScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ForgotPassword"
                component={ForgotPasswordScreen}
                options={{ headerShown: false }}
              />
            </>
          )}

          {/* Guardian flow. No Home, no AddMedicine-for-self, no Alarm, no
              Trackers, no Plans — a guardian has no medicines of their own.
              AddMedicine appears only in request-for-a-patient mode, and
              HealthReport only ever reads a linked patient's data. */}
          {isGuardian && (
            <>
              <Stack.Screen
                name="GuardianDashboard"
                component={GuardianDashboardScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="GuardianUser"
                component={GuardianUserScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="GuardianLink"
                component={GuardianLinkScreen}
                options={{ headerShown: false }}
              />
              {/* Only ever opened for a linked person: a guardian records a
                  reading for them. */}
              <Stack.Screen
                name="Trackers"
                component={TrackersScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddMedicine"
                component={AddMedicineScreen}
                options={{ title: 'Request medicine' }}
              />
              <Stack.Screen
                name="HealthReport"
                component={HealthReportScreen}
                options={{ title: 'Health report' }}
              />
              {/* Approvals used to be registered in the PATIENT stack only, so
                  a guardian's navigate('Approvals') hit a route that did not
                  exist and was silently dropped by the guard in this file —
                  they could never see the requests they had raised. */}
              <Stack.Screen
                name="Approvals"
                component={ApprovalsScreen}
                options={{ title: 'Requests' }}
              />
              <Stack.Screen
                name="Calendar"
                component={CalendarScreen}
                options={{ title: 'Adherence' }}
              />
              <Stack.Screen
                name="ProfileDetails"
                component={ProfileDetailsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Settings"
                component={SettingsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ChangePassword"
                component={ChangePasswordScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ChangePhone"
                component={ChangePhoneScreen}
                options={{ headerShown: false }}
              />
            </>
          )}

          {/* Patient flow */}
          {role === ROLES.PATIENT && (
            <>
              <Stack.Screen
                name="Home"
                component={HomeScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="AddMedicine"
                component={AddMedicineScreen}
                options={{ title: 'Add medicine' }}
              />
              <Stack.Screen
                name="Guardian"
                component={GuardianScreen}
                options={{ title: 'Guardian' }}
              />
              <Stack.Screen
                name="Approvals"
                component={ApprovalsScreen}
                options={{ title: 'Guardian requests' }}
              />
              <Stack.Screen
                name="Calendar"
                component={CalendarScreen}
                options={{ title: 'Adherence' }}
              />
              <Stack.Screen
                name="Trackers"
                component={TrackersScreen}
                options={{ title: 'Health trackers' }}
              />
              <Stack.Screen
                name="HealthReport"
                component={HealthReportScreen}
                options={{ title: 'Health report' }}
              />
              <Stack.Screen
                name="Plans"
                component={PlansScreen}
                options={{ title: 'Plans & subscription' }}
              />
              <Stack.Screen
                name="Alarm"
                component={AlarmScreen}
                options={{ headerShown: false, gestureEnabled: false }}
              />
              <Stack.Screen
                name="ProfileDetails"
                component={ProfileDetailsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="Settings"
                component={SettingsScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ChangePassword"
                component={ChangePasswordScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ChangePhone"
                component={ChangePhoneScreen}
                options={{ headerShown: false }}
              />
            </>
          )}
        </Stack.Navigator>
        </NavigationContainer>
      </RoleProvider>
    </ErrorBoundary>
  );
}
