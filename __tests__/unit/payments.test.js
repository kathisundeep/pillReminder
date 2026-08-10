import {
  PROVIDER_BY_COUNTRY,
  providerForCountry,
  startCheckout,
  listPaymentMethods,
  addPaymentMethod,
  setAutoRenew,
} from '../../src/utils/payments';

describe('providerForCountry', () => {
  it('routes India to Razorpay (UPI / e-NACH)', () => {
    expect(providerForCountry('IN')).toBe('razorpay');
  });

  it('routes US and Canada to Stripe', () => {
    expect(providerForCountry('US')).toBe('stripe');
    expect(providerForCountry('CA')).toBe('stripe');
  });

  it('falls back to Stripe for anything else', () => {
    for (const c of ['GB', 'AU', 'ZZ', '', undefined, null]) {
      expect(providerForCountry(c)).toBe('stripe');
    }
  });

  it('is case sensitive — lowercase codes fall through to the default', () => {
    // Callers must pass ISO-3166 uppercase; 'in' would silently bill via Stripe.
    expect(providerForCountry('in')).toBe('stripe');
  });

  it('exposes the mapping table for callers that need it', () => {
    expect(PROVIDER_BY_COUNTRY).toEqual({ IN: 'razorpay', US: 'stripe', CA: 'stripe' });
  });
});

// The whole payment layer is an explicit Phase-4 stub. These tests pin that
// contract so it is impossible to ship a build that silently believes a charge
// succeeded.
describe('payment stubs report themselves as stubs', () => {
  it('startCheckout never claims success', async () => {
    const res = await startCheckout({ planId: 'plus', country: 'IN' });
    expect(res.ok).toBe(false);
    expect(res.stub).toBe(true);
    expect(res.provider).toBe('razorpay');
    expect(res.planId).toBe('plus');
    expect(res.message).toMatch(/not enabled/i);
  });

  it('startCheckout picks the provider from the country', async () => {
    expect((await startCheckout({ planId: 'plus', country: 'US' })).provider).toBe('stripe');
    expect((await startCheckout({})).provider).toBe('stripe');
  });

  it('listPaymentMethods returns nothing', async () => {
    expect(await listPaymentMethods()).toEqual([]);
  });

  it('addPaymentMethod refuses', async () => {
    const res = await addPaymentMethod();
    expect(res.ok).toBe(false);
    expect(res.stub).toBe(true);
  });

  it('setAutoRenew refuses', async () => {
    const res = await setAutoRenew();
    expect(res.ok).toBe(false);
    expect(res.stub).toBe(true);
  });
});
