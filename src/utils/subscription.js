import { supabase, localUser } from './supabase';

// No plan: no guardians (plans_v2.sql).
const FREE = { id: 'free', name: 'Free', price_cents: 0, currency: 'INR', interval: 'month', max_guardians: 0, months: 0, features: {} };

export const PLAN_MONTHS = [1, 3, 6, 12];

// The plans on sale — months × guardians — ordered by length, then size.
// Free is not "bought", so it is not listed.
export async function getPlans() {
  const { data } = await supabase.from('plans').select('*');
  return (data || [])
    .filter((p) => p.active !== false && p.months > 0)
    .sort((a, b) => a.months - b.months || a.max_guardians - b.max_guardians);
}

// The user's current plan, while it lasts (defaults to Free).
export async function getMyPlan() {
  const { data: u } = await localUser();
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
  if (data.current_period_end && new Date(data.current_period_end) <= new Date()) return FREE;
  return { ...data.plans, auto_renew: data.auto_renew, current_period_end: data.current_period_end };
}

// TEST checkout: activates the plan without taking money (mock_activate_plan).
// Real payments will replace this with a provider checkout + verified webhook.
export async function activateTestPlan(planId) {
  const { data, error } = await supabase.rpc('mock_activate_plan', { plan: planId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data || {}) };
}

export function formatPrice(plan) {
  const sym = plan.currency === 'INR' ? '₹' : '$';
  return `${sym}${Math.round(plan.price_cents / 100).toLocaleString('en-IN')}`;
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
  const { data: u } = await localUser();
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
