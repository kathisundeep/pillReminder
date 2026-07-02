// Phase 4 payment integration — SKELETON / STUB. No real charges happen yet.
//
// Targeted markets: India (UPI + debit/credit; auto-debit via UPI AutoPay /
// e-NACH) → Razorpay; USA/Canada (cards; Stripe Billing for subscriptions +
// auto-renew) → Stripe. Pick provider by the user's country at checkout.
//
// TODO(P4): implement real checkout + webhooks (Supabase Edge Function) that
// flip public.subscriptions.status to 'active' and set current_period_end /
// auto_renew. Store only provider tokens in public.payment_methods — never raw
// card data. See supabase/schema.sql (subscriptions, payment_methods) and the
// research pointers in the plan file.

export const PROVIDER_BY_COUNTRY = {
  IN: 'razorpay',
  US: 'stripe',
  CA: 'stripe',
};

export function providerForCountry(country) {
  return PROVIDER_BY_COUNTRY[country] || 'stripe';
}

// Returns { ok:false, stub:true } for now so callers fall back to mock
// activation. When real payments land, this resolves after a successful charge.
export async function startCheckout({ planId, country } = {}) {
  // TODO(P4): open Razorpay/Stripe checkout, await payment, verify server-side.
  return {
    ok: false,
    stub: true,
    provider: providerForCountry(country),
    planId,
    message: 'Online payment is not enabled yet (test mode).',
  };
}

// TODO(P4): list/add/remove saved cards via the provider's vault + our
// public.payment_methods table.
export async function listPaymentMethods() {
  return [];
}

export async function addPaymentMethod() {
  return { ok: false, stub: true, message: 'Adding cards is not enabled yet.' };
}

// TODO(P4): toggle auto-renew (UPI AutoPay / e-NACH mandate or Stripe
// subscription) — currently persisted only as a flag on the subscription row.
export async function setAutoRenew() {
  return { ok: false, stub: true };
}
