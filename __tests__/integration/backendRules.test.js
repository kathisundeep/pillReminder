// The rules that must hold on the SERVER, exercised against the RLS simulation
// in test/fakeSupabase.js. Each mirrors a policy in supabase/hardening.sql.
//
// These are the client-side counterpart of __tests__/live/security.test.js:
// the live suite proves the real database enforces them, these prove the app
// behaves correctly when it does.

import { supabase } from '../../src/utils/supabase';
import { registerUser, loginUser } from '../../src/utils/storage';
import { getMyPlan, requestPlanChange } from '../../src/utils/subscription';
import { updateMySettings, getMyProfile } from '../../src/utils/guardianCloud';

const db = () => globalThis.__db;

async function signedIn(username = 'alice', opts) {
  await registerUser(username, 'password123', opts);
  await loginUser(username, 'password123');
  return db().session.user;
}

// ---------------------------------------------------------------------------
describe('SEC-01 — subscriptions are server-owned', () => {
  it('a user cannot insert their own subscription', async () => {
    const user = await signedIn();
    const { error } = await supabase.from('subscriptions').insert({
      user_id: user.id,
      plan_id: 'family',
      status: 'active',
    });
    expect(error).not.toBeNull();
    expect(db().rows('subscriptions')).toHaveLength(0);
  });

  it('a user cannot upgrade a subscription the server created', async () => {
    const user = await signedIn();
    db().seed('subscriptions', [
      { user_id: user.id, plan_id: 'free', status: 'active' },
    ]);

    await supabase
      .from('subscriptions')
      .update({ plan_id: 'family' })
      .eq('user_id', user.id);

    expect(db().rows('subscriptions')[0].plan_id).toBe('free');
    expect((await getMyPlan()).id).toBe('free');
  });

  it('a user cannot delete a subscription to escape a downgrade', async () => {
    const user = await signedIn();
    db().seed('subscriptions', [
      { user_id: user.id, plan_id: 'plus', status: 'canceled' },
    ]);

    await supabase.from('subscriptions').delete().eq('user_id', user.id);
    expect(db().rows('subscriptions')).toHaveLength(1);
  });

  it('a user can still read their own subscription', async () => {
    const user = await signedIn();
    db().seed('subscriptions', [
      { user_id: user.id, plan_id: 'plus', status: 'active' },
    ]);
    const { data, error } = await supabase.from('subscriptions').select('*');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('a user cannot write a payment method either', async () => {
    const user = await signedIn();
    const { error } = await supabase.from('payment_methods').insert({
      user_id: user.id, provider: 'razorpay', brand: 'upi', last4: '0000',
    });
    expect(error).not.toBeNull();
  });

  it('the only activation path is the server function', async () => {
    const user = await signedIn();
    db().onFunction('change-plan', async ({ planId }) => {
      db().seed('subscriptions', [
        { user_id: user.id, plan_id: planId, status: 'active' },
      ]);
      return { activated: planId };
    });

    expect((await requestPlanChange('family')).ok).toBe(true);
    expect((await getMyPlan()).id).toBe('family');
  });
});

// ---------------------------------------------------------------------------
describe('SEC-03 — a profile`s identity columns are not user-editable', () => {
  it('a user cannot rename themselves', async () => {
    const user = await signedIn('alice');
    await supabase
      .from('profiles')
      .update({ username: 'someone_else' })
      .eq('id', user.id);

    expect((await getMyProfile()).username).toBe('alice');
  });

  it('a user cannot promote themselves to a guardian account', async () => {
    const user = await signedIn('alice');
    await supabase
      .from('profiles')
      .update({ is_guardian: true })
      .eq('id', user.id);

    expect(db().rows('profiles').find((p) => p.id === user.id).is_guardian).toBe(false);
  });

  it('a user cannot demote themselves out of the guardian flow', async () => {
    const user = await signedIn('bob', { isGuardian: true });
    await supabase
      .from('profiles')
      .update({ is_guardian: false })
      .eq('id', user.id);

    expect(db().rows('profiles').find((p) => p.id === user.id).is_guardian).toBe(true);
  });

  it('the columns that ARE theirs still update', async () => {
    const user = await signedIn('alice');

    await supabase
      .from('profiles')
      .update({ display_name: 'Alice R', push_token: 'ExponentPushToken[a]' })
      .eq('id', user.id);
    await updateMySettings({ graceMinutes: 60 });

    const profile = await getMyProfile();
    expect(profile.display_name).toBe('Alice R');
    expect(profile.settings.graceMinutes).toBe(60);
    expect(
      db().rows('profiles').find((p) => p.id === user.id).push_token
    ).toBe('ExponentPushToken[a]');
  });
});

// ---------------------------------------------------------------------------
describe('SEC-04 — pairing gives nothing away and is rate limited', () => {
  async function guardianAnd(patientName) {
    const patient = db().makeUser(patientName);
    db().as(patient);
    await supabase.rpc('generate_pairing_code');
    const guardian = await signedIn('bob', { isGuardian: true });
    return { patient, guardian };
  }

  it('uses one message for an unknown user and a wrong code', async () => {
    await guardianAnd('alice');

    const unknown = await supabase.rpc('pair_with_code', {
      target_username: 'nobody_at_all',
      code: '000000',
    });
    const wrongCode = await supabase.rpc('pair_with_code', {
      target_username: 'alice',
      code: '000000',
    });

    expect(unknown.error.message).toBe(wrongCode.error.message);
    expect(unknown.error.message).not.toMatch(/not found/i);
  });

  it('locks a guardian out after ten failures', async () => {
    await guardianAnd('alice');

    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await supabase.rpc('pair_with_code', {
        target_username: 'alice',
        code: String(i).padStart(6, '0'),
      });
    }

    const { error } = await supabase.rpc('pair_with_code', {
      target_username: 'alice',
      code: '999999',
    });
    expect(error.message).toMatch(/too many attempts/i);
  });

  it('a successful pairing is not counted as a failure', async () => {
    const patient = db().makeUser('alice');
    db().subscribe(patient.id);
    db().as(patient);
    const { data: code } = await supabase.rpc('generate_pairing_code');
    await signedIn('bob', { isGuardian: true });

    const { error } = await supabase.rpc('pair_with_code', {
      target_username: 'alice',
      code,
    });
    expect(error).toBeNull();
    expect(db().pairingAttempts.filter((a) => !a.succeeded)).toHaveLength(0);
  });

  it('the lockout is per guardian, not global', async () => {
    await guardianAnd('alice');
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await supabase.rpc('pair_with_code', {
        target_username: 'alice', code: String(i).padStart(6, '0'),
      });
    }

    // A different guardian is unaffected.
    await signedIn('carol', { isGuardian: true });
    const { error } = await supabase.rpc('pair_with_code', {
      target_username: 'alice', code: '111111',
    });
    expect(error.message).not.toMatch(/too many attempts/i);
  });
});
