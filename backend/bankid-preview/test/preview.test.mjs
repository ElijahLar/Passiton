import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { createPreviewServer, readStagingConfig } from '../server.mjs';
import { createVerification } from '../verification.mjs';

const authResponse = {
  orderRef: 'order-reference',
  autoStartToken: 'autostart-token',
  qrStartToken: 'qr-token',
  qrStartSecret: 'qr-secret'
};

test('a slow collect keeps QR animation running, and completion stores only the timestamp', async () => {
  let now = 10_000;
  let complete;
  const calls = [];
  const bankId = async (operation, data) => {
    calls.push({ operation, data });
    if (operation === 'auth') return authResponse;
    return new Promise((resolve) => { complete = resolve; });
  };
  const session = {};
  const flow = createVerification({ bankId, now: () => now });

  const first = await flow.start(session, '127.0.0.1');
  assert.equal(first.status, 'pending');
  assert.equal(first.autoStartToken, 'autostart-token');
  assert.match(first.qr, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(first).includes('qr-secret'), false);
  assert.deepEqual(calls.map(({ operation }) => operation), ['auth']);

  now += 2000;
  const second = await flow.poll(session);
  now += 1000;
  const third = await flow.poll(session);
  assert.notEqual(first.qr, second.qr);
  assert.notEqual(second.qr, third.qr);
  assert.deepEqual(calls.map(({ operation }) => operation), ['auth', 'collect']);
  assert.deepEqual(calls[1].data, { orderRef: authResponse.orderRef });

  complete({ status: 'complete', completionData: { user: { personalNumber: '190000000000', name: 'Test Identifier' } } });
  await setImmediate();
  assert.equal((await flow.poll(session)).status, 'complete');
  assert.equal(session.verifiedAt, new Date(now).toISOString());
  assert.doesNotMatch(JSON.stringify(session), /190000000000|Test Identifier|qr-secret/);
});

test('an unscanned QR disappears at 30 seconds while a scan can still complete', async () => {
  let now = 10_000;
  let response = { status: 'pending', hintCode: 'outstandingTransaction' };
  const bankId = async (operation) => operation === 'auth' ? authResponse : response;
  const session = {};
  const flow = createVerification({ bankId, now: () => now });

  assert.equal((await flow.start(session, '127.0.0.1')).qrValidForMs, 30_000);
  now += 29_999;
  assert.equal((await flow.status(session)).qrValidForMs, 1);
  now++;
  assert.deepEqual(await flow.status(session), {
    status: 'pending', hintCode: undefined, delayed: undefined, qrExpired: true
  });

  response = { status: 'pending', hintCode: 'userSign' };
  await flow.poll(session);
  await setImmediate();
  assert.equal((await flow.status(session)).hintCode, 'userSign');
  assert.equal((await flow.status(session)).qr, undefined);
  now += 2000;
  response = { status: 'complete', completionData: { user: { personalNumber: '190000000000' } } };
  await flow.poll(session);
  await setImmediate();
  assert.equal((await flow.status(session)).status, 'complete');
});

test('a failed QR order can be replaced after expiry', async () => {
  let now = 10_000;
  let starts = 0;
  const bankId = async (operation) => {
    if (operation === 'collect') return { status: 'failed', hintCode: 'startFailed' };
    starts++;
    return authResponse;
  };
  const session = {};
  const flow = createVerification({ bankId, now: () => now });

  await flow.start(session, '127.0.0.1');
  now += 30_000;
  await flow.poll(session);
  await setImmediate();
  assert.equal((await flow.status(session)).hintCode, 'startFailed');
  const next = await flow.start(session, '127.0.0.1');
  assert.equal(next.qrValidForMs, 30_000);
  assert.equal(starts, 2);
});

test('repeated starts share the same order and cancellation permits a new attempt', async () => {
  let resolveAuth;
  const calls = [];
  const bankId = async (operation) => {
    calls.push(operation);
    if (operation === 'auth') return new Promise((resolve) => { resolveAuth = resolve; });
    return {};
  };
  const session = {};
  const flow = createVerification({ bankId });
  const first = flow.start(session, '127.0.0.1');
  assert.equal((await flow.start(session, '127.0.0.1')).status, 'busy');
  resolveAuth(authResponse);
  await first;
  await flow.start(session, '127.0.0.1');
  assert.equal((await flow.cancel(session)).status, 'idle');
  const second = flow.start(session, '127.0.0.1');
  resolveAuth(authResponse);
  assert.equal((await second).status, 'pending');
  assert.deepEqual(calls, ['auth', 'cancel', 'auth']);
});

test('local HTTP preview blocks other origins and does not expose production settings or certificates', async (t) => {
  const server = createPreviewServer({ bankId: async () => authResponse });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  const api = origin + '/api/bankid/';

  const foreign = await fetch(api + 'start', { method: 'POST', headers: { Origin: 'https://example.org' } });
  assert.equal(foreign.status, 403);
  const config = await fetch(origin + '/frontend/js/supabase-config.js').then((response) => response.text());
  assert.match(config, /PASSITON_SUPABASE_CONFIG = \{\}/);
  const file = await fetch(origin + '/frontend/..%2fbackend%2fbankid-preview%2fclient.mjs');
  assert.equal(file.status, 404);

  const start = await fetch(api + 'start', { method: 'POST', headers: { Origin: origin } });
  const cookie = start.headers.get('set-cookie').split(';')[0];
  assert.equal((await start.json()).status, 'pending');
  const another = await fetch(api + 'status', { method: 'POST', headers: { Origin: origin } });
  const original = await fetch(api + 'status', { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
  assert.equal((await another.json()).status, 'idle');
  assert.equal((await original.json()).status, 'pending');
});

test('staging preview checks the Supabase user and separates account changes', async (t) => {
  const staging = { url: 'https://testproject.supabase.co', publishableKey: 'sb_publishable_test' };
  const server = createPreviewServer({
    bankId: async () => authResponse,
    staging,
    fetchUser: async (token) => ({ 'first-token': 'first-user', 'second-token': 'second-user' })[token]
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  const call = (action, headers) => fetch(origin + '/api/bankid/' + action, {
    method: 'POST', headers: { Origin: origin, ...headers }
  });

  assert.equal((await call('start')).status, 401);
  const start = await call('start', { Authorization: 'Bearer first-token' });
  const cookie = start.headers.get('set-cookie').split(';')[0];
  assert.equal((await start.json()).status, 'pending');

  const different = await call('status', { Cookie: cookie, Authorization: 'Bearer second-token' });
  assert.equal((await different.json()).status, 'idle');
  const same = await call('status', { Cookie: cookie, Authorization: 'Bearer first-token' });
  assert.equal((await same.json()).status, 'pending');
});

test('staging config refuses the live project and server-only keys', () => {
  assert.throws(() => readStagingConfig({
    PASSITON_TEST_SUPABASE_URL: 'https://wcitckdgzjncglwymeks.supabase.co',
    PASSITON_TEST_SUPABASE_KEY: 'sb_publishable_test'
  }), /separate Supabase/);
  assert.throws(() => readStagingConfig({
    PASSITON_TEST_SUPABASE_URL: 'https://testproject.supabase.co',
    PASSITON_TEST_SUPABASE_KEY: 'sb_secret_test'
  }), /publishable/);
});
