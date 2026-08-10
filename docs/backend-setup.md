# Backend setup

The app needs three things from Supabase: the database schema, the Edge
Functions, and an SMS provider. This is the order to do them in and the traps
along the way.

Project ref: **`accxqbtukprszgwroorq`**

> Free-tier Supabase projects pause after about a week of inactivity, and
> projects left paused are eventually deleted. That is what happened once
> already — the hostname stopped resolving entirely. If registration suddenly
> fails with "Can't reach the server", check the dashboard before anything else.

---

## 1. Database — done

Paste `supabase/all.sql` into the Dashboard's SQL Editor and run it. It is all
five migrations in dependency order, and ends with a checklist query that should
read `OK` on every row.

Enable **pg_cron** first (Database → Extensions) or the two retention jobs are
skipped with a notice.

Verify from a terminal:

```bash
curl -s -X POST https://accxqbtukprszgwroorq.supabase.co/rest/v1/rpc/username_available \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H 'Content-Type: application/json' -d '{"candidate":"probe"}'
# -> true
```

---

## 2. Edge Functions

Registration cannot work without these. The client is not allowed to create its
own account or to assert that a phone number was verified — both decisions
belong to the server, which is why they live here and run with the service role.

```bash
brew install supabase/tap/supabase          # or: npm i -g supabase
supabase login
supabase link --project-ref accxqbtukprszgwroorq

supabase functions deploy send-otp       --no-verify-jwt
supabase functions deploy verify-otp     --no-verify-jwt
supabase functions deploy create-account --no-verify-jwt
```

### `--no-verify-jwt` is required, not optional

These three run **before the user has an account**. With JWT verification on,
Supabase rejects the call as unauthenticated and registration can never get
past the phone step. The functions do their own validation instead:

- `send-otp` refuses a malformed number, and rate limits per number and per IP
- `verify-otp` allows five attempts, then burns the code
- `create-account` requires a claim token that only a *consumed* verification
  produces, so a verified number cannot be swapped for an unverified one

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. Do
not set them yourself — Supabase rejects secrets with a `SUPABASE_` prefix.

---

## 3. SMS

### Testing without an SMS account

```bash
supabase secrets set ALLOW_UNSENT_OTP=true
```

The code is written to the function logs instead of sent. Read it with
`supabase functions logs send-otp`. The whole flow works end to end.

**Never leave this set in production.** Anyone who can read the logs can
register as anyone. `send-otp` refuses to run without either a provider or this
flag, so the failure mode is a clear error rather than a silent hole.

### Real delivery

```bash
# India — materially cheaper than Twilio
supabase secrets set SMS_PROVIDER=msg91 \
  MSG91_AUTH_KEY=... MSG91_TEMPLATE_ID=...

# Elsewhere
supabase secrets set SMS_PROVIDER=twilio \
  TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1...

supabase secrets unset ALLOW_UNSENT_OTP
```

Rate limits live in `supabase/functions/_shared/otp.ts`: 5 sends per number per
hour, 20 per IP per hour, 5 verification attempts per code. They exist because
an unthrottled send endpoint is both an account-takeover surface and a way to
empty your SMS balance in an afternoon.

---

## 4. Check it worked

```bash
BASE=https://accxqbtukprszgwroorq.supabase.co
for fn in send-otp verify-otp create-account; do
  printf '%-15s ' "$fn"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/functions/v1/$fn" \
    -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{}'
done
```

`404` means not deployed. `400` is success — the function ran and rejected an
empty body, which is exactly what it should do.

---

## Shipping config changes to phones

Changing the Supabase URL or key is **JS only**:

```bash
eas update --branch preview
```

Installed apps pick it up after two relaunches. No rebuild, no new QR. A
rebuild is only needed for native changes — a new native module, a permission,
an `app.json` plugin, or a version bump.
