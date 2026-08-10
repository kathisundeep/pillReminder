/* eslint-disable no-await-in-loop */
// LIVE: the real end-to-end flows against the production Supabase project.
// Run with:  RUN_LIVE=1 npm run test:live

import {
  liveDescribe,
  assertBackendReachable,
  createAccount,
  cleanupAccount,
  pair,
  newRunId,
} from '../../test/liveClient';

const runId = newRunId();
let user;
let guardian;

liveDescribe('LIVE — end-to-end flows', () => {
  beforeAll(async () => {
    await assertBackendReachable();
    user = await createAccount(`qa_${runId}_user`);
    guardian = await createAccount(`qa_${runId}_guardian`);
  });

  afterAll(async () => {
    await cleanupAccount(user);
    await cleanupAccount(guardian);
  });

  it('creates a profile row from the signup trigger', async () => {
    const { data, error } = await user.client
      .from('profiles')
      .select('id, username, settings')
      .eq('id', user.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data.username).toBe(user.username);
    expect(data.settings).toMatchObject({
      graceMinutes: expect.any(Number),
      notifyMode: expect.any(String),
      approvalRequired: expect.any(Boolean),
    });
  });

  it('stores and reads back a medicine, including a photo', async () => {
    const photo = 'x'.repeat(5000);
    const { data, error } = await user.client
      .from('medicines')
      .insert({
        user_id: user.id,
        name: 'QA Aspirin',
        times: ['08:00', '20:00'],
        photo,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data.name).toBe('QA Aspirin');
    expect(data.times).toEqual(['08:00', '20:00']);
    expect(data.photo).toHaveLength(5000);
    // Server defaults really are applied.
    expect(data.form).toBe('Tablet');
    expect(data.snooze_minutes).toBe(10);
    expect(data.tone_id).toBe('classic');
  });

  it('enforces the 60 000-character photo cap in the database', async () => {
    const { error } = await user.client.from('medicines').insert({
      user_id: user.id,
      name: 'QA Oversized photo',
      times: ['08:00'],
      photo: 'x'.repeat(60001),
    });
    expect(error).not.toBeNull();
    expect(error.message).toMatch(/medicines_photo_size|violates check constraint/i);
  });

  it('records dose history', async () => {
    const { data: med } = await user.client
      .from('medicines')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    const { error } = await user.client.from('dose_history').insert({
      user_id: user.id,
      medicine_id: med.id,
      day: new Date().toISOString().slice(0, 10),
      status: 'taken',
      at: new Date().toISOString(),
    });
    expect(error).toBeNull();
  });

  it('stores a health reading in the jsonb `values` column', async () => {
    // Also proves the reserved-keyword column name actually works over PostgREST.
    const { data, error } = await user.client
      .from('health_readings')
      .insert({
        user_id: user.id,
        type: 'bp',
        values: { systolic: 120, diastolic: 80 },
        unit: 'mmHg',
        measured_at: new Date().toISOString(),
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data.values).toEqual({ systolic: 120, diastolic: 80 });
  });

  it('issues a pairing code and links the guardian', async () => {
    const code = await pair(user, guardian);
    expect(code).toMatch(/^\d{6}$/);

    const { data } = await guardian.client
      .from('guardian_links')
      .select('user_id, guardian_id, status')
      .eq('guardian_id', guardian.id)
      .eq('status', 'active');

    expect(data.map((l) => l.user_id)).toContain(user.id);
  });

  it('consumes the code so it cannot be replayed', async () => {
    const { data } = await user.client
      .from('pairing_codes')
      .select('status')
      .eq('user_id', user.id);
    expect(data.some((c) => c.status === 'consumed')).toBe(true);
    expect(data.some((c) => c.status === 'active')).toBe(false);
  });

  it('lets the linked guardian read medicines, doses and readings', async () => {
    const meds = await guardian.client
      .from('medicines').select('name').eq('user_id', user.id);
    expect(meds.error).toBeNull();
    expect(meds.data.length).toBeGreaterThan(0);

    const doses = await guardian.client
      .from('dose_history').select('status').eq('user_id', user.id);
    expect(doses.data.length).toBeGreaterThan(0);

    const readings = await guardian.client
      .from('health_readings').select('type').eq('user_id', user.id);
    expect(readings.data.length).toBeGreaterThan(0);
  });

  it('lets the guardian file an add-medicine request', async () => {
    const { error } = await guardian.client.from('action_requests').insert({
      user_id: user.id,
      guardian_id: guardian.id,
      kind: 'add_medicine',
      payload: { name: 'QA Vitamin D', times: ['09:00'] },
    });
    expect(error).toBeNull();
  });

  it('lets the patient see and approve that request', async () => {
    const { data: pending } = await user.client
      .from('action_requests')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending');

    expect(pending.length).toBeGreaterThan(0);
    const req = pending[0];

    const inserted = await user.client.from('medicines').insert({
      user_id: user.id,
      name: req.payload.name,
      times: req.payload.times,
    });
    expect(inserted.error).toBeNull();

    const updated = await user.client
      .from('action_requests')
      .update({ status: 'approved' })
      .eq('id', req.id);
    expect(updated.error).toBeNull();
  });

  it('revoking the guardian cuts off their access immediately', async () => {
    const { error } = await user.client.rpc('revoke_guardian');
    expect(error).toBeNull();

    const meds = await guardian.client
      .from('medicines').select('name').eq('user_id', user.id);
    expect(meds.data).toEqual([]);

    const readings = await guardian.client
      .from('health_readings').select('type').eq('user_id', user.id);
    expect(readings.data).toEqual([]);
  });
});
