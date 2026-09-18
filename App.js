import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import ProfileDetailsScreen from './src/screens/ProfileDetailsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import HomeScreen from './src/screens/HomeScreen';
import AddMedicineScreen from './src/screens/AddMedicineScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import GuardianScreen from './src/screens/GuardianScreen';
import GuardianDashboardScreen from './src/screens/GuardianDashboardScreen';
import GuardianUserScreen from './src/screens/GuardianUserScreen';
import ApprovalsScreen from './src/screens/ApprovalsScreen';
import TrackersScreen from './src/screens/TrackersScreen';
import HealthReportScreen from './src/screens/HealthReportScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import PlansScreen from './src/screens/PlansScreen';
import { getSession, pruneOldHistory } from './src/utils/storage';
import { ensureNotificationSetup } from './src/utils/notifications';
import {
  registerForPushTokenAsync,
  registerBackgroundSweep,
  sweepMissedDoses,
} from './src/utils/guardian';
import { alarmMedicineIds, applyAlarmAction } from './src/utils/alarmActions';
import { resyncAlarmsFromCloud } from './src/utils/sync';
import { ROLES, RoleProvider, resolveRole } from './src/utils/role';
import { applyUpdateIfAny } from './src/utils/updates';
import ErrorBoundary from './src/components/ErrorBoundary';

const Stack = createNativeStackNavigator();

export default function App() {
  const [booted, setBooted] = useState(false);
  // null = signed out. Otherwise the ACTIVE FLOW, which decides not just the
  // landing screen but which screens exist at all.
  const [role, setRole] = useState(null);
  const navRef = useRef(null);

  useEffect(() => {
    (async () => {
      await ensureNotificationSetup();
      const user = await getSession();
      const activeRole = user ? await resolveRole() : null;
      setRole(activeRole);
      setBooted(true);

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

    // Each role registers a different set of screens, so a route that exists in
    // one flow is genuinely absent in the other. Navigating to a missing route
    // throws, so check before moving.
    const go = (name, params) => {
      const nav = navRef.current;
      if (!nav) return;
      const routes = nav.getRootState?.()?.routeNames || [];
      if (routes.includes(name)) nav.navigate(name, params);
    };

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
    };
  }, []);

  if (!booted) return null;

  const isGuardian = role === ROLES.GUARDIAN;

  return (
    <ErrorBoundary>
      <RoleProvider value={{ role, setRole }}>
        <NavigationContainer ref={navRef}>
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
                options={{ title: 'Medicines' }}
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
            </>
          )}
        </Stack.Navigator>
        </NavigationContainer>
      </RoleProvider>
    </ErrorBoundary>
  );
}
