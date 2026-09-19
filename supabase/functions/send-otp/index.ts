// POST { phone, isGuardian, purpose? } -> { ok }
//
// Sends a 6-digit code. `purpose` is 'signup' (default), 'reset' (forgot
// password) or 'change_phone'.
//
//   signup, change_phone — the number must NOT already hold an account of that
//     role; refused before spending an SMS, so the user learns at once.
//   reset — the number must hold one. If it does not, the reply is the same
//     "sent" and nothing is sent, so this cannot be used to discover which
//     numbers have accounts.

import {
  admin, json, CORS, normalisePhone, sha256, newCode,
  tooManyRequests, sendSms, callerIp, LIMITS, purposeOf,
} from '../_shared/otp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { phone: rawPhone, isGuardian, purpose: rawPurpose } = await req.json();
    const phone = normalisePhone(rawPhone);
    if (!phone) {
      return json({ error: 'Enter a valid phone number with its country code.' }, 400);
    }
    const purpose = purposeOf(rawPurpose);
    if (!purpose) return json({ error: 'Unknown request.' }, 400);
    const guardian = isGuardian === true;
    const db = admin();

    const limited = await tooManyRequests(db, phone, callerIp(req));
    if (limited) return json({ error: limited }, 429);

    // One patient account and one guardian account per number.
    const { data: available } = await db.rpc('phone_available', {
      candidate: phone,
      want_guardian: guardian,
    });
    if (purpose === 'reset') {
      // Nothing to reset: answer as if sent, send nothing.
      if (available !== false) return json({ ok: true });
    } else if (available === false) {
      return json({
        error: purpose === 'change_phone'
          ? 'This number is already used by another account.'
          : guardian
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
        purpose,
        code_hash: await sha256(code),
        requested_ip: callerIp(req),
        expires_at: new Date(Date.now() + LIMITS.codeTtlMinutes * 60_000).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;

    await sendSms(phone, `${code} is your PillReminder verification code. It expires in ${LIMITS.codeTtlMinutes} minutes.`);

    // TEST MODE ONLY.
    //
    // With no SMS provider configured, ALLOW_UNSENT_OTP lets registration be
    // exercised end to end by handing the code straight back to the caller.
    // That is account takeover for anyone who can reach this endpoint — which
    // is anyone at all — so it is deliberately tied to the same flag that
    // already declares this is not a production environment, and the response
    // is marked so the app can shout about it rather than quietly accept it.
    //
    // Setting SMS_PROVIDER disables this outright: the branch is unreachable
    // once a provider exists, so a real deployment cannot leak codes even if
    // the flag is left set by mistake.
    const unsent =
      !Deno.env.get('SMS_PROVIDER') && Deno.env.get('ALLOW_UNSENT_OTP') === 'true';
    if (unsent) {
      console.warn(`[send-otp] TEST MODE — returned the code for ${phone} in the response`);
    }

    return json({
      ok: true,
      verificationId: row.id,
      ...(unsent ? { testMode: true, testCode: code } : {}),
    });
  } catch (e) {
    console.error('send-otp', e);
    return json({ error: 'Could not send the code. Please try again.' }, 500);
  }
});
