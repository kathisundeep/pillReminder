// In-memory stand-in for @supabase/supabase-js.
//
// It implements exactly the surface PillReminder uses, and — crucially — it
// simulates the Row-Level Security policies from supabase/schema.sql. That
// matters because several real bugs in this app are "the query relies on RLS to
// scope rows but RLS is broader than the code assumes". A fake that ignored RLS
// would make those tests pass and hide the bug.
//
//   const { client, db } = createFakeSupabase();
//   db.seed('medicines', [{ user_id: 'u1', name: 'Aspirin', times: ['08:00'] }]);
//
// db.as(uid)            — pretend a different user is signed in (attack tests)
// db.failOn(t, op, err) — make an operation return a Postgrest-style error
// db.rows(table)        — read raw rows, bypassing RLS, for assertions

let uuidCounter = 0;
function fakeUuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
}

// Monotonic, deterministic timestamps so .order('created_at') is stable
// regardless of fake timers.
let clock = 0;
function nextStamp() {
  clock += 1000;
  return new Date(Date.UTC(2024, 0, 1) + clock).toISOString();
}

const TABLES = [
  'profiles',
  'guardian_links',
  'pairing_codes',
  'medicines',
  'dose_history',
  'health_readings',
  'action_requests',
  'plans',
  'subscriptions',
  'payment_methods',
];

// Column defaults declared in supabase/schema.sql. Applied on insert so code
// that relies on the server filling these in behaves the same here.
const COLUMN_DEFAULTS = {
  guardian_links: {
    status: 'active',
    permissions: { canView: true, canRequestAdd: true },
  },
  pairing_codes: { status: 'active' },
  action_requests: { status: 'pending' },
  subscriptions: { status: 'active', auto_renew: false },
  payment_methods: { is_default: false },
  medicines: {
    form: 'Tablet',
    color: '#FFFFFF',
    times: [],
    snooze_minutes: 10,
    frequency: 'daily',
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    tone_id: 'classic',
    alert_guardian: true,
  },
  profiles: {
    is_guardian: false,
    settings: { graceMinutes: 30, notifyMode: 'missed', approvalRequired: true },
    phone: null,
    phone_verified_at: null,
    full_name: null,
    gender: null,
    date_of_birth: null,
    height_cm: null,
    country: null,
    onboarded_at: null,
  },
};

function withDefaults(table, row) {
  const defaults = COLUMN_DEFAULTS[table];
  if (!defaults) return row;
  const out = { ...row };
  for (const [col, value] of Object.entries(defaults)) {
    if (out[col] === undefined) out[col] = value;
  }
  return out;
}

function sha256ish(s) {
  // Not real sha256 — the fake only needs a stable one-way-ish mapping so that
  // code_hash comparisons behave like the real digest() comparison.
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `hash_${h.toString(16)}`;
}

export function createFakeSupabase(options = {}) {
  const db = {
    tables: Object.fromEntries(TABLES.map((t) => [t, []])),
    functionHandlers: {},
    pairingAttempts: [],
    authUsers: [],
    session: null,
    errors: {},
    // RLS on by default: this is what production does.
    rlsEnabled: options.rlsEnabled !== false,
  };

  const uid = () => db.session?.user?.id || null;

  // ---- RLS policy simulation (mirrors supabase/schema.sql) ----------------
  const isLinkedGuardian = (targetUserId, guardianId) =>
    !!guardianId &&
    db.tables.guardian_links.some(
      (l) =>
        l.user_id === targetUserId &&
        l.guardian_id === guardianId &&
        l.status === 'active'
    );

  const POLICIES = {
    profiles: (r, me) =>
      r.id === me ||
      isLinkedGuardian(r.id, me) ||
      db.tables.guardian_links.some(
        (l) => l.user_id === me && l.guardian_id === r.id
      ),
    medicines: (r, me) => r.user_id === me || isLinkedGuardian(r.user_id, me),
    dose_history: (r, me) => r.user_id === me || isLinkedGuardian(r.user_id, me),
    health_readings: (r, me) =>
      r.user_id === me || isLinkedGuardian(r.user_id, me),
    // NOTE: readable by BOTH parties — the source of several ownership bugs.
    guardian_links: (r, me) => r.user_id === me || r.guardian_id === me,
    action_requests: (r, me) => r.user_id === me || r.guardian_id === me,
    pairing_codes: (r, me) => r.user_id === me,
    subscriptions: (r, me) => r.user_id === me,
    payment_methods: (r, me) => r.user_id === me,
    plans: () => true,
  };

  const WRITE_POLICIES = {
    profiles: (r, me) => r.id === me,
    medicines: (r, me) => r.user_id === me,
    dose_history: (r, me) => r.user_id === me,
    health_readings: (r, me) => r.user_id === me,
    pairing_codes: (r, me) => r.user_id === me,
    // Matches schema.sql: guardian may insert if they are an active guardian.
    action_requests: (r, me) =>
      r.user_id === me || (r.guardian_id === me && isLinkedGuardian(r.user_id, me)),
    // hardening.sql revokes insert/update/delete from authenticated: a plan
    // becomes active only through a service-role Edge Function called by a
    // verified payment webhook.
    subscriptions: () => false,
    payment_methods: () => false,
    guardian_links: () => false, // writes only via security-definer RPC
    plans: () => false,
  };

  const visible = (table) => {
    const rows = db.tables[table] || [];
    if (!db.rlsEnabled) return rows;
    const policy = POLICIES[table];
    if (!policy) return [];
    const me = uid();
    return rows.filter((r) => policy(r, me));
  };

  const canWrite = (table, row) => {
    if (!db.rlsEnabled) return true;
    const policy = WRITE_POLICIES[table];
    if (!policy) return false;
    return policy(row, uid());
  };

  const rlsError = () => ({
    message: 'new row violates row-level security policy',
    code: '42501',
  });

  const injected = (table, op) => db.errors[`${table}:${op}`] || null;

  // ---- Query builder -----------------------------------------------------
  function makeBuilder(table) {
    const state = {
      op: 'select',
      selectStr: '*',
      filters: [],
      orderBy: null,
      limitN: null,
      single: null, // 'single' | 'maybeSingle'
      payload: null,
    };

    const matches = (row) =>
      state.filters.every((f) => {
        const v = row[f.col];
        if (f.type === 'eq') return v === f.val;
        if (f.type === 'lt') return v < f.val;
        if (f.type === 'in') return f.val.includes(v);
        return true;
      });

    // Supports the one embedded resource this app asks for: `plans(*)`.
    const embed = (row) => {
      if (!/plans\s*\(/.test(state.selectStr)) return row;
      const plan =
        db.tables.plans.find((p) => p.id === row.plan_id) || null;
      return { ...row, plans: plan };
    };

    const run = () => {
      const err = injected(table, state.op);
      if (err) return { data: null, error: err };

      if (state.op === 'select') {
        let rows = visible(table).filter(matches);
        if (state.orderBy) {
          const { col, ascending } = state.orderBy;
          rows = [...rows].sort((a, b) => {
            const av = a[col];
            const bv = b[col];
            if (av === bv) return 0;
            return (av > bv ? 1 : -1) * (ascending ? 1 : -1);
          });
        }
        if (state.limitN != null) rows = rows.slice(0, state.limitN);
        rows = rows.map(embed);
        if (state.single === 'single') {
          if (rows.length !== 1)
            return {
              data: null,
              error: { message: 'JSON object requested, multiple (or no) rows returned' },
            };
          return { data: rows[0], error: null };
        }
        if (state.single === 'maybeSingle') {
          if (rows.length > 1)
            return { data: null, error: { message: 'multiple rows returned' } };
          return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null };
      }

      if (state.op === 'insert') {
        const incoming = Array.isArray(state.payload)
          ? state.payload
          : [state.payload];
        const created = [];
        for (const raw of incoming) {
          const row = withDefaults(table, {
            id: raw.id || fakeUuid(),
            created_at: raw.created_at || nextStamp(),
            ...raw,
          });
          if (!canWrite(table, row)) return { data: null, error: rlsError() };
          db.tables[table].push(row);
          created.push(row);
        }
        if (state.single === 'single') return { data: created[0], error: null };
        return { data: created, error: null };
      }

      if (state.op === 'update') {
        const targets = visible(table).filter(matches);
        for (const row of targets) {
          const next = { ...row, ...state.payload };
          if (!canWrite(table, next)) return { data: null, error: rlsError() };
          // Mirrors the guard_profile_columns() trigger in hardening.sql:
          // identity columns are not the user's to change.
          const payload =
            table === 'profiles'
              ? Object.fromEntries(
                  Object.entries(state.payload).filter(
                    ([k]) =>
                      ![
                        'id', 'username', 'is_guardian', 'created_at',
                        'phone', 'phone_verified_at',
                      ].includes(k)
                  )
                )
              : state.payload;
          Object.assign(row, payload);
        }
        return { data: targets, error: null };
      }

      if (state.op === 'delete') {
        const targets = visible(table).filter(matches);
        for (const row of targets) {
          if (!canWrite(table, row)) return { data: null, error: rlsError() };
          const i = db.tables[table].indexOf(row);
          if (i >= 0) db.tables[table].splice(i, 1);
        }
        return { data: targets, error: null };
      }

      return { data: null, error: { message: `unsupported op ${state.op}` } };
    };

    const builder = {
      select(str) {
        if (state.op === 'select') state.selectStr = str || '*';
        else state.selectStr = str || '*';
        return builder;
      },
      insert(payload) {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      update(payload) {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      delete() {
        state.op = 'delete';
        return builder;
      },
      eq(col, val) {
        state.filters.push({ type: 'eq', col, val });
        return builder;
      },
      lt(col, val) {
        state.filters.push({ type: 'lt', col, val });
        return builder;
      },
      in(col, val) {
        state.filters.push({ type: 'in', col, val });
        return builder;
      },
      order(col, opts = {}) {
        state.orderBy = { col, ascending: opts.ascending !== false };
        return builder;
      },
      limit(n) {
        state.limitN = n;
        return builder;
      },
      single() {
        state.single = 'single';
        return builder;
      },
      maybeSingle() {
        state.single = 'maybeSingle';
        return builder;
      },
      // PostgrestBuilder is thenable — awaiting it executes the query.
      then(resolve, reject) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e);
        }
      },
      catch(fn) {
        return Promise.resolve(run()).catch(fn);
      },
    };
    return builder;
  }

  // ---- RPCs (mirror supabase/pairing.sql + subscriptions.sql) ------------
  const guardianLimit = (targetUser) => {
    const subs = db.tables.subscriptions.filter(
      (s) => s.user_id === targetUser && s.status === 'active'
    );
    let max = 0;
    for (const s of subs) {
      const plan = db.tables.plans.find((p) => p.id === s.plan_id);
      if (plan && plan.max_guardians > max) max = plan.max_guardians;
    }
    return max || 1;
  };

  const rpcHandlers = {
    generate_pairing_code() {
      const me = uid();
      if (!me) throw new Error('not authenticated');
      for (const c of db.tables.pairing_codes) {
        if (c.user_id === me && c.status === 'active') c.status = 'revoked';
      }
      const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      db.tables.pairing_codes.push({
        id: fakeUuid(),
        user_id: me,
        code_hash: sha256ish(code),
        status: 'active',
        created_at: nextStamp(),
        expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      });
      return code;
    },
    pair_with_code({ target_username, code }) {
      const gid = uid();
      if (!gid) throw new Error('not authenticated');

      // One message for every rejection: distinguishing "no such user" from
      // "wrong code" is an account-enumeration oracle.
      const GENERIC =
        'That username and code do not match. Ask them to generate a new code.';
      const fail = () => {
        db.pairingAttempts.push({ guardian_id: gid, succeeded: false });
        throw new Error(GENERIC);
      };

      const recentFailures = db.pairingAttempts.filter(
        (a) => a.guardian_id === gid && !a.succeeded
      ).length;
      if (recentFailures >= 10) {
        throw new Error('Too many attempts. Try again in 15 minutes.');
      }

      const target = db.tables.profiles.find(
        (p) =>
          String(p.username).toLowerCase() ===
          String(target_username).toLowerCase()
      );
      if (!target || target.id === gid) fail();

      const pc = db.tables.pairing_codes
        .filter(
          (c) =>
            c.user_id === target.id &&
            c.status === 'active' &&
            c.code_hash === sha256ish(String(code)) &&
            new Date(c.expires_at) > new Date()
        )
        .pop();
      if (!pc) fail();

      const lim = guardianLimit(target.id);
      const activeCt = db.tables.guardian_links.filter(
        (l) =>
          l.user_id === target.id &&
          l.status === 'active' &&
          l.guardian_id !== gid
      ).length;

      if (activeCt >= lim) {
        if (lim === 1) {
          for (const l of db.tables.guardian_links) {
            if (l.user_id === target.id && l.status === 'active')
              l.status = 'deactivated';
          }
        } else {
          throw new Error(`guardian limit reached (${lim}).`);
        }
      }

      pc.status = 'consumed';

      const existing = db.tables.guardian_links.find(
        (l) => l.user_id === target.id && l.guardian_id === gid
      );
      if (existing) existing.status = 'active';
      else
        db.tables.guardian_links.push({
          id: fakeUuid(),
          user_id: target.id,
          guardian_id: gid,
          status: 'active',
          permissions: { canView: true, canRequestAdd: true },
          created_at: nextStamp(),
        });

      db.pairingAttempts.push({ guardian_id: gid, succeeded: true });
      return { user_id: target.id, username: target.username };
    },
    username_available({ candidate }) {
      const name = String(candidate ?? '').trim().toLowerCase();
      return !db.tables.profiles.some(
        (p) => String(p.username).toLowerCase() === name
      );
    },
    phone_available({ candidate, want_guardian }) {
      return !db.tables.profiles.some(
        (p) => p.phone === candidate && !!p.is_guardian === !!want_guardian
      );
    },
    revoke_guardian() {
      const me = uid();
      if (!me) throw new Error('not authenticated');
      for (const l of db.tables.guardian_links) {
        if (l.user_id === me && l.status === 'active') l.status = 'deactivated';
      }
      for (const c of db.tables.pairing_codes) {
        if (c.user_id === me && c.status === 'active') c.status = 'revoked';
      }
      return null;
    },
  };

  // ---- Auth --------------------------------------------------------------
  const auth = {
    async signUp({ email, password, options }) {
      if (db.authUsers.some((u) => u.email === email))
        return {
          data: null,
          error: { message: 'User already registered' },
        };
      if (!password || String(password).length < 6)
        return {
          data: null,
          error: { message: 'Password should be at least 6 characters' },
        };
      const user = {
        id: fakeUuid(),
        email,
        password,
        user_metadata: options?.data || {},
      };
      db.authUsers.push(user);
      // Mirrors the public.handle_new_user() trigger.
      db.tables.profiles.push(
        withDefaults('profiles', {
          id: user.id,
          username:
            user.user_metadata.username || `user_${user.id.slice(0, 8)}`,
          display_name: user.user_metadata.display_name || null,
          push_token: null,
          is_guardian: !!user.user_metadata.is_guardian,
          created_at: nextStamp(),
        })
      );
      return { data: { user, session: null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const user = db.authUsers.find(
        (u) => u.email === email && u.password === password
      );
      if (!user)
        return { data: null, error: { message: 'Invalid login credentials' } };
      db.session = { user };
      return { data: { user, session: db.session }, error: null };
    },
    async signOut() {
      db.session = null;
      return { error: null };
    },
    async getSession() {
      return { data: { session: db.session }, error: null };
    },
    async getUser() {
      return { data: { user: db.session?.user || null }, error: null };
    },
  };

  const client = {
    auth,
    from: (table) => makeBuilder(table),
    functions: {
      // Edge Functions run with the service role and are the only path that may
      // write a subscription. Tests can register one with db.onFunction(name, fn).
      async invoke(name, opts) {
        const handler = db.functionHandlers[name];
        if (!handler) {
          return {
            data: null,
            error: { message: `Function not found: ${name}` },
          };
        }
        try {
          return { data: await handler(opts?.body, { uid: uid() }), error: null };
        } catch (e) {
          return { data: null, error: { message: e.message } };
        }
      },
    },
    async rpc(name, args) {
      const err = injected('rpc', name);
      if (err) return { data: null, error: err };
      const handler = rpcHandlers[name];
      if (!handler)
        return { data: null, error: { message: `unknown rpc ${name}` } };
      try {
        return { data: handler(args || {}), error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  };

  // ---- Test control surface ---------------------------------------------
  db.seed = (table, rows) => {
    for (const r of rows) {
      db.tables[table].push(
        withDefaults(table, {
          id: r.id || fakeUuid(),
          created_at: r.created_at || nextStamp(),
          ...r,
        })
      );
    }
    return db.tables[table];
  };
  db.rows = (table) => db.tables[table];
  db.as = (user) => {
    db.session = user ? { user: typeof user === 'string' ? { id: user } : user } : null;
  };
  db.signedInAs = () => uid();
  db.failOn = (table, op, error) => {
    db.errors[`${table}:${op}`] = error || { message: 'simulated failure' };
  };
  db.clearFailures = () => {
    db.errors = {};
  };
  db.hashOf = sha256ish;
  // Stand in for a deployed Edge Function (which runs as the service role).
  db.onFunction = (name, handler) => {
    db.functionHandlers[name] = handler;
  };
  db.activeCodeFor = (userId) =>
    db.tables.pairing_codes.filter(
      (c) => c.user_id === userId && c.status === 'active'
    );

  // Convenience: create a signed-up + signed-in user in one call.
  db.makeUser = (username, extra = {}) => {
    const id = fakeUuid();
    const user = {
      id,
      email: `${username}@pillreminder.app`,
      password: 'password123',
      user_metadata: { username, ...extra },
    };
    db.authUsers.push(user);
    db.tables.profiles.push({
      id,
      username,
      display_name: extra.display_name || null,
      push_token: extra.push_token || null,
      is_guardian: !!extra.is_guardian,
      phone: extra.phone || null,
      phone_verified_at: null,
      full_name: extra.full_name || null,
      gender: null,
      date_of_birth: null,
      height_cm: null,
      country: null,
      onboarded_at: extra.onboarded_at || null,
      settings: {
        graceMinutes: 30,
        notifyMode: 'missed',
        approvalRequired: true,
        ...(extra.settings || {}),
      },
      created_at: nextStamp(),
    });
    return user;
  };

  db.link = (userId, guardianId, status = 'active') => {
    db.tables.guardian_links.push({
      id: fakeUuid(),
      user_id: userId,
      guardian_id: guardianId,
      status,
      permissions: { canView: true, canRequestAdd: true },
      created_at: nextStamp(),
    });
  };

  return { client, db };
}

export function resetFakeIds() {
  uuidCounter = 0;
  clock = 0;
}
