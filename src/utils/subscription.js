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

// MOCK activation (no payment). Marks any prior active sub canceled, inserts a
// new active one. Real charging is wired in Phase 4 via utils/payments.js.
export async function activatePlanMock(planId, { autoRenew = false } = {}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error('not signed in');
  await supabase
    .from('subscriptions')
    .update({ status: 'canceled' })
    .eq('user_id', u.user.id)
    .eq('status', 'active');
  const end = new Date();
  end.setMonth(end.getMonth() + 1);
  const { error } = await supabase.from('subscriptions').insert({
    user_id: u.user.id,
    plan_id: planId,
    status: 'active',
    auto_renew: autoRenew,
    current_period_end: end.toISOString(),
  });
  if (error) throw error;
}
