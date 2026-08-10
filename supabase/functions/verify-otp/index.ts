// POST { phone, isGuardian, code } -> { ok, claimToken }
//
// The claim token is what create-account requires. Without it the client could
// verify one number and register with another.

import {
  admin, json, CORS, normalisePhone, sha256, LIMITS,
} from '../_shared/otp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { phone: rawPhone, isGuardian, code } = await req.json();
    const phone = normalisePhone(rawPhone);
    if (!phone) return json({ error: 'Enter a valid phone number.' }, 400);

    const db = admin();
    const { data: row } = await db
      .from('phone_verifications')
      .select('*')
      .eq('phone', phone)
      .eq('is_guardian', isGuardian === true)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // One message for every failure: which of "no code", "expired code" and
    // "wrong code" applies is not the caller's business.
    const GENERIC = 'That code is not right. Request a new one.';
    if (!row) return json({ error: GENERIC }, 400);

    if (row.attempts >= LIMITS.maxVerifyAttempts) {
      await db.from('phone_verifications')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', row.id);
      return json({ error: 'Too many attempts. Request a new code.' }, 429);
    }

    if (row.code_hash !== (await sha256(String(code ?? '')))) {
      await db.from('phone_verifications')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id);
      return json({ error: GENERIC }, 400);
    }

    await db.from('phone_verifications')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id);

    return json({ ok: true, claimToken: row.claim_token });
  } catch (e) {
    console.error('verify-otp', e);
    return json({ error: 'Could not verify the code. Please try again.' }, 500);
  }
});
