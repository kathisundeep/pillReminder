// Sanity checks for the test harness itself. If these fail, every other
// failure in the suite is suspect.

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../src/utils/supabase';

describe('harness', () => {
  it('provides a fake supabase wired into src/utils/supabase', async () => {
    const db = globalThis.__db;
    const user = db.makeUser('alice');
    db.as(user);

    const { data, error } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data.username).toBe('alice');
  });

  it('resets supabase state between tests', async () => {
    const { data } = await supabase.from('profiles').select('*');
    expect(data).toEqual([]);
  });

  it('enforces RLS: a stranger cannot read another user`s medicines', async () => {
    const db = globalThis.__db;
    const alice = db.makeUser('alice');
    const mallory = db.makeUser('mallory');
    db.seed('medicines', [{ user_id: alice.id, name: 'Aspirin', times: ['08:00'] }]);

    db.as(mallory);
    const { data } = await supabase.from('medicines').select('*');
    expect(data).toEqual([]);

    db.as(alice);
    const mine = await supabase.from('medicines').select('*');
    expect(mine.data).toHaveLength(1);
  });

  it('provides a stateful expo-notifications mock', async () => {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: 'x' },
      trigger: { hour: 8, minute: 0, repeats: true },
    });
    expect(id).toBe('notif-1');
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(1);
    await Notifications.cancelAllScheduledNotificationsAsync();
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it('resets AsyncStorage between tests', async () => {
    expect(await AsyncStorage.getItem('anything')).toBeNull();
    await AsyncStorage.setItem('anything', '1');
    expect(await AsyncStorage.getItem('anything')).toBe('1');
  });
});
