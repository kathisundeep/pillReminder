// Shared helpers for the phone-verification Edge Functions.
//
// These run with the SERVICE ROLE. The client can reach none of this directly:
// public.phone_verifications has RLS on with no policy, and account creation is
// admin-only. That is deliberate — the whole point of an OTP is that the party
// being verified cannot write the result of its own verification.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// E.164. Anything else is rejected before an SMS is ever paid for.
export function normalisePhone(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/[\s()-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

export async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Cryptographically random, not Math.random: this code is the only thing
// standing between a stranger and someone's account.
export function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

// What a phone code is for. verify-otp only accepts a code for the purpose it
// was sent for, and each function that spends a claim checks it again.
export const PURPOSES = ['signup', 'reset', 'change_phone'] as const;
export type Purpose = (typeof PURPOSES)[number];

export function purposeOf(raw: unknown): Purpose | null {
  const p = raw == null || raw === '' ? 'signup' : String(raw);
  return (PURPOSES as readonly string[]).includes(p) ? (p as Purpose) : null;
}

// A claim is spent within this long of the code being verified.
export const CLAIM_TTL_MINUTES = 15;

// The same rule the app shows: 8+ characters, a letter and a number.
export function passwordProblem(raw: unknown): string | null {
  const p = String(raw ?? '');
  if (p.length < 8) return 'Use at least 8 characters for your password.';
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}

// The signed-in caller, from the Authorization header, or null.
export async function callerFrom(req: Request, db: ReturnType<typeof admin>) {
  const header = req.headers.get('Authorization') || '';
  const jwt = header.replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user;
}

// Is this the account's password? Checked on a throwaway client so the
// caller's own session is untouched, and that sign-in is ended straight away.
export async function passwordMatches(email: string, password: string): Promise<boolean> {
  const client = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: String(password ?? '') });
  if (error) return false;
  await client.auth.signOut({ scope: 'local' });
  return true;
}

export function synthEmail(username: string): string {
  return `${String(username).trim().toLowerCase()}@pillreminder.app`;
}

// ---------------------------------------------------------------------------
// Rate limits. SMS costs real money, so an unthrottled send endpoint is both an
// account-takeover surface and a way to burn the project's balance.
// ---------------------------------------------------------------------------
export const LIMITS = {
  perPhonePerHour: 5,
  perIpPerHour: 20,
  maxVerifyAttempts: 5,
  codeTtlMinutes: 10,
};

export async function tooManyRequests(
  db: ReturnType<typeof admin>,
  phone: string,
  ip: string | null
): Promise<string | null> {
  const since = new Date(Date.now() - 3600_000).toISOString();

  const { count: phoneCount } = await db
    .from('phone_verifications')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .gte('created_at', since);
  if ((phoneCount ?? 0) >= LIMITS.perPhonePerHour) {
    return 'Too many codes requested for this number. Try again in an hour.';
  }

  if (ip) {
    const { count: ipCount } = await db
      .from('phone_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('requested_ip', ip)
      .gte('created_at', since);
    if ((ipCount ?? 0) >= LIMITS.perIpPerHour) {
      return 'Too many codes requested from this device. Try again in an hour.';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// SMS delivery.
//
// Provider-agnostic on purpose: set SMS_PROVIDER plus its credentials and this
// is the only place that changes. With no provider configured the function
// still works end to end and logs the code, so the flow can be exercised
// before an SMS account exists — but NEVER in production.
// ---------------------------------------------------------------------------
export async function sendSms(phone: string, body: string): Promise<void> {
  const provider = Deno.env.get('SMS_PROVIDER');

  if (!provider) {
    if (Deno.env.get('ALLOW_UNSENT_OTP') !== 'true') {
      throw new Error(
        'No SMS provider configured. Set SMS_PROVIDER, or ALLOW_UNSENT_OTP=true for a non-production environment.'
      );
    }
    console.warn(`[otp] no provider — code for ${phone}: ${body}`);
    return;
  }

  if (provider === 'twilio') {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const token = Deno.env.get('TWILIO_AUTH_TOKEN')!;
    const from = Deno.env.get('TWILIO_FROM')!;
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: phone, From: from, Body: body }),
      }
    );
    if (!res.ok) throw new Error(`Twilio rejected the message (${res.status})`);
    return;
  }

  if (provider === 'msg91') {
    // India-focused, and materially cheaper there than Twilio.
    const key = Deno.env.get('MSG91_AUTH_KEY')!;
    const templateId = Deno.env.get('MSG91_TEMPLATE_ID')!;
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        recipients: [{ mobiles: phone.replace('+', ''), OTP: body }],
      }),
    });
    if (!res.ok) throw new Error(`MSG91 rejected the message (${res.status})`);
    return;
  }

  throw new Error(`Unknown SMS_PROVIDER: ${provider}`);
}

export function callerIp(req: Request): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    null
  );
}
