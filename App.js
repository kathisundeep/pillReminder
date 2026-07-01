import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import AddMedicineScreen from './src/screens/AddMedicineScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import GuardianScreen from './src/screens/GuardianScreen';
import { getSession, recordDose, getMedicines } from './src/utils/storage';
import {
  ensureNotificationSetup,
  scheduleSnooze,
} from './src/utils/notifications';
import {
  registerForPushTokenAsync,
  registerBackgroundSweep,
  sweepMissedDoses,
  notifyGuardianTaken,
} from './src/utils/guardian';
import { resyncAlarmsFromCloud } from './src/utils/sync';

const Stack = createNativeStackNavigator();

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const navRef = useRef(null);

  useEffect(() => {
    (async () => {
      await ensureNotificationSetup();
      const user = await getSession();
      setInitialRoute(user ? 'Home' : 'Login');
      // If already logged in, re-arm local alarms from the cloud medicine list
      // (so alarms work after a reboot or on a freshly-signed-in device).
      if (user) resyncAlarmsFromCloud();
      // Guardian: register for push (to be a guardian), schedule the
      // periodic background sweep, and run one sweep right away.
      registerForPushTokenAsync();
      registerBackgroundSweep();
      sweepMissedDoses();
    })();

    // Re-check for missed doses whenever the app returns to the foreground.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sweepMissedDoses();
    });

    const receivedSub = Notifications.addNotificationReceivedListener(
      (notification) => {
        const data = notification.request.content.data || {};
        if (data.type === 'pill-alarm' && navRef.current) {
          navRef.current.navigate('Alarm', {
            medicineId: data.medicineId,
            medicineName: data.medicineName,
          });
        }
      }
    );

    const responseSub = Notifications.addNotificationResponseReceivedListener(
      async (response) => {
        const data = response.notification.request.content.data || {};
        if (data.type !== 'pill-alarm') return;
        const action = response.actionIdentifier;
        const user = await getSession();

        if (action === 'TAKEN') {
          if (user) {
            await recordDose(user, data.medicineId, 'taken');
            await notifyGuardianTaken(user, data.medicineName);
          }
          if (navRef.current) navRef.current.navigate('Home');
        } else if (action === 'RESCHEDULE') {
          if (user) {
            await recordDose(user, data.medicineId, 'snoozed');
            const meds = await getMedicines(user);
            const med = meds.find((m) => m.id === data.medicineId);
            await scheduleSnooze({
              medicineId: data.medicineId,
              medicineName: data.medicineName,
              minutes: med?.snoozeMinutes || 10,
            });
          }
          if (navRef.current) navRef.current.navigate('Home');
        } else if (action === 'SKIP') {
          // Explicit skip — guardian gets alerted by the missed-dose sweep.
          if (user) {
            await recordDose(user, data.medicineId, 'skipped');
            sweepMissedDoses();
          }
          if (navRef.current) navRef.current.navigate('Home');
        } else {
          if (navRef.current) {
            navRef.current.navigate('Alarm', {
              medicineId: data.medicineId,
              medicineName: data.medicineName,
            });
          }
        }
      }
    );

    return () => {
      receivedSub.remove();
      responseSub.remove();
      appStateSub.remove();
    };
  }, []);

  if (!initialRoute) return null;

  return (
    <NavigationContainer ref={navRef}>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerStyle: { backgroundColor: '#4CAF50' }, headerTintColor: '#fff' }}
      >
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
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
          options={{ title: 'Guardian alerts' }}
        />
        <Stack.Screen
          name="Alarm"
          component={AlarmScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
