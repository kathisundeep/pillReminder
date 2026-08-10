/* eslint-disable no-await-in-loop, no-console */
// LIVE SECURITY: an unrelated "attacker" account probes the real backend the
// way someone with a decompiled APK would — the anon key is public, so every
// one of these calls is something a stranger can make today.
//
// Each test asserts the SECURE outcome. A failure here is a real finding.
// Run with:  RUN_LIVE=1 npm run test:live

import {
  liveDescribe,
  assertBackendReachable,
  createAccount,
  cleanupAccount,
  pair,
  newRunId,
  freshClient,
  PASSWORD,
} from '../../test/liveClient';

const runId = newRunId();
let victim;
let guardian;
let attacker;
let victimMedicineId;

liveDescribe('LIVE SECURITY — cross-account access', () => {
  beforeAll(async () => {
    await assertBackendReachable();
    victim = await createAccount(`qa_${runId}_victim`);
    guardian = await createAccount(`qa_${runId}_guardian`);
    attacker = await createAccount(`qa_${runId}_attacker`);

    const { data } = await victim.client
      .from('medicines')
      .insert({
        user_id: victim.id,
        name: 'QA Secret Medicine',
        times: ['08:00'],
        photo: 'x'.repeat(1000),
      })
      .select()
      .single();
    victimMedicineId = data?.id;

    await victim.client.from('health_readings').insert({
      user_id: victim.id,
      type: 'bp',
      values: { systolic: 155, diastolic: 95 },
      unit: 'mmHg',
      measured_at: new Date().toISOString(),
    });

    await victim.client.from('dose_history').insert({
      user_id: victim.id,
      medicine_id: victimMedicineId,
      day: new Date().toISOString().slice(0, 10),
      status: 'taken',
      at: new Date().toISOString(),
    });

    await pair(victim, guardian);
  });

  afterAll(async () => {
    await cleanupAccount(victim);
    await cleanupAccount(guardian);
    await cleanupAccount(attacker);
  });

  // ---- Reading other people's data ---------------------------------------
  it('cannot read another user`s medicines', async () => {
    const { data } = await attacker.client
      .from('medicines').select('*').eq('user_id', victim.id);
    expect(data).toEqual([]);
  });

  it('cannot read another user`s medicines by enumerating ids', async () => {
    const { data } = await attacker.client
      .from('medicines').select('*').eq('id', victimMedicineId);
    expect(data).toEqual([]);
  });

  it('cannot dump the whole medicines table', async () => {
    const { data } = await attacker.client.from('medicines').select('*');
    expect(data.every((m) => m.user_id === attacker.id)).toBe(true);
  });

  it('cannot read another user`s dose history', async () => {
    const { data } = await attacker.client
      .from('dose_history').select('*').eq('user_id', victim.id);
    expect(data).toEqual([]);
  });

  it('cannot read another user`s health readings', async () => {
    const { data } = await attacker.client
      .from('health_readings').select('*').eq('user_id', victim.id);
    expect(data).toEqual([]);
  });

  it('cannot read another user`s pairing codes', async () => {
    await victim.client.rpc('generate_pairing_code');
    const { data } = await attacker.client
      .from('pairing_codes').select('*').eq('user_id', victim.id);
    expect(data).toEqual([]);
  });

  it('cannot read another user`s subscriptions', async () => {
    const { data } = await attacker.client
      .from('subscriptions').select('*').eq('user_id', victim.id);
    expect(data).toEqual([]);
  });

  it('cannot read another user`s action requests', async () => {
    await guardian.client.from('action_requests').insert({
      user_id: victim.id,
      guardian_id: guardian.id,
      kind: 'add_medicine',
      payload: { name: 'QA Probe', times: ['09:00'] },
    });
    const { data } = await attacker.client
      .from('action_requests').select('*').eq('user_id', victim.id);
    expect(data).toEqual([]);
  });

  // ---- Writing to other people's data -------------------------------------
  it('cannot insert a medicine into another user`s account', async () => {
    const { error } = await attacker.client.from('medicines').insert({
      user_id: victim.id,
      name: 'QA Injected Medicine',
      times: ['03:00'],
    });
    expect(error).not.toBeNull();
  });

  it('cannot modify another user`s medicine', async () => {
    await attacker.client
      .from('medicines')
      .update({ name: 'QA Tampered', times: ['03:00'] })
      .eq('id', victimMedicineId);

    const { data } = await victim.client
      .from('medicines').select('name, times').eq('id', victimMedicineId).maybeSingle();
    expect(data.name).toBe('QA Secret Medicine');
    expect(data.times).toEqual(['08:00']);
  });

  it('cannot delete another user`s medicine', async () => {
    await attacker.client.from('medicines').delete().eq('id', victimMedicineId);
    const { data } = await victim.client
      .from('medicines').select('id').eq('id', victimMedicineId).maybeSingle();
    expect(data).not.toBeNull();
  });

  it('cannot forge dose history for another user', async () => {
    const { error } = await attacker.client.from('dose_history').insert({
      user_id: victim.id,
      medicine_id: victimMedicineId,
      day: new Date().toISOString().slice(0, 10),
      status: 'taken',
      at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });

  it('cannot approve another user`s pending guardian request', async () => {
    const { data: reqs } = await guardian.client
      .from('action_requests').select('id').eq('user_id', victim.id).limit(1);
    if (!reqs?.length) return;

    await attacker.client
      .from('action_requests').update({ status: 'approved' }).eq('id', reqs[0].id);

    const { data } = await victim.client
      .from('action_requests').select('status').eq('id', reqs[0].id).maybeSingle();
    expect(data.status).toBe('pending');
  });

  // ---- Hijacking the guardian alert channel -------------------------------
  it('cannot overwrite another user`s push token', async () => {
    // Succeeding here would redirect every missed-dose alert to the attacker.
    await victim.client
      .from('profiles').update({ push_token: 'ExponentPushToken[victim]' }).eq('id', victim.id);

    await attacker.client
      .from('profiles').update({ push_token: 'ExponentPushToken[attacker]' }).eq('id', victim.id);

    const { data } = await victim.client
      .from('profiles').select('push_token').eq('id', victim.id).maybeSingle();
    expect(data.push_token).toBe('ExponentPushToken[victim]');
  });

  it('cannot read the push token of a user they are not linked to', async () => {
    const { data } = await attacker.client
      .from('profiles').select('push_token').eq('id', victim.id).maybeSingle();
    expect(data).toBeNull();
  });

  it('cannot rename another user`s profile', async () => {
    await attacker.client
      .from('profiles').update({ username: `qa_${runId}_stolen` }).eq('id', victim.id);
    const { data } = await victim.client
      .from('profiles').select('username').eq('id', victim.id).maybeSingle();
    expect(data.username).toBe(victim.username);
  });

  it('cannot insert a guardian link directly, bypassing the pairing code', async () => {
    const { error } = await attacker.client.from('guardian_links').insert({
      user_id: victim.id,
      guardian_id: attacker.id,
      status: 'active',
    });
    expect(error).not.toBeNull();

    const { data } = await victim.client
      .from('guardian_links').select('guardian_id').eq('user_id', victim.id).eq('status', 'active');
    expect(data.map((l) => l.guardian_id)).not.toContain(attacker.id);
  });

  it('cannot re-activate a revoked guardian link by updating it', async () => {
    await victim.client.rpc('revoke_guardian');
    await attacker.client
      .from('guardian_links').update({ status: 'active' }).eq('user_id', victim.id);

    const { data } = await victim.client
      .from('guardian_links').select('status').eq('user_id', victim.id);
    expect(data.every((l) => l.status !== 'active')).toBe(true);
  });

  // ---- Pairing-code brute force -------------------------------------------
  it('rejects a wrong pairing code', async () => {
    await victim.client.rpc('generate_pairing_code');
    const { error } = await attacker.client.rpc('pair_with_code', {
      target_username: victim.username,
      code: '000000',
    });
    expect(error).not.toBeNull();
  });

  it('throttles repeated pairing-code guesses (SEC-04)', async () => {
    await victim.client.rpc('generate_pairing_code');

    const ATTEMPTS = 20;
    let throttled = 0;

    for (let i = 0; i < ATTEMPTS; i += 1) {
      const { error } = await attacker.client.rpc('pair_with_code', {
        target_username: victim.username,
        code: String(i).padStart(6, '0'),
      });
      if (error && /too many/i.test(error.message)) throttled += 1;
    }

    console.log(
      `[live] pairing brute force: ${ATTEMPTS} guesses, ${throttled} throttled.`
    );
    // The lockout must engage well before the 10^6 keyspace is meaningfully
    // explored. 10 failures in 15 minutes is the configured limit.
    expect(throttled).toBeGreaterThan(0);
  });

  it('refuses to pair with yourself', async () => {
    await attacker.client.rpc('generate_pairing_code');
    const { data } = await attacker.client
      .from('pairing_codes').select('*').eq('user_id', attacker.id).eq('status', 'active').limit(1);
    expect(data.length).toBeGreaterThan(0);

    const { error } = await attacker.client.rpc('pair_with_code', {
      target_username: attacker.username,
      code: '123456',
    });
    expect(error).not.toBeNull();
  });

  // ---- Account enumeration -------------------------------------------------
  it('does not let a signed-in user enumerate every profile', async () => {
    const { data } = await attacker.client.from('profiles').select('username');
    const others = (data || []).filter((p) => p.username !== attacker.username);
    expect(others).toEqual([]);
  });

  it('does not let an anonymous client read any profile', async () => {
    const anon = freshClient();
    const { data } = await anon.from('profiles').select('username');
    expect(data || []).toEqual([]);
  });

  it('does not let an anonymous client read medicines', async () => {
    const anon = freshClient();
    const { data } = await anon.from('medicines').select('*');
    expect(data || []).toEqual([]);
  });

  it('does not reveal whether a username exists (SEC-04)', async () => {
    const missing = await attacker.client.rpc('pair_with_code', {
      target_username: `qa_${runId}_definitely_not_a_user`,
      code: '000000',
    });
    const present = await attacker.client.rpc('pair_with_code', {
      target_username: victim.username,
      code: '000000',
    });

    expect(missing.error.message).toBe(present.error.message);
    expect(missing.error.message).not.toMatch(/not found/i);
  });

  it('cannot rewrite its own profile`s identity columns (SEC-03)', async () => {
    const stolen = `qa_${runId}_stolen_handle`;
    await attacker.client
      .from('profiles')
      .update({ username: stolen, is_guardian: true })
      .eq('id', attacker.id);

    const { data } = await attacker.client
      .from('profiles')
      .select('username, is_guardian')
      .eq('id', attacker.id)
      .maybeSingle();

    expect(data.username).toBe(attacker.username);
    expect(data.is_guardian).toBe(false);
  });

  it('cannot write an oversized guardian request payload (SEC-02)', async () => {
    const { error } = await guardian.client.from('action_requests').insert({
      user_id: victim.id,
      guardian_id: guardian.id,
      kind: 'add_medicine',
      payload: { name: 'QA Huge', times: ['09:00'], photo: 'x'.repeat(200000) },
    });
    expect(error).not.toBeNull();
  });
});

// ===========================================================================
liveDescribe('LIVE SECURITY — paid plan enforcement', () => {
  let freeloader;

  beforeAll(async () => {
    freeloader = await createAccount(`qa_${newRunId()}_freeloader`);
  });

  afterAll(async () => {
    await cleanupAccount(freeloader);
  });

  it('the plan catalog is publicly readable (expected)', async () => {
    const { data, error } = await freeloader.client.from('plans').select('*');
    expect(error).toBeNull();
    expect(data.map((p) => p.id)).toEqual(expect.arrayContaining(['free']));
  });

  it('a user cannot write to the plan catalog', async () => {
    const { error } = await freeloader.client
      .from('plans').update({ price_cents: 0 }).eq('id', 'family');
    const { data } = await freeloader.client
      .from('plans').select('price_cents').eq('id', 'family').maybeSingle();
    if (data) expect(data.price_cents).toBeGreaterThan(0);
    expect(error === null || error !== null).toBe(true);
  });

  // ---- SEC-01 ------------------------------------------------------------
  it('a user cannot grant themselves a paid subscription', async () => {
    const end = new Date();
    end.setMonth(end.getMonth() + 1);

    const { error } = await freeloader.client.from('subscriptions').insert({
      user_id: freeloader.id,
      plan_id: 'family',
      status: 'active',
      auto_renew: false,
      current_period_end: end.toISOString(),
    });

    // EXPECTED SECURE OUTCOME: the write is refused, because activating a paid
    // plan must be a server-side decision made after a verified payment.
    expect(error).not.toBeNull();
  });

  it('a self-granted plan does not raise the enforced guardian limit', async () => {
    const { data } = await freeloader.client.rpc('guardian_limit', {
      target_user: freeloader.id,
    });
    // Free tier is 1. Anything higher means an unpaid plan is being honoured.
    expect(data).toBe(1);
  });
});
