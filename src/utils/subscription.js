import { supabase } from './supabase';

const FREE = { id: 'free', name: 'Free', price_cents: 0, currency: 'INR', interval: 'month', max_guardians: 1, features: {} };

export async function getPlans() {
  const { data } = await supabase
    .from('plans')
    .select('*')
    .order('price_cents', { ascending: true });
  return data && data.length ? data : [FREE];
}

// The user's current active plan (defaults to Free).
export async function getMyPlan() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return FREE;
  const { data } = await supabase
    .from('subscriptions')
    .select('plan_id, status, auto_renew, current_period_end, plans(*)')
    .eq('user_id', u.user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.plans) return FREE;
  return { ...data.plans, auto_renew: data.auto_renew, current_period_end: data.current_period_end };
}

// Activating a plan is a SERVER decision, made after a verified payment.
//
// This used to insert an 'active' subscription row straight from the client,
// which — combined with a permissive RLS policy — let any user grant themselves
// the top paid tier for free. Both the policy and the write are gone
// (supabase/hardening.sql); a plan becomes active only when the payment
// provider's webhook calls an Edge Function holding the service role.
//
// Downgrading to Free is the one change a user can legitimately make
// unilaterally, and it is a cancellation rather than a grant — it also has to
// go through the server so the provider's recurring mandate is cancelled too.
export async function requestPlanChange(planId) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error('not signed in');

  const { data, error } = await supabase.functions.invoke('change-plan', {
    body: { planId },
  });
  if (error) {
    return {
      ok: false,
      error: error.message || 'Could not reach the billing service.',
    };
  }
  return { ok: true, ...(data || {}) };
}
