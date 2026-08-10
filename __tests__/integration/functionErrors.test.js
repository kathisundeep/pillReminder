import { sendPhoneCode, phoneError } from '../../src/utils/onboarding';

// supabase-js reports every non-2xx from an Edge Function as one generic string
// and hides the real response on `error.context`. These tests pin the digging,
// because without it a 404 from an undeployed function, a rate-limit, and
// "that number is already registered" all reach the user identically.
const GENERIC = 'Edge Function returned a non-2xx status code';

function httpError(status, body) {
  const error = new Error(GENERIC);
  error.context = {
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
  return error;
}

function mockInvoke(result) {
  const { supabase } = require('../../src/utils/supabase');
  supabase.functions.invoke = jest.fn().mockResolvedValue(result);
}

describe('Edge Function error reporting', () => {
  it('surfaces the message the function actually sent', async () => {
    mockInvoke({
      data: null,
      error: httpError(400, { error: 'This number already has a patient account.' }),
    });
    const res = await sendPhoneCode('+919876543210', false);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('This number already has a patient account.');
    expect(res.error).not.toBe(GENERIC);
  });

  it('explains a 404 as missing setup rather than as a user mistake', async () => {
    mockInvoke({
      data: null,
      error: httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }),
    });
    const res = await sendPhoneCode('+919876543210', false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not deployed/i);
    expect(res.error).toMatch(/nothing you did wrong/i);
  });

  it('reports a rate limit as one', async () => {
    mockInvoke({ data: null, error: httpError(429, 'Too Many Requests') });
    const res = await sendPhoneCode('+919876543210', false);
    expect(res.error).toMatch(/too many attempts/i);
  });

  it('does not blame the user for a server fault', async () => {
    mockInvoke({ data: null, error: httpError(500, 'boom') });
    const res = await sendPhoneCode('+919876543210', false);
    expect(res.error).toMatch(/server had a problem/i);
  });

  it('survives a non-JSON body', async () => {
    mockInvoke({ data: null, error: httpError(503, '<html>gateway</html>') });
    const res = await sendPhoneCode('+919876543210', false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/server had a problem/i);
  });

  it('still translates a genuine network failure', async () => {
    mockInvoke({ data: null, error: new Error('Network request failed') });
    const res = await sendPhoneCode('+919876543210', false);
    expect(res.error).toMatch(/check your connection/i);
  });

  it('passes a success straight through', async () => {
    mockInvoke({ data: { sent: true }, error: null });
    const res = await sendPhoneCode('+919876543210', false);
    expect(res).toEqual({ ok: true, sent: true });
  });
});

describe('phoneError with a country code always present', () => {
  it('asks for a number when empty', () => {
    expect(phoneError('')).toMatch(/enter your phone number/i);
  });

  // The old copy said "include the country code" — nonsense once the picker
  // guarantees one is there.
  it('names the length instead of the country code', () => {
    expect(phoneError('+919')).toMatch(/too short/i);
    expect(phoneError('+9198765432109999')).toMatch(/too long/i);
    expect(phoneError('+919')).not.toMatch(/country code/i);
  });

  it('still asks for a country code when there genuinely is none', () => {
    expect(phoneError('9876543210')).toMatch(/country code/i);
  });

  it('accepts a well-formed number', () => {
    expect(phoneError('+919876543210')).toBeNull();
  });
});
