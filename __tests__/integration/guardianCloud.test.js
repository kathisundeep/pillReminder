// Ownership and access-control behaviour of the guardian data layer.
//
// The queries here lean on RLS to scope rows. The fake backend reproduces the
// real policies from supabase/schema.sql, so where a query is broader than the
// code assumes, these tests show it.

import {
  generatePairingCode,
  pairWithCode,
  revokeGuardian,
  getMyActiveGuardian,
  getMyProfile,
  updateMySettings,
  saveMyPushToken,
  getActiveGuardianTarget,
  getUserMedicines,
  createAddMedicineRequest,
  getPendingRequests,
  getMyOutgoingRequests,
  setRequestStatus,
  getLinkedUsers,
} from '../../src/utils/guardianCloud';

const db = () => globalThis.__db;

// alice = patient, bob = alice's guardian, mallory = unrelated.
function cast() {
  const alice = db().makeUser('alice');
  const bob = db().makeUser('bob');
  const mallory = db().makeUser('mallory');
  return { alice, bob, mallory };
}

describe('generatePairingCode', () => {
  it('returns a 6-digit code and stores only its hash', async () => {
    const { alice } = cast();
    db().as(alice);

    const code = await generatePairingCode();
    expect(code).toMatch(/^\d{6}$/);

    const stored = db().rows('pairing_codes');
    expect(stored).toHaveLength(1);
    expect(stored[0].code_hash).not.toBe(code);
    expect(stored[0].status).toBe('active');
    expect(stored[0].user_id).toBe(alice.id);
  });

  it('revokes the previous code so only the newest one works', async () => {
    const { alice } = cast();
    db().as(alice);

    const first = await generatePairingCode();
    const second = await generatePairingCode();
    expect(first).not.toBe(second);

    const statuses = db().rows('pairing_codes').map((c) => c.status);
    expect(statuses.filter((s) => s === 'active')).toHaveLength(1);
    expect(statuses).toContain('revoked');
  });

  it('gives the code a 30-day expiry', async () => {
    const { alice } = cast();
    db().as(alice);
    await generatePairingCode();
    const { expires_at: expires } = db().rows('pairing_codes')[0];
    const days = (new Date(expires) - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('throws when not signed in', async () => {
    db().as(null);
    await expect(generatePairingCode()).rejects.toBeDefined();
  });
});

describe('pairWithCode', () => {
  async function codeFor(user) {
    db().as(user);
    const code = await generatePairingCode();
    return code;
  }

  it('links the guardian to the user and consumes the code', async () => {
    const { alice, bob } = cast();
    const code = await codeFor(alice);

    db().as(bob);
    const res = await pairWithCode('alice', code);
    expect(res.ok).toBe(true);
    expect(res.user.user_id).toBe(alice.id);

    const link = db().rows('guardian_links')[0];
    expect(link).toMatchObject({ user_id: alice.id, guardian_id: bob.id, status: 'active' });
    expect(db().rows('pairing_codes')[0].status).toBe('consumed');
  });

  it('matches the username case-insensitively', async () => {
    const { alice, bob } = cast();
    const code = await codeFor(alice);
    db().as(bob);
    expect((await pairWithCode('ALICE', code)).ok).toBe(true);
  });

  it('trims whitespace from the username and code', async () => {
    const { alice, bob } = cast();
    const code = await codeFor(alice);
    db().as(bob);
    expect((await pairWithCode('  alice  ', `  ${code}  `)).ok).toBe(true);
  });

  // Was SEC-04: 'user not found' vs 'invalid or expired code' let any signed-in
  // user tell real accounts from fake ones. Both now give the same message.
  it('rejects an unknown username with the same message as a bad code', async () => {
    const { alice, bob } = cast();
    const code = await codeFor(alice);
    db().as(bob);

    const unknown = await pairWithCode('nobody', '123456');
    const wrongCode = await pairWithCode('alice', '000000');

    expect(unknown.ok).toBe(false);
    expect(wrongCode.ok).toBe(false);
    expect(unknown.error).toBe(wrongCode.error);
    expect(unknown.error).not.toMatch(/not found/i);
    expect(code).toBeTruthy();
  });

  it('locks out a guardian after repeated failures', async () => {
    const { alice, bob } = cast();
    await codeFor(alice);
    db().as(bob);

    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await pairWithCode('alice', String(i).padStart(6, '0'));
    }
    const res = await pairWithCode('alice', '999999');
    expect(res.error).toMatch(/too many attempts/i);
  });

  it('rejects a wrong code without consuming the real one', async () => {
    const { alice, bob } = cast();
    const code = await codeFor(alice);
    db().as(bob);

    const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
    expect((await pairWithCode('alice', wrong)).ok).toBe(false);
    expect(db().rows('pairing_codes')[0].status).toBe('active');
  });

  it('refuses self-pairing', async () => {
    const { alice } = cast();
    const code = await codeFor(alice);
    db().as(alice);
    const res = await pairWithCode('alice', code);
    expect(res.ok).toBe(false);
    expect(db().rows('guardian_links')).toHaveLength(0);
  });

  it('rejects a code that has already been consumed', async () => {
    const { alice, bob, mallory } = cast();
    const code = await codeFor(alice);

    db().as(bob);
    expect((await pairWithCode('alice', code)).ok).toBe(true);

    db().as(mallory);
    expect((await pairWithCode('alice', code)).ok).toBe(false);
  });

  it('rejects an expired code', async () => {
    const { alice, bob } = cast();
    await codeFor(alice);
    const stored = db().rows('pairing_codes')[0];
    stored.expires_at = new Date(Date.now() - 1000).toISOString();

    db().as(bob);
    // Even with the right plaintext we cannot pass expiry.
    const res = await pairWithCode('alice', '000000');
    expect(res.ok).toBe(false);
  });

  it('replaces the previous guardian on the free plan (limit 1)', async () => {
    const { alice, bob, mallory } = cast();

    const first = await codeFor(alice);
    db().as(bob);
    await pairWithCode('alice', first);

    const second = await codeFor(alice);
    db().as(mallory);
    await pairWithCode('alice', second);

    const links = db().rows('guardian_links');
    const active = links.filter((l) => l.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].guardian_id).toBe(mallory.id);
    expect(links.find((l) => l.guardian_id === bob.id).status).toBe('deactivated');
  });

  it('allows a second guardian once the plan raises the limit', async () => {
    const { alice, bob, mallory } = cast();
    db().seed('subscriptions', [
      { user_id: alice.id, plan_id: 'family', status: 'active' },
    ]);

    const first = await codeFor(alice);
    db().as(bob);
    await pairWithCode('alice', first);

    const second = await codeFor(alice);
    db().as(mallory);
    await pairWithCode('alice', second);

    expect(db().rows('guardian_links').filter((l) => l.status === 'active')).toHaveLength(2);
  });

  it('re-pairing the same guardian reactivates rather than duplicating', async () => {
    const { alice, bob } = cast();
    const first = await codeFor(alice);
    db().as(bob);
    await pairWithCode('alice', first);

    db().as(alice);
    await revokeGuardian();

    const second = await codeFor(alice);
    db().as(bob);
    await pairWithCode('alice', second);

    expect(db().rows('guardian_links')).toHaveLength(1);
    expect(db().rows('guardian_links')[0].status).toBe('active');
  });
});

describe('revokeGuardian', () => {
  it('deactivates the link and kills outstanding codes', async () => {
    const { alice, bob } = cast();
    db().as(alice);
    const code = await generatePairingCode();
    db().as(bob);
    await pairWithCode('alice', code);

    db().as(alice);
    await generatePairingCode(); // an unused invite still floating around
    await revokeGuardian();

    expect(db().rows('guardian_links')[0].status).toBe('deactivated');
    expect(db().rows('pairing_codes').every((c) => c.status !== 'active')).toBe(true);
  });

  it('cuts off the guardian`s read access immediately', async () => {
    const { alice, bob } = cast();
    db().as(alice);
    const code = await generatePairingCode();
    db().as(bob);
    await pairWithCode('alice', code);
    db().seed('medicines', [{ user_id: alice.id, name: 'Aspirin', times: ['08:00'] }]);

    expect(await getUserMedicines(alice.id)).toHaveLength(1);

    db().as(alice);
    await revokeGuardian();

    db().as(bob);
    expect(await getUserMedicines(alice.id)).toEqual([]);
  });
});

describe('getMyProfile / updateMySettings', () => {
  it('returns the signed-in user`s own profile', async () => {
    const { alice } = cast();
    db().as(alice);
    expect((await getMyProfile()).username).toBe('alice');
  });

  it('returns null when signed out', async () => {
    db().as(null);
    expect(await getMyProfile()).toBeNull();
  });

  it('merges a settings patch instead of replacing the object', async () => {
    const { alice } = cast();
    db().as(alice);
    const next = await updateMySettings({ graceMinutes: 60 });
    expect(next).toEqual({
      graceMinutes: 60, notifyMode: 'missed', approvalRequired: true,
    });
    expect((await getMyProfile()).settings.notifyMode).toBe('missed');
  });

  it('applies successive patches cumulatively', async () => {
    const { alice } = cast();
    db().as(alice);
    await updateMySettings({ graceMinutes: 5 });
    await updateMySettings({ notifyMode: 'both' });
    expect((await getMyProfile()).settings).toMatchObject({
      graceMinutes: 5, notifyMode: 'both', approvalRequired: true,
    });
  });
});

describe('saveMyPushToken', () => {
  it('stores the token on the caller`s own profile', async () => {
    const { alice } = cast();
    db().as(alice);
    await saveMyPushToken('ExponentPushToken[alice]');
    expect(db().rows('profiles').find((p) => p.id === alice.id).push_token).toBe(
      'ExponentPushToken[alice]'
    );
  });

  it('ignores an empty token and does nothing when signed out', async () => {
    const { alice } = cast();
    db().as(alice);
    await saveMyPushToken(null);
    expect(db().rows('profiles').find((p) => p.id === alice.id).push_token).toBeNull();

    db().as(null);
    await expect(saveMyPushToken('t')).resolves.toBeUndefined();
  });
});

describe('getMyActiveGuardian', () => {
  it('returns the linked guardian with their display details', async () => {
    const { alice, bob } = cast();
    db().rows('profiles').find((p) => p.id === bob.id).display_name = 'Bob Kumar';
    db().link(alice.id, bob.id);

    db().as(alice);
    const g = await getMyActiveGuardian();
    expect(g.guardian_id).toBe(bob.id);
    expect(g.guardianUsername).toBe('bob');
    expect(g.guardianName).toBe('Bob Kumar');
  });

  it('returns null when no guardian is linked', async () => {
    const { alice } = cast();
    db().as(alice);
    expect(await getMyActiveGuardian()).toBeNull();
  });

  it('ignores a deactivated link', async () => {
    const { alice, bob } = cast();
    db().link(alice.id, bob.id, 'deactivated');
    db().as(alice);
    expect(await getMyActiveGuardian()).toBeNull();
  });

  // Was BUG-01: the query filtered only on status='active', and RLS on
  // guardian_links returns rows where the caller is EITHER party — so someone
  // who also guarded another account matched the wrong row and was shown as
  // their own guardian. The user_id filter fixes it.
  it('ignores links where the caller is the guardian, not the patient', async () => {
    const { alice, bob, mallory } = cast();
    // alice is mallory's guardian...
    db().link(mallory.id, alice.id);
    // ...and alice has no guardian of her own.
    db().as(alice);

    expect(await getMyActiveGuardian()).toBeNull();
    expect(bob).toBeTruthy();
  });

  it('still finds the caller`s own guardian when they also guard someone', async () => {
    const { alice, bob, mallory } = cast();
    db().link(mallory.id, alice.id); // alice guards mallory
    db().link(alice.id, bob.id); // bob guards alice
    db().as(alice);

    const g = await getMyActiveGuardian();
    expect(g.guardian_id).toBe(bob.id);
    expect(g.guardianUsername).toBe('bob');
  });
});

describe('getActiveGuardianTarget', () => {
  it('resolves the guardian`s push token for the missed-dose alert', async () => {
    const { alice, bob } = cast();
    db().rows('profiles').find((p) => p.id === bob.id).push_token = 'ExponentPushToken[bob]';
    db().link(alice.id, bob.id);

    db().as(alice);
    expect(await getActiveGuardianTarget()).toEqual({
      token: 'ExponentPushToken[bob]', username: 'bob',
    });
  });

  it('returns null when the guardian has no push token registered', async () => {
    const { alice, bob } = cast();
    db().link(alice.id, bob.id);
    db().as(alice);
    expect(await getActiveGuardianTarget()).toBeNull();
  });

  it('returns null when there is no guardian at all', async () => {
    const { alice } = cast();
    db().as(alice);
    expect(await getActiveGuardianTarget()).toBeNull();
  });

  // Was BUG-01 in its highest-impact form: without the owner filter, a user who
  // also guards someone resolved the link where THEY are the guardian and then
  // read their own push token — so their missed-dose alerts went to their own
  // phone and their real guardian was never told.
  it('never resolves the caller`s own device as the alert target', async () => {
    const { alice, mallory } = cast();
    db().rows('profiles').find((p) => p.id === alice.id).push_token = 'ExponentPushToken[alice]';
    db().link(mallory.id, alice.id); // alice guards mallory, but has no guardian

    db().as(alice);
    expect(await getActiveGuardianTarget()).toBeNull();
  });

  it('resolves the real guardian for a user who also guards someone else', async () => {
    const { alice, bob, mallory } = cast();
    db().rows('profiles').find((p) => p.id === alice.id).push_token = 'ExponentPushToken[alice]';
    db().rows('profiles').find((p) => p.id === bob.id).push_token = 'ExponentPushToken[bob]';
    db().link(mallory.id, alice.id); // alice guards mallory
    db().link(alice.id, bob.id); // bob guards alice

    db().as(alice);
    expect(await getActiveGuardianTarget()).toEqual({
      token: 'ExponentPushToken[bob]', username: 'bob',
    });
  });
});

describe('getLinkedUsers', () => {
  it('lists the people this guardian looks after', async () => {
    const { alice, bob } = cast();
    db().rows('profiles').find((p) => p.id === alice.id).display_name = 'Alice R';
    db().link(alice.id, bob.id);

    db().as(bob);
    expect(await getLinkedUsers()).toEqual([
      { userId: alice.id, username: 'alice', name: 'Alice R' },
    ]);
  });

  it('excludes deactivated links', async () => {
    const { alice, bob } = cast();
    db().link(alice.id, bob.id, 'deactivated');
    db().as(bob);
    expect(await getLinkedUsers()).toEqual([]);
  });

  it('returns an empty list for someone who guards nobody', async () => {
    const { mallory } = cast();
    db().as(mallory);
    expect(await getLinkedUsers()).toEqual([]);
  });

  // Was BUG-02: with no guardian_id filter the caller's OWN guardian link came
  // back, so a patient saw themselves under "People you look after".
  it('never lists the caller`s own guardian link', async () => {
    const { alice, bob } = cast();
    db().link(alice.id, bob.id); // bob guards alice

    db().as(alice);
    expect(await getLinkedUsers()).toEqual([]);
  });

  it('lists only the people the caller actually guards', async () => {
    const { alice, bob, mallory } = cast();
    db().link(alice.id, bob.id); // bob guards alice
    db().link(mallory.id, alice.id); // alice guards mallory

    db().as(alice);
    const linked = await getLinkedUsers();
    expect(linked).toHaveLength(1);
    expect(linked[0].userId).toBe(mallory.id);
  });
});

describe('getUserMedicines', () => {
  it('lets a linked guardian read the patient`s medicines', async () => {
    const { alice, bob } = cast();
    db().link(alice.id, bob.id);
    db().seed('medicines', [
      { user_id: alice.id, name: 'Aspirin', times: ['08:00'], photo: 'b64' },
    ]);

    db().as(bob);
    const meds = await getUserMedicines(alice.id);
    expect(meds).toHaveLength(1);
    expect(meds[0].name).toBe('Aspirin');
    expect(meds[0].photo).toBe('b64');
  });

  it('returns nothing to an unlinked stranger', async () => {
    const { alice, mallory } = cast();
    db().seed('medicines', [{ user_id: alice.id, name: 'Aspirin', times: ['08:00'] }]);
    db().as(mallory);
    expect(await getUserMedicines(alice.id)).toEqual([]);
  });
});

describe('action requests', () => {
  function linked() {
    const c = cast();
    db().link(c.alice.id, c.bob.id);
    return c;
  }

  it('a linked guardian can file an add-medicine request', async () => {
    const { alice, bob } = linked();
    db().as(bob);

    const res = await createAddMedicineRequest(alice.id, {
      name: 'Vitamin D', times: ['09:00'],
    });
    expect(res.ok).toBe(true);

    const row = db().rows('action_requests')[0];
    expect(row).toMatchObject({
      user_id: alice.id, guardian_id: bob.id, kind: 'add_medicine', status: 'pending',
    });
    expect(row.payload.name).toBe('Vitamin D');
  });

  it('an unlinked stranger cannot file a request', async () => {
    const { alice, mallory } = linked();
    db().as(mallory);
    const res = await createAddMedicineRequest(alice.id, { name: 'Bad', times: ['09:00'] });
    expect(res.ok).toBe(false);
    expect(db().rows('action_requests')).toHaveLength(0);
  });

  it('the patient sees the pending request', async () => {
    const { alice, bob } = linked();
    db().as(bob);
    await createAddMedicineRequest(alice.id, { name: 'Vitamin D', times: ['09:00'] });

    db().as(alice);
    const pending = await getPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.name).toBe('Vitamin D');
  });

  it('the patient can approve or reject', async () => {
    const { alice, bob } = linked();
    db().as(bob);
    await createAddMedicineRequest(alice.id, { name: 'Vitamin D', times: ['09:00'] });

    db().as(alice);
    const [req] = await getPendingRequests();
    await setRequestStatus(req.id, 'approved');
    expect(db().rows('action_requests')[0].status).toBe('approved');
    expect(await getPendingRequests()).toEqual([]);
  });

  it('an unrelated user sees nothing', async () => {
    const { alice, bob, mallory } = linked();
    db().as(bob);
    await createAddMedicineRequest(alice.id, { name: 'Vitamin D', times: ['09:00'] });
    db().as(mallory);
    expect(await getPendingRequests()).toEqual([]);
  });

  it('carries a photo through the request payload', async () => {
    const { alice, bob } = linked();
    db().as(bob);
    await createAddMedicineRequest(alice.id, {
      name: 'Vitamin D', times: ['09:00'], photo: 'b64photo',
    });
    db().as(alice);
    expect((await getPendingRequests())[0].payload.photo).toBe('b64photo');
  });

  // Was BUG-03: getPendingRequests had no user_id filter, and RLS lets a
  // guardian read the requests they created — so a guardian was offered their
  // own outgoing request to approve, into their own account.
  it('never offers the guardian their own outgoing request', async () => {
    const { alice, bob } = linked();
    db().as(bob);
    await createAddMedicineRequest(alice.id, { name: 'Vitamin D', times: ['09:00'] });

    expect(await getPendingRequests()).toEqual([]); // still signed in as bob
  });

  it('lets the guardian track their outgoing requests separately', async () => {
    const { alice, bob } = linked();
    db().as(bob);
    await createAddMedicineRequest(alice.id, { name: 'Vitamin D', times: ['09:00'] });

    const outgoing = await getMyOutgoingRequests();
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].user_id).toBe(alice.id);
    expect(outgoing[0].status).toBe('pending');
  });
});
