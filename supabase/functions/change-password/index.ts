// POST { currentPassword, newPassword } -> { ok }        (signed in)
//
// Changing the password asks for the current one, not a phone code: someone
// holding an unlocked phone must not be able to take the account over. A
// user who has forgotten it uses "Forgot password?" on the login screen.
//
// Done here rather than in the app because checking the current password
// means signing in again, and on the phone that would start a new session —
// which, for a guardian, reads as "signed in on another phone".

import {
  admin, json, CORS, passwordProblem, callerFrom, passwordMatches,
} from '../_shared/otp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const db = admin();
    const user = await callerFrom(req, db);
    if (!user?.email) return json({ error: 'Sign in again, then try.' }, 401);

    const { currentPassword, newPassword } = await req.json();
    const problem = passwordProblem(newPassword);
    if (problem) return json({ error: problem }, 400);
    if (String(currentPassword ?? '') === String(newPassword)) {
      return json({ error: 'Choose a password different from the current one.' }, 400);
    }

    if (!(await passwordMatches(user.email, currentPassword))) {
      return json({ error: 'Your current password is not right.' }, 403);
    }

    const { error } = await db.auth.admin.updateUserById(user.id, { password: newPassword });
    if (error) return json({ error: 'Could not change the password. Try again.' }, 400);

    return json({ ok: true });
  } catch (e) {
    console.error('change-password', e);
    return json({ error: 'Could not change the password. Please try again.' }, 500);
  }
});
