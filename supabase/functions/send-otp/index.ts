// POST { phone, isGuardian } -> { ok }
//
// Sends a 6-digit code. Refuses before spending an SMS if the number already
// holds an account of that role, so a user learns immediately rather than after
// completing the whole form.

import {
  admin, json, CORS, normalisePhone, sha256, newCode,
  tooManyRequests, sendSms, callerIp, LIMITS,
} from '../_shared/otp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { phone: rawPhone, isGuardian } = await req.json();
    const phone = normalisePhone(rawPhone);
    if (!phone) {
      return json({ error: 'Enter a valid phone number with its country code.' }, 400);
    }
    const guardian = isGuardian === true;
    const db = admin();

    const limited = await tooManyRequests(db, phone, callerIp(req));
    if (limited) return json({ error: limited }, 429);

    // One patient account and one guardian account per number.
    const { data: available } = await db.rpc('phone_available', {
      candidate: phone,
      want_guardian: guardian,
    });
    if (available === false) {
      return json({
        error: guardian
          ? 'This number already has a guardian account. Log in instead.'
          : 'This number already has a patient account. Log in instead.',
      }, 409);
    }

    const code = newCode();
    const { data: row, error } = await db
      .from('phone_verifications')
      .insert({
        phone,
        is_guardian: guardian,
        code_hash: await sha256(code),
        requested_ip: callerIp(req),
        expires_at: new Date(Date.now() + LIMITS.codeTtlMinutes * 60_000).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;

    await sendSms(phone, `${code} is your PillReminder verification code. It expires in ${LIMITS.codeTtlMinutes} minutes.`);

    return json({ ok: true, verificationId: row.id });
  } catch (e) {
    console.error('send-otp', e);
    return json({ error: 'Could not send the code. Please try again.' }, 500);
  }
});
