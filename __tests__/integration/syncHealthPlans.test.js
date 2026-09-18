import * as Notifications from 'expo-notifications';
import { resyncAlarmsFromCloud } from '../../src/utils/sync';
import {
  addReading,
  getReadings,
  getUserReadings,
  deleteReading,
} from '../../src/utils/health';
import {
  getPlans,
  getMyPlan,
  requestPlanChange,
  activateTestPlan,
} from '../../src/utils/subscription';
import {
  registerUser,
  loginUser,
  addMedicine,
  getMedicines,
} from '../../src/utils/storage';
import { supabase } from '../../src/utils/supabase';

const db = () => globalThis.__db;
const scheduled = () => Notifications.__state.scheduled;

async function signedIn(username = 'alice') {
  await registerUser(username, 'password123');
  await loginUser(username, 'password123');
  return db().session.user;
}

describe('resyncAlarmsFromCloud', () => {
  it('arms alarms for every cloud medicine and reports the count', async () => {
    await signedIn();
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    await addMedicine(null, { name: 'B', times: ['09:00', '21:00'] });

    expect(await resyncAlarmsFromCloud()).toBe(2);
    expect(scheduled()).toHaveLength(3);
  });

  it('persists the device-local notification ids per medicine', async () => {
    await signedIn();
    await addMedicine(null, { name: 'A', times: ['08:00', '20:00'] });
    await resyncAlarmsFromCloud();

    const [med] = await getMedicines();
    expect(med.notificationIds).toHaveLength(2);
    expect(med.notificationIds).toEqual(scheduled().map((n) => n.identifier));
  });

  it('clears stale alarms when the account has no medicines', async () => {
    await signedIn();
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    await resyncAlarmsFromCloud();
    expect(scheduled()).toHaveLength(1);

    for (const m of db().rows('medicines').slice()) {
      db().rows('medicines').splice(db().rows('medicines').indexOf(m), 1);
    }
    expect(await resyncAlarmsFromCloud()).toBe(0);
    expect(scheduled()).toHaveLength(0);
  });

  it('does not duplicate alarms when run twice', async () => {
    await signedIn();
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    await resyncAlarmsFromCloud();
    await resyncAlarmsFromCloud();
    expect(scheduled()).toHaveLength(1);
  });

  it('applies each medicine`s chosen tone', async () => {
    await signedIn();
    await addMedicine(null, { name: 'A', times: ['08:00'], toneId: 'siren' });
    await resyncAlarmsFromCloud();
    expect(scheduled()[0].content.sound).toBe('siren');
    expect(scheduled()[0].trigger.channelId).toBe('pill-alarm-siren');
  });

  it('re-arms from the offline cache when the network is down', async () => {
    await signedIn();
    await addMedicine(null, { name: 'A', times: ['08:00'] });
    await getMedicines(); // warm the cache
    Notifications.__reset();

    db().failOn('medicines', 'select', { message: 'offline' });
    expect(await resyncAlarmsFromCloud()).toBe(1);
    expect(scheduled()).toHaveLength(1);
  });

  it('returns 0 and never throws when signed out', async () => {
    await expect(resyncAlarmsFromCloud()).resolves.toBe(0);
  });
});

describe('health readings', () => {
  it('stores a reading with its unit and timestamp', async () => {
    const user = await signedIn();
    await addReading('bp', { systolic: 120, diastolic: 80 }, 'after walk');

    const rows = db().rows('health_readings');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: user.id,
      type: 'bp',
      // `values` is a reserved SQL keyword, so the column is reading_values.
      reading_values: { systolic: 120, diastolic: 80 },
      unit: 'mmHg',
      note: 'after walk',
    });
    expect(rows[0].measured_at).toBeTruthy();
  });

  it('derives the unit from the reading type, not the caller', async () => {
    await signedIn();
    await addReading('weight', { value: 70 });
    expect(db().rows('health_readings')[0].unit).toBe('kg');
  });

  it('stores a null note when none is given', async () => {
    await signedIn();
    await addReading('sugar', { value: 96 });
    expect(db().rows('health_readings')[0].note).toBeNull();
  });

  it('refuses to store anything when signed out', async () => {
    await expect(addReading('bp', { systolic: 1, diastolic: 1 })).rejects.toThrow(
      /not signed in/
    );
  });

  it('lists readings newest-first', async () => {
    await signedIn();
    await addReading('sugar', { value: 90 });
    await addReading('sugar', { value: 110 });

    const rows = db().rows('health_readings');
    rows[0].measured_at = '2025-06-01T00:00:00.000Z';
    rows[1].measured_at = '2025-06-02T00:00:00.000Z';

    expect((await getReadings()).map((r) => r.values.value)).toEqual([110, 90]);
  });

  it('filters by type when asked', async () => {
    await signedIn();
    await addReading('sugar', { value: 96 });
    await addReading('weight', { value: 70 });

    expect(await getReadings('sugar')).toHaveLength(1);
    expect(await getReadings()).toHaveLength(2);
  });

  it('returns nothing when signed out', async () => {
    expect(await getReadings()).toEqual([]);
  });

  it('never returns another user`s readings', async () => {
    const alice = await signedIn('alice');
    await addReading('sugar', { value: 96 });

    const mallory = db().makeUser('mallory');
    db().as(mallory);
    expect(await getReadings()).toEqual([]);
    expect(alice.id).toBeTruthy();
  });

  it('lets a linked guardian read the patient`s readings', async () => {
    const alice = await signedIn('alice');
    await addReading('bp', { systolic: 120, diastolic: 80 });

    const bob = db().makeUser('bob');
    db().link(alice.id, bob.id);
    db().as(bob);

    expect(await getUserReadings(alice.id)).toHaveLength(1);
  });

  it('returns nothing to an unlinked stranger', async () => {
    const alice = await signedIn('alice');
    await addReading('bp', { systolic: 120, diastolic: 80 });

    db().as(db().makeUser('mallory'));
    expect(await getUserReadings(alice.id)).toEqual([]);
  });

  it('deletes a reading', async () => {
    await signedIn();
    await addReading('sugar', { value: 96 });
    const [r] = await getReadings();
    await deleteReading(r.id);
    expect(await getReadings()).toEqual([]);
  });

  it('cannot delete another user`s reading', async () => {
    const alice = await signedIn('alice');
    await addReading('sugar', { value: 96 });
    const id = db().rows('health_readings')[0].id;

    db().as(db().makeUser('mallory'));
    await deleteReading(id);

    db().as(alice);
    expect(await getReadings()).toHaveLength(1);
  });

  // Was BUG-13: the cap was on total rows rather than per type, so someone
  // logging weight daily pushed their blood-pressure history out of the report
  // entirely, with no indication anything was missing.
  it('caps per type, so a frequent measurement cannot starve a rare one', async () => {
    await signedIn();
    for (let i = 0; i < 65; i += 1) await addReading('weight', { value: 70 + i });
    await addReading('bp', { systolic: 120, diastolic: 80 });

    // Make the single BP reading the oldest of everything.
    const rows = db().rows('health_readings');
    rows.at(-1).measured_at = '2020-01-01T00:00:00.000Z';

    const all = await getReadings();
    expect(all.filter((r) => r.type === 'weight')).toHaveLength(60);
    expect(all.filter((r) => r.type === 'bp')).toHaveLength(1); // survives
  });

  it('still honours an explicit per-type limit', async () => {
    await signedIn();
    for (let i = 0; i < 5; i += 1) await addReading('sugar', { value: 90 + i });
    expect(await getReadings('sugar', 3)).toHaveLength(3);
  });
});

describe('plans and subscriptions', () => {
  it('lists the twelve plans on sale, by length then guardians', async () => {
    expect((await getPlans()).map((p) => p.id)).toEqual([
      'g1_m1', 'g2_m1', 'g3_m1',
      'g1_m3', 'g2_m3', 'g3_m3',
      'g1_m6', 'g2_m6', 'g3_m6',
      'g1_m12', 'g2_m12', 'g3_m12',
    ]);
  });

  it('prices a month at ₹150 / ₹250 / ₹300 for 1 / 2 / 3 guardians', async () => {
    const monthly = (await getPlans()).filter((p) => p.months === 1);
    expect(monthly.map((p) => p.price_cents / 100)).toEqual([150, 250, 300]);
  });

  it('lists nothing when the catalog is empty', async () => {
    db().tables.plans.length = 0;
    expect(await getPlans()).toEqual([]);
  });

  it('gives Free no guardians', async () => {
    expect((await getMyPlan()).max_guardians).toBe(0);
  });

  it('activates a plan through the test checkout, for its length', async () => {
    const user = await signedIn();
    const res = await activateTestPlan('g2_m3');
    expect(res.ok).toBe(true);

    const plan = await getMyPlan();
    expect(plan).toMatchObject({ id: 'g2_m3', max_guardians: 2 });
    const months = (new Date(plan.current_period_end) - new Date()) / (30.5 * 86400000);
    expect(Math.round(months)).toBe(3);
    expect(db().rows('subscriptions').filter((x) => x.user_id === user.id)).toHaveLength(1);
  });

  it('replaces the current plan with a new purchase', async () => {
    await signedIn();
    await activateTestPlan('g1_m1');
    await activateTestPlan('g3_m12');
    expect((await getMyPlan()).id).toBe('g3_m12');
    expect(db().rows('subscriptions').filter((x) => x.status === 'active')).toHaveLength(1);
  });

  it('refuses a retired plan at checkout', async () => {
    await signedIn();
    const res = await activateTestPlan('family');
    expect(res.ok).toBe(false);
    expect((await getMyPlan()).id).toBe('free');
  });

  it('refuses the test checkout once it is switched off', async () => {
    await signedIn();
    db().mockPayments = false;
    expect((await activateTestPlan('g1_m1')).ok).toBe(false);
  });

  it('treats an expired plan as Free', async () => {
    const user = await signedIn();
    db().subscribe(user.id, 'g1_m1');
    db().rows('subscriptions')[0].current_period_end = '2000-01-01T00:00:00.000Z';
    expect((await getMyPlan()).id).toBe('free');
  });

  it('reports Free for a signed-out user', async () => {
    expect((await getMyPlan()).id).toBe('free');
  });

  it('reports Free for a user with no subscription', async () => {
    await signedIn();
    expect((await getMyPlan()).id).toBe('free');
  });

  it('reports the active plan with its renewal fields', async () => {
    const user = await signedIn();
    db().seed('subscriptions', [
      {
        user_id: user.id, plan_id: 'g3_m12', status: 'active',
        auto_renew: true, current_period_end: '2099-12-31T00:00:00.000Z',
      },
    ]);

    const plan = await getMyPlan();
    expect(plan.id).toBe('g3_m12');
    expect(plan.max_guardians).toBe(3);
    expect(plan.auto_renew).toBe(true);
    expect(plan.current_period_end).toBe('2099-12-31T00:00:00.000Z');
  });

  it('ignores a cancelled subscription', async () => {
    const user = await signedIn();
    db().seed('subscriptions', [
      { user_id: user.id, plan_id: 'family', status: 'canceled' },
    ]);
    expect((await getMyPlan()).id).toBe('free');
  });

  // Was SEC-01: the client inserted its own 'active' subscription row, so any
  // user could hand themselves the top paid tier for free. Writes are now
  // revoked from `authenticated` (supabase/hardening.sql); a plan becomes
  // active only via a service-role Edge Function called by a payment webhook.
  it('a user cannot write themselves a subscription at all', async () => {
    const user = await signedIn();

    const { error } = await supabase.from('subscriptions').insert({
      user_id: user.id,
      plan_id: 'family',
      status: 'active',
    });

    expect(error).not.toBeNull();
    expect(db().rows('subscriptions')).toHaveLength(0);
    expect((await getMyPlan()).id).toBe('free');
  });

  it('reports a failure when the billing function is unreachable', async () => {
    await signedIn();
    const res = await requestPlanChange('plus');
    // No Edge Function deployed: this must report a failure rather than
    // silently succeeding. There is no client-side grant path any more.
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(db().rows('subscriptions')).toHaveLength(0);
  });

  it('activates only through the server function', async () => {
    const user = await signedIn();
    // Stand in for the deployed function, which runs as the service role.
    db().onFunction('change-plan', async ({ planId }) => {
      db().seed('subscriptions', [
        { user_id: user.id, plan_id: planId, status: 'active' },
      ]);
      return { activated: planId };
    });

    const res = await requestPlanChange('plus');
    expect(res.ok).toBe(true);
    expect((await getMyPlan()).id).toBe('plus');
  });

  it('refuses to request anything when signed out', async () => {
    await expect(requestPlanChange('plus')).rejects.toThrow(/not signed in/);
  });

  it('reads back a subscription the server created', async () => {
    const user = await signedIn();
    // Seeded directly, i.e. as the service role would.
    db().seed('subscriptions', [
      { user_id: user.id, plan_id: 'family', status: 'active', auto_renew: true },
    ]);

    const plan = await getMyPlan();
    expect(plan.id).toBe('family');
    expect(plan.max_guardians).toBe(5);
    expect(plan.auto_renew).toBe(true);
  });
});
