const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/paypal-sandbox.js'), 'utf8');

async function harness({ signedIn = true, stored, status = 'created', configFailure = false } = {}) {
  const elements = new Map();
  const calls = [];
  const values = new Map(stored ? [['passiton-paypal-sandbox:buyer', JSON.stringify(stored)]] : []);
  let session = signedIn ? { user: { id: 'buyer', email: 'test@example.test' }, access_token: 'user-token' } : null;
  let callbacks;
  let reloaded = false;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', dataset: {}, hidden: ['sandbox-account', 'sandbox-payment', 'sandbox-details'].includes(id),
      value: '', disabled: false, handlers: {},
      addEventListener(name, handler) { this.handlers[name] = handler; },
      querySelector() { return element(`${id}-button`); }
    });
    return elements.get(id);
  };
  const context = {
    window: {
      PASSITON_SUPABASE_CONFIG: { url: 'https://project.supabase.co', publishableKey: 'public-key' },
      supabase: { createClient: () => ({ auth: {
        getSession: async () => ({ data: { session } }),
        signInWithPassword: async () => {
          session = { user: { id: 'buyer', email: 'test@example.test' }, access_token: 'user-token' };
          return { data: { session } };
        }, signOut: async () => ({})
      } }) },
      paypal: { FUNDING: { PAYPAL: 'paypal' }, Buttons: options => {
        callbacks = options; return { render: async () => {} };
      } }
    },
    document: { getElementById: element },
    location: { protocol: 'http:', reload: () => { reloaded = true; } },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    crypto: webcrypto, URLSearchParams, AbortSignal,
    confirm: () => true,
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      if (body.action === 'config') return { ok: !configFailure, json: async () => configFailure
        ? { error: 'Kontot är inte tillagt som PayPal-testare.' }
        : { environment: 'sandbox', clientId: 'public-client', amount: '10.00', currency: 'SEK' } };
      return { ok: true, json: async () => ({ orderId: 'TESTORDER123456789', status: body.action === 'create' ? 'created' : status,
        captureId: status === 'completed' ? 'CAPTURE123' : null }) };
    }
  };
  await vm.runInNewContext(source, context);
  return { element, calls, values, get callbacks() { return callbacks; }, get reloaded() { return reloaded; } };
}

test('sandbox page requires Passiton login and clears the password after submitting', async () => {
  const h = await harness({ signedIn: false });
  assert.equal(h.calls.length, 0);
  assert.equal(h.element('sandbox-payment').hidden, true);
  h.element('sandbox-email').value = 'test@example.test';
  h.element('sandbox-password').value = 'sensitive-password';
  await h.element('sandbox-login').handlers.submit({ preventDefault() {}, currentTarget: h.element('sandbox-login') });
  assert.equal(h.element('sandbox-password').value, '');
  assert.equal(h.element('sandbox-login').hidden, true);
  assert.equal(h.element('sandbox-payment').hidden, false);
});

test('completed order restored from storage is checked instead of creating/capturing again', async () => {
  const h = await harness({ stored: { requestId: 'existing-request', orderId: 'TESTORDER123456789' }, status: 'completed' });
  assert.deepEqual(h.calls.map(call => call.action), ['config', 'status']);
  assert.equal(h.element('paypal-buttons').hidden, true);
  assert.match(h.element('sandbox-status').textContent, /Testbetalningen är bekräftad/);
});

test('pending payment stays unconfirmed and approved callback captures only the stored order', async () => {
  const h = await harness({ status: 'pending' });
  await h.callbacks.createOrder();
  await assert.rejects(h.callbacks.onApprove({ orderID: 'OTHERORDER' }), /annat test/);
  assert.equal(h.calls.filter(call => call.action === 'capture').length, 0);
  await h.callbacks.onApprove({ orderID: 'TESTORDER123456789' });
  assert.equal(h.calls.filter(call => call.action === 'capture').length, 1);
  assert.match(h.element('sandbox-status').textContent, /inte bekräftad/);
  assert.equal(h.element('paypal-buttons').hidden, true);
});

test('non-allowlisted user sees setup error and never loads a payment button', async () => {
  const h = await harness({ configFailure: true });
  assert.equal(h.callbacks, undefined);
  assert.equal(h.element('sandbox-payment').hidden, true);
  assert.match(h.element('sandbox-status').textContent, /inte tillagt/);
});
