import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../backend/supabase/functions/paypal-sandbox/handler.mjs';

const BUYER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const INTERNAL = '44444444-4444-4444-8444-444444444444';
const ORDER = 'TESTORDER123456789';
const NOW = Date.parse('2026-11-12T10:00:00Z');

function harness(options = {}) {
  const env = {
    SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret-service-role',
    PAYPAL_SANDBOX_ENABLED: 'true', PAYPAL_SANDBOX_CLIENT_ID: 'sandbox-client',
    PAYPAL_SANDBOX_CLIENT_SECRET: 'paypal-secret', PAYPAL_SANDBOX_MERCHANT_ID: 'MERCHANT123',
    PAYPAL_SANDBOX_PARTNER_ID: 'PARTNER123', PAYPAL_SANDBOX_BN_CODE: 'TEST_BN',
    PAYPAL_SANDBOX_TEST_USER_IDS: `${BUYER},${OTHER}`, ...options.env
  };
  const rows = [];
  const calls = [];
  let order;
  let captures = 0;
  let failCaptureResponse = false;
  let failSave = false;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const method = init.method || 'GET';
    calls.push({ url, method, headers: init.headers, body: init.body });
    if (parsed.pathname === '/auth/v1/user') {
      if (init.headers.Authorization === 'Bearer invalid') return json({}, 401);
      return json({ id: init.headers.Authorization === 'Bearer other-token' ? OTHER : BUYER });
    }
    if (parsed.pathname === '/rest/v1/paypal_sandbox_payments') {
      assert.equal(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
      if (method === 'POST') {
        const body = JSON.parse(init.body);
        const existing = rows.find(row => row.buyer_id === body.buyer_id && row.request_id === body.request_id);
        if (existing) return json([]);
        const row = { id: INTERNAL, ...body, amount: '10.00', currency: 'SEK', status: 'creating',
          created_at: new Date(NOW).toISOString(), paypal_order_id: null, paypal_capture_id: null };
        rows.push(row); return json([row]);
      }
      const matches = rows.filter(row => [...parsed.searchParams].every(([key, filter]) => {
        if (key === 'select') return true;
        if (filter.startsWith('eq.')) return String(row[key]) === filter.slice(3);
        if (filter.startsWith('neq.')) return String(row[key]) !== filter.slice(4);
        throw Error(`Unexpected filter ${key}: ${filter}`);
      }));
      if (method === 'PATCH') {
        if (failSave) { failSave = false; return json({}, 500); }
        for (const row of matches) Object.assign(row, JSON.parse(init.body));
      }
      return json(matches);
    }
    assert.equal(parsed.origin, 'https://api-m.sandbox.paypal.com', 'Only the sandbox API may receive PayPal requests');
    if (parsed.pathname === '/v1/oauth2/token') {
      if (options.oauthFailure) return json({ secret: 'should-never-leak' }, 401);
      return json({ access_token: 'paypal-access-token' });
    }
    if (parsed.pathname.startsWith('/v1/customer/partners/')) return json({
      merchant_id: 'MERCHANT123', payments_receivable: !options.sellerNotReady, primary_email_confirmed: true,
      oauth_integrations: [{ oauth_third_party: [{ partner_client_id: options.wrongApp ? 'wrong' : 'sandbox-client',
        scopes: ['https://uri.paypal.com/services/payments/payment/authcapture'] }] }]
    });
    if (parsed.pathname === '/v2/customer/partner-referrals') return json({links:[{rel:'action_url',href:options.badLink ? 'https://evil.example' : 'https://www.sandbox.paypal.com/bizsignup/partner/entry'}]});
    if (parsed.pathname === '/v2/checkout/orders') {
      const body = JSON.parse(init.body);
      assert.match(init.headers['PayPal-Request-Id'], /^c[0-9a-f]{32}$/);
      order ||= { id: ORDER, status: 'CREATED', ...body };
      return json(order, 201);
    }
    if (parsed.pathname === `/v2/checkout/orders/${ORDER}/capture`) {
      assert.match(init.headers['PayPal-Request-Id'], /^p[0-9a-f]{32}$/);
      captures++;
      order.status = 'COMPLETED';
      order.purchase_units[0].payments = { captures: [{ id: 'CAPTURE123456789', status: 'COMPLETED',
        amount: { value: '10.00', currency_code: 'SEK' } }] };
      if (failCaptureResponse) { failCaptureResponse = false; throw Error('Network lost after capture'); }
      return json(order, 201);
    }
    if (parsed.pathname === `/v2/checkout/orders/${ORDER}`) return json(order);
    throw Error(`Unexpected fetch ${url}`);
  };
  const invoke = async (payload, { token = 'buyer-token', origin = 'http://localhost:8000', method = 'POST', raw } = {}) => {
    const request = new Request('https://project.supabase.co/functions/v1/paypal-sandbox', {
      method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: ['POST', 'PUT'].includes(method) ? raw ?? JSON.stringify(payload) : undefined
    });
    const response = await handleRequest(request, { env, fetchImpl, now: () => NOW });
    return { status: response.status, headers: response.headers, body: response.status === 204 ? null : await response.json() };
  };
  const create = () => invoke({ action: 'create', requestId: REQUEST });
  return { env, rows, calls, invoke, create, get order() { return order; }, get captures() { return captures; },
    loseCaptureResponse() { failCaptureResponse = true; }, failNextSave() { failSave = true; } };
}

test('disabled server and non-allowlisted origins cannot contact PayPal', async () => {
  const h = harness({ env: { PAYPAL_SANDBOX_ENABLED: 'false' } });
  assert.equal((await h.create()).status, 503);
  assert.equal((await h.invoke({ action: 'config' }, { origin: 'https://passiton.nu' })).status, 403);
  assert.equal((await h.invoke({ action: 'config' }, { origin: '' })).status, 403);
  assert.equal(h.calls.length, 0);
});

test('preflight allows local origin; unsupported methods are rejected', async () => {
  const h = harness();
  const preflight = await h.invoke(null, { method: 'OPTIONS', token: null });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');
  assert.equal((await h.invoke(null, { method: 'GET' })).status, 405);
  assert.equal(h.calls.length, 0);
});

test('requires a real session and explicit tester allowlist even when gateway JWT check is off', async () => {
  const h = harness();
  assert.equal((await h.invoke({ action: 'create' }, { token: null })).status, 401);
  assert.equal((await h.invoke({ action: 'create' }, { token: 'invalid' })).status, 401);
  h.env.PAYPAL_SANDBOX_TEST_USER_IDS = '';
  assert.equal((await h.create()).status, 403);
  assert.ok(h.calls.every(call => call.url.endsWith('/auth/v1/user')));
});

test('config returns only public sandbox settings', async () => {
  const result = await harness().invoke({ action: 'config' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { clientId: 'sandbox-client', merchantId: 'MERCHANT123', amount: '10.00', currency: 'SEK', environment: 'sandbox' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
});

test('rejects malformed requests and path injection before PayPal', async () => {
  const h = harness();
  for (const payload of [null, [], { action: 'refund' }, { action: 'create', requestId: 'bad' },
    { action: 'capture', orderId: '../../other' }]) assert.equal((await h.invoke(payload)).status, 400);
  assert.equal((await h.invoke({}, { raw: '{' })).status, 400);
  assert.equal((await h.invoke({}, { raw: 'x'.repeat(4097) })).status, 413);
  assert.ok(h.calls.every(call => call.url.endsWith('/auth/v1/user')));
});

test('price, buyer and payee cannot be chosen by browser; retries create only one order', async () => {
  const h = harness();
  const result = await h.invoke({ action: 'create', requestId: REQUEST, amount: '999.00', currency: 'USD', buyer_id: OTHER, payee: 'attacker' });
  assert.equal(result.status, 200);
  assert.equal(h.rows[0].buyer_id, BUYER);
  assert.deepEqual(h.order.purchase_units[0].amount, { currency_code: 'SEK', value: '10.00' });
  assert.equal(h.order.purchase_units[0].payee.merchant_id, 'MERCHANT123');
  assert.equal((await h.create()).body.orderId, result.body.orderId);
  assert.equal(h.calls.filter(call => call.method === 'POST' && call.url.endsWith('/v2/checkout/orders')).length, 1);
});

test('another tester cannot inspect or capture someone else’s order', async () => {
  const h = harness(); await h.create();
  for (const action of ['status', 'capture']) {
    assert.equal((await h.invoke({ action, orderId: ORDER }, { token: 'other-token' })).status, 404);
  }
  assert.equal(h.captures, 0);
});

test('buyer approval is required before capture', async () => {
  const h = harness(); await h.create();
  assert.equal((await h.invoke({ action: 'capture', orderId: ORDER })).status, 409);
  assert.equal(h.captures, 0);
});

test('approved payment is captured, recorded and repeat calls do not capture again', async () => {
  const h = harness(); await h.create(); h.order.status = 'APPROVED';
  const result = await h.invoke({ action: 'capture', orderId: ORDER });
  assert.equal(result.status, 200); assert.equal(result.body.status, 'completed');
  assert.equal(result.body.captureId, 'CAPTURE123456789');
  assert.equal((await h.invoke({ action: 'capture', orderId: ORDER })).body.status, 'completed');
  assert.equal(h.captures, 1);
});

test('lost capture response is reconciled without a second capture', async () => {
  const h = harness(); await h.create(); h.order.status = 'APPROVED'; h.loseCaptureResponse();
  assert.equal((await h.invoke({ action: 'capture', orderId: ORDER })).status, 502);
  assert.equal(h.rows[0].status, 'created');
  assert.equal((await h.invoke({ action: 'status', orderId: ORDER })).body.status, 'completed');
  assert.equal(h.captures, 1);
});

test('lost database write after capture can be retried without another capture', async () => {
  const h = harness(); await h.create(); h.order.status = 'APPROVED'; h.failNextSave();
  assert.equal((await h.invoke({ action: 'capture', orderId: ORDER })).status, 503);
  assert.equal((await h.invoke({ action: 'capture', orderId: ORDER })).body.status, 'completed');
  assert.equal(h.captures, 1);
});

test('lost create database write reuses the same PayPal idempotency key', async () => {
  const h = harness(); h.failNextSave();
  assert.equal((await h.create()).status, 503);
  assert.equal((await h.create()).status, 200);
  const creates = h.calls.filter(call => call.url.endsWith('/v2/checkout/orders'));
  assert.equal(creates.length, 2);
  assert.equal(creates[0].headers['PayPal-Request-Id'], creates[1].headers['PayPal-Request-Id']);
});

test('old uncertain create cannot be recreated after idempotency retention could expire', async () => {
  const h = harness(); h.failNextSave(); await h.create();
  h.rows[0].created_at = '2026-11-11T00:00:00Z';
  assert.equal((await h.create()).status, 409);
  assert.equal(h.calls.filter(call => call.url.endsWith('/v2/checkout/orders')).length, 1);
});

test('pending capture is never reported as completed or captured twice', async () => {
  const h = harness(); await h.create();
  h.order.purchase_units[0].payments = { captures: [{ id: 'PENDINGCAPTURE123', status: 'PENDING', amount: { value: '10.00', currency_code: 'SEK' } }] };
  const result = await h.invoke({ action: 'capture', orderId: ORDER });
  assert.equal(result.body.status, 'pending'); assert.equal(h.captures, 0);
  h.order.status = 'COMPLETED'; h.order.purchase_units[0].payments.captures[0].status = 'COMPLETED';
  assert.equal((await h.invoke({ action: 'status', orderId: ORDER })).body.status, 'completed');
});

test('wrong amount, receiver, internal reference, order identity or intent stops capture', async () => {
  const mutations = [
    order => { order.purchase_units[0].amount.value = '99.00'; },
    order => { order.purchase_units[0].amount.currency_code = 'USD'; },
    order => { order.purchase_units[0].payee.merchant_id = 'ATTACKER'; },
    order => { order.purchase_units[0].custom_id = OTHER; },
    order => { order.id = 'ANOTHERORDER123'; },
    order => { order.intent = 'AUTHORIZE'; }
  ];
  for (const mutate of mutations) {
    const h = harness(); await h.create(); h.order.status = 'APPROVED'; mutate(h.order);
    assert.equal((await h.invoke({ action: 'capture', orderId: ORDER })).status, 502);
    assert.equal(h.captures, 0);
  }
});

test('wrong capture amount is never stored as a successful payment', async () => {
  const h = harness(); await h.create(); h.order.status = 'COMPLETED';
  h.order.purchase_units[0].payments = { captures: [{ id: 'BADCAPTURE123', status: 'COMPLETED', amount: { value: '0.10', currency_code: 'SEK' } }] };
  assert.equal((await h.invoke({ action: 'status', orderId: ORDER })).status, 502);
  assert.equal(h.rows[0].status, 'created');
});

test('provider authentication failures do not leak secrets', async () => {
  const h = harness({ oauthFailure: true });
  const result = await h.create();
  assert.equal(result.status, 502);
  assert.doesNotMatch(JSON.stringify(result.body), /paypal-secret|secret-service-role|should-never-leak|paypal-access-token/);
});

 test('platform refuses payments until seller is ready and has granted this app permission', async () => {
   for (const options of [{sellerNotReady:true},{wrongApp:true}]) {
     const h=harness(options); assert.equal((await h.create()).status,409);
     assert.equal(h.calls.filter(x=>x.url.endsWith('/v2/checkout/orders')).length,0);
   }
 });
 test('onboarding requires consent and permits only PayPal sandbox redirect URLs', async () => {
   const h=harness(); assert.equal((await h.invoke({action:'onboard'})).status,400);
   assert.equal((await h.invoke({action:'onboard',consent:true})).status,200);
   const request=JSON.parse(h.calls.find(x=>x.url.endsWith('/partner-referrals')).body);
   assert.equal(request.operations[0].api_integration_preference.rest_api_integration.integration_type,'THIRD_PARTY');
   assert.equal((await harness({badLink:true}).invoke({action:'onboard',consent:true})).status,502);
 });
 test('platform order carries seller assertion and partner attribution', async () => {
   const h=harness(); await h.create();
   const request=h.calls.find(x=>x.url.endsWith('/v2/checkout/orders'));
   const assertion=JSON.parse(atob(request.headers['PayPal-Auth-Assertion'].split('.')[1]));
   assert.equal(assertion.iss,'sandbox-client');assert.equal(assertion.payer_id,'MERCHANT123');
   assert.equal(request.headers['PayPal-Partner-Attribution-Id'],'TEST_BN');
   assert.equal(h.rows[0].seller_merchant_id,'MERCHANT123');
 });
 test('legacy orders cannot be paid using the platform credentials', async () => {
   const h=harness();await h.create();h.rows[0].seller_merchant_id=null;
   assert.equal((await h.invoke({action:'capture',orderId:ORDER})).status,409);
   assert.equal(h.captures,0);
 });
