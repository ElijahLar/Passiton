// Shared by the Deno Edge Function and Node's dependency-free integration tests.
// Deliberately no configurable live endpoint and no calls to existing order/listing RPCs.
const PAYPAL_API = 'https://api-m.sandbox.paypal.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_ID = /^[A-Z0-9]{10,32}$/;
const AMOUNT = '10.00';
const CURRENCY = 'SEK';
const PLATFORM_FEE = '1.00';
const FLOW_VERSION = 2;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function handleRequest(request, { env, fetchImpl = fetch, now = () => Date.now() }) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = (env.PAYPAL_SANDBOX_ALLOWED_ORIGINS || 'http://localhost:8000,http://127.0.0.1:8000')
    .split(',').map(value => value.trim()).filter(Boolean);
  const headers = {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info'
  };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (!origin || !allowedOrigins.includes(origin)) return reply(403, { error: 'Testsidans adress är inte tillåten.' });
  headers['Access-Control-Allow-Origin'] = origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply(405, { error: 'Använd POST.' });

  try {
    if (env.PAYPAL_SANDBOX_ENABLED !== 'true') throw new HttpError(503, 'PayPal-testet är inte aktiverat på servern.');
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PAYPAL_SANDBOX_CLIENT_ID',
      'PAYPAL_SANDBOX_CLIENT_SECRET', 'PAYPAL_SANDBOX_MERCHANT_ID', 'PAYPAL_SANDBOX_PARTNER_ID', 'PAYPAL_SANDBOX_BN_CODE']) {
      if (!env[key]) throw new HttpError(503, 'PayPal-testets serverinställningar saknas.');
    }
    const bearer = request.headers.get('Authorization') || '';
    if (!/^Bearer \S+$/i.test(bearer)) throw new HttpError(401, 'Logga in med ditt Passiton-testkonto.');
    // Never trust a decoded JWT or a buyer_id sent by the browser.
    const auth = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: bearer },
      signal: AbortSignal.timeout(15000)
    });
    if (!auth.ok) throw new HttpError(401, 'Sessionen har gått ut. Logga in igen.');
    const user = await auth.json();
    const testers = (env.PAYPAL_SANDBOX_TEST_USER_IDS || '').split(',').map(value => value.trim());
    if (!UUID.test(user.id || '') || !testers.includes(user.id)) {
      throw new HttpError(403, 'Kontot är inte tillagt som PayPal-testare.');
    }
    const raw = await request.text();
    if (raw.length > 4096) throw new HttpError(413, 'För stor förfrågan.');
    let input;
    try { input = JSON.parse(raw); } catch { throw new HttpError(400, 'Ogiltig JSON.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Ogiltig förfrågan.');
    if (!['config', 'create', 'capture', 'status', 'onboard', 'seller-status', 'release'].includes(input.action)) throw new HttpError(400, 'Okänd åtgärd.');
    if (input.action === 'create' && !UUID.test(input.requestId || '')) throw new HttpError(400, 'Ogiltigt test-id.');
    if (['capture','status','release'].includes(input.action) && !ORDER_ID.test(input.orderId || '')) throw new HttpError(400, 'Ogiltigt order-id.');
    if (input.action === 'config') {
      return reply(200, { clientId: env.PAYPAL_SANDBOX_CLIENT_ID, merchantId: env.PAYPAL_SANDBOX_MERCHANT_ID, amount: AMOUNT, currency: CURRENCY, environment: 'sandbox', bnCode: env.PAYPAL_SANDBOX_BN_CODE, platformFee: PLATFORM_FEE, disbursementMode: 'DELAYED', flowVersion: FLOW_VERSION });
    }

    const db = async (query, method = 'GET', body, prefer = 'return=representation') => {
      const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/paypal_sandbox_payments?${query}`, {
        method, headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json', Prefer: prefer
        }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new HttpError(503, 'Testbetalningen kunde inte sparas. Kontrollera att sandbox-migreringen är installerad och försök igen med samma test.');
      return response.json();
    };
    const ownFilter = `buyer_id=eq.${user.id}`;
    const selectRow = async query => (await db(`${ownFilter}&${query}&select=*`))[0];
    const save = async (row, changes) => {
      // A slower parallel retry must never overwrite an already confirmed payment.
      const rows = await db(`${ownFilter}&id=eq.${row.id}&status=neq.completed`, 'PATCH', { ...changes, updated_at: new Date(now()).toISOString() });
      if (rows[0]) return rows[0];
      const current = await selectRow(`id=eq.${row.id}`);
      if (current?.status === 'completed') return current;
      throw new HttpError(503, 'Testbetalningen kunde inte uppdateras.');
    };
    let accessToken;
    const paypal = async (path, method = 'GET', body, requestId) => {
      if (!accessToken) {
        const response = await fetchImpl(`${PAYPAL_API}/v1/oauth2/token`, {
          method: 'POST', headers: {
            Authorization: `Basic ${btoa(`${env.PAYPAL_SANDBOX_CLIENT_ID}:${env.PAYPAL_SANDBOX_CLIENT_SECRET}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new HttpError(502, 'PayPal nekade sandboxinloggningen. Kontrollera sandboxnycklarna.');
        accessToken = (await response.json()).access_token;
        if (!accessToken) throw new HttpError(502, 'PayPal returnerade ingen åtkomsttoken.');
      }
      const response = await fetchImpl(`${PAYPAL_API}${path}`, {
        method, headers: {
          Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
          'PayPal-Partner-Attribution-Id': env.PAYPAL_SANDBOX_BN_CODE,
          ...(path.startsWith('/v2/checkout/') ? { 'PayPal-Auth-Assertion': `${btoa(JSON.stringify({alg:'none'}))}.${btoa(JSON.stringify({iss:env.PAYPAL_SANDBOX_CLIENT_ID,payer_id:env.PAYPAL_SANDBOX_MERCHANT_ID}))}.` } : {}),
          ...(requestId ? { 'PayPal-Request-Id': requestId } : {})
        }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
      });
      if (response.status === 404 && path.startsWith('/v1/customer/partners/')) return {};
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        const safe = value => typeof value === 'string' && /^[A-Z0-9_-]{1,80}$/i.test(value) ? value : '';
        const codes = [safe(failure.name), safe(failure.details?.[0]?.issue), safe(failure.debug_id)].filter(Boolean).join(' / ');
        throw new HttpError(502, `PayPal nekade steget${codes ? ` (${codes})` : ''}. Kontrollera appens Platform Fee, säljarens nya medgivande och behörighet för delayed disbursement. Vid frigörande: kontrollera sandboxpanelen innan nytt försök.`);
      }
      return response.json();
    };
    const sellerId = env.PAYPAL_SANDBOX_MERCHANT_ID;
    const partnerId = env.PAYPAL_SANDBOX_PARTNER_ID;
    if (!/^[A-Z0-9]{8,32}$/.test(sellerId) || !/^[A-Z0-9]{8,32}$/.test(partnerId) || sellerId === partnerId) {
      throw new HttpError(503, 'Ange olika giltiga Merchant ID för plattform och säljare.');
    }
    const sellerStatus = async () => {
      const data = await paypal(`/v1/customer/partners/${partnerId}/merchant-integrations/${sellerId}`);
      const permissions = (data.oauth_integrations || []).flatMap(x => x.oauth_third_party || []);
      const ready = data.merchant_id === sellerId && data.payments_receivable === true &&
        data.primary_email_confirmed === true && permissions.some(x =>
          x.partner_client_id === env.PAYPAL_SANDBOX_CLIENT_ID &&
          (x.scopes || []).includes('https://uri.paypal.com/services/payments/payment/authcapture'));
      return { ready, merchantId: sellerId };
    };
    if (input.action === 'onboard') {
      if (input.consent !== true) throw new HttpError(400, 'Godkänn att starta säljaranslutningen.');
      const referral = await paypal('/v2/customer/partner-referrals', 'POST', {
        tracking_id: `passiton-sandbox-${sellerId}`,
        operations: [{ operation: 'API_INTEGRATION', api_integration_preference: {
          rest_api_integration: { integration_method: 'PAYPAL', integration_type: 'THIRD_PARTY',
            third_party_details: { features: ['PAYMENT', 'REFUND', 'PARTNER_FEE', 'DELAY_FUNDS_DISBURSEMENT'] } }
        }}], products: ['EXPRESS_CHECKOUT'],
        legal_consents: [{ type: 'SHARE_DATA_CONSENT', granted: true }]
      });
      const link = referral.links?.find(x => x.rel === 'action_url')?.href;
      const url = new URL(link || 'https://invalid.example');
      if (url.protocol !== 'https:' || !['www.sandbox.paypal.com','sandbox.paypal.com'].includes(url.hostname)) {
        throw new HttpError(502, 'PayPal returnerade ingen giltig sandboxlänk.');
      }
      return reply(200, { actionUrl: url.href });
    }
    if (input.action === 'seller-status') return reply(200, await sellerStatus());
    if (!(await sellerStatus()).ready) throw new HttpError(409, 'Slutför säljaranslutningen och bekräfta säljarens e-post i sandbox först.');
    const summary = row => ({
      environment: 'sandbox', orderId: row.paypal_order_id, captureId: row.paypal_capture_id,
      status: row.status, amount: AMOUNT, currency: CURRENCY,
      platformFee: row.platform_fee_amount ?? '0.00', disbursementMode: row.disbursement_mode ?? 'INSTANT',
      releaseStatus: row.release_status ?? 'not_requested', releaseItemId: row.release_item_id ?? null,
      flowVersion: row.flow_version ?? 1
    });
    const validateOrder = (order, row) => {
      const units = order.purchase_units;
      const unit = units?.[0];
      if (order.id !== row.paypal_order_id || order.intent !== 'CAPTURE' || units?.length !== 1 ||
        unit.custom_id !== row.id || unit.payee?.merchant_id !== env.PAYPAL_SANDBOX_MERCHANT_ID ||
        unit.amount?.currency_code !== CURRENCY || unit.amount?.value !== AMOUNT) {
        throw new HttpError(502, 'PayPals order matchar inte den sparade testbetalningen.');
      }
      if (row.flow_version === FLOW_VERSION) {
        const instruction = unit.payment_instruction;
        const fees = instruction?.platform_fees;
        if (instruction?.disbursement_mode !== 'DELAYED' || fees?.length !== 1 ||
          fees[0].amount?.currency_code !== CURRENCY || fees[0].amount?.value !== PLATFORM_FEE ||
          (fees[0].payee?.merchant_id && fees[0].payee.merchant_id !== row.partner_merchant_id)) {
          throw new HttpError(502, 'PayPals avgift eller utbetalningsläge matchar inte testet. Ingen utbetalning görs här.');
        }
      }
      return unit;
    };
    const reconcile = async (order, row) => {
      const unit = validateOrder(order, row);
      const captures = unit.payments?.captures || [];
      if (!captures.length) {
        if (order.status === 'COMPLETED') throw new HttpError(502, 'PayPal saknar förväntad betalningsbekräftelse.');
        return row;
      }
      const capture = captures[0];
      if (captures.length !== 1 || !capture.id || capture.amount?.value !== AMOUNT || capture.amount?.currency_code !== CURRENCY) {
        throw new HttpError(502, 'PayPals betalningsbelopp matchar inte testet.');
      }
      const status = capture.status === 'COMPLETED' && order.status === 'COMPLETED' ? 'completed'
        : capture.status === 'PENDING' ? 'pending' : 'failed';
      return save(row, { status, paypal_capture_id: capture.id });
    };

    if (input.action === 'create') {
      if (!UUID.test(input.requestId || '')) throw new HttpError(400, 'Testets begärande-id saknas.');
      // Persist an internal ID before contacting PayPal. Retries share its idempotency key.
      let row = await selectRow(`request_id=eq.${input.requestId}`);
      if (!row) {
        const inserted = await db('on_conflict=buyer_id,request_id', 'POST', {
          buyer_id: user.id, request_id: input.requestId, seller_merchant_id: sellerId,
          flow_version: FLOW_VERSION, platform_fee_amount: PLATFORM_FEE, disbursement_mode: 'DELAYED',
          partner_merchant_id: partnerId, release_status: 'not_requested'
        }, 'resolution=ignore-duplicates,return=representation');
        row = inserted[0] || await selectRow(`request_id=eq.${input.requestId}`);
      }
      if (!row) throw new HttpError(503, 'Testet kunde inte skapas.');
      if (row.seller_merchant_id !== sellerId) throw new HttpError(409, 'Starta ett nytt plattformstest; denna order tillhör tidigare inställningar.');
      if (row.flow_version !== FLOW_VERSION || row.partner_merchant_id !== partnerId) throw new HttpError(409, 'Välj Nytt test för att prova avgift och fördröjd utbetalning.');
      if (row.paypal_order_id) return reply(200, summary(row));
      // PayPal retains create idempotency IDs for a limited time. Never recreate an old uncertain attempt.
      if (now() - Date.parse(row.created_at) > 3 * 60 * 60 * 1000) {
        throw new HttpError(409, 'Testet är för gammalt. Kontrollera sandboxpanelen och starta sedan ett nytt test.');
      }
      const order = await paypal('/v2/checkout/orders', 'POST', {
        intent: 'CAPTURE', purchase_units: [{
          reference_id: 'sandbox-test', custom_id: row.id,
          description: 'Passiton sandboxtest – ingen vara levereras',
          payee: { merchant_id: env.PAYPAL_SANDBOX_MERCHANT_ID },
          amount: { currency_code: CURRENCY, value: AMOUNT },
          payment_instruction: { disbursement_mode: 'DELAYED',
            platform_fees: [{ amount: { currency_code: CURRENCY, value: PLATFORM_FEE } }] }
        }], payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING' } } }
      }, `c${row.id.replaceAll('-', '')}`);
      if (!ORDER_ID.test(order.id || '')) throw new HttpError(502, 'PayPal returnerade ett ogiltigt order-id.');
      row = await save(row, { paypal_order_id: order.id, status: 'created' });
      return reply(200, summary(row));
    }

    if (!ORDER_ID.test(input.orderId || '')) throw new HttpError(400, 'Ogiltigt PayPal-order-id.');
    let row = await selectRow(`paypal_order_id=eq.${input.orderId}`);
    if (!row) throw new HttpError(404, 'Testbetalningen finns inte för ditt konto.');
    if (row.seller_merchant_id !== sellerId) throw new HttpError(409, 'Ordern tillhör tidigare mottagarinställningar.');
    const payoutRoot = '/v1/payments/referenced-payouts-items';
    const validPayoutId = id => typeof id === 'string' && id.length <= 128 && /^[A-Za-z0-9_-]+={0,2}$/.test(id);
    const verifiedPayout = item => item.reference_id === row.paypal_capture_id &&
      item.reference_type === 'TRANSACTION_ID' && validPayoutId(item.item_id);
    const markAccepted = async item => {
      const saved = await db(`${ownFilter}&id=eq.${row.id}&release_status=eq.requested`, 'PATCH', {
        release_status: 'accepted', release_item_id: item.item_id, updated_at: new Date(now()).toISOString()
      });
      return saved[0] || await selectRow(`id=eq.${row.id}`);
    };
    const refreshRelease = async () => {
      if (!validPayoutId(row.release_item_id)) return row;
      const details = await paypal(`${payoutRoot}/${row.release_item_id}`);
      return verifiedPayout(details) && details.item_id === row.release_item_id ? markAccepted(details) : row;
    };
    if (input.action === 'status' && row.release_status === 'requested') {
      return reply(200, summary(await refreshRelease()));
    }
    if (input.action === 'release') {
      if (input.confirm !== true) throw new HttpError(400, 'Bekräfta frigörandet av testpengarna.');
      if (row.flow_version !== FLOW_VERSION || row.partner_merchant_id !== partnerId ||
        row.disbursement_mode !== 'DELAYED' || Number(row.platform_fee_amount) !== Number(PLATFORM_FEE)) {
        throw new HttpError(409, 'Bara nya tester med avgift och fördröjd utbetalning kan frigöras här.');
      }
      if (row.release_status !== 'not_requested') return reply(200, summary(row));
      // Always verify the actual capture, even when the database says completed.
      const order = await paypal(`/v2/checkout/orders/${row.paypal_order_id}`);
      const unit = validateOrder(order, row);
      const captures = unit.payments?.captures || [];
      const capture = captures[0];
      if (order.status !== 'COMPLETED' || captures.length !== 1 || capture?.status !== 'COMPLETED' ||
        !ORDER_ID.test(capture.id || '') || capture.id !== row.paypal_capture_id || row.status !== 'completed' ||
        capture.amount?.value !== AMOUNT || capture.amount?.currency_code !== CURRENCY ||
        unit.payments?.refunds?.length) {
        throw new HttpError(409, 'Frigörande kräver en bekräftad, ej återbetald testbetalning. Kontrollera betalningen först.');
      }
      // Atomic claim: never automatically repeat an uncertain financial operation.
      // A lost response or a crashed worker leaves "requested" for manual reconciliation.
      const claimed = await db(`${ownFilter}&id=eq.${row.id}&release_status=eq.not_requested&status=eq.completed`, 'PATCH', {
        release_status: 'requested', release_requested_at: new Date(now()).toISOString(), updated_at: new Date(now()).toISOString()
      });
      if (!claimed.length) return reply(200, summary(await selectRow(`id=eq.${row.id}`)));
      const payout = await paypal('/v1/payments/referenced-payouts-items', 'POST', {
        reference_id: capture.id, reference_type: 'TRANSACTION_ID'
      }, `r${row.id.replaceAll('-', '')}`);
      // A successful HTTP response means accepted, not proof that the seller received funds.
      if (verifiedPayout(payout)) return reply(200, summary(await markAccepted(payout)));
      if ((payout.reference_id && payout.reference_id !== capture.id) ||
          (payout.reference_type && payout.reference_type !== 'TRANSACTION_ID')) {
        throw new HttpError(502, 'PayPals svar gäller en oväntad referens. Stäm av frigörandet i sandbox.');
      }
      // Minimal replies can identify the resource through a self link. Construct all GETs
      // from the fixed sandbox API root; never send credentials to a response-supplied URL.
      const self = payout.links?.find(link => link.rel === 'self')?.href;
      let linkedId;
      if (typeof self === 'string') {
        const url = URL.parse ? URL.parse(self) : new URL(self);
        if (url && [PAYPAL_API, 'https://api.sandbox.paypal.com'].includes(url.origin) &&
            url.pathname.startsWith(payoutRoot + '/')) linkedId = url.pathname.slice(payoutRoot.length + 1);
      }
      const id = payout.item_id ?? linkedId;
      if (!validPayoutId(id) || (linkedId && id !== linkedId)) return reply(200, summary(claimed[0]));
      const saved = await db(`${ownFilter}&id=eq.${row.id}&release_status=eq.requested`, 'PATCH', {
        release_item_id: id, updated_at: new Date(now()).toISOString()
      });
      if (!saved.length) return reply(200, summary(await selectRow(`id=eq.${row.id}`)));
      row = saved[0];
      return reply(200, summary(await refreshRelease()));
    }
    if (row.status === 'completed') return reply(200, summary(row));
    // GET first recovers a capture that succeeded even if its response/database write was lost.
    let order = await paypal(`/v2/checkout/orders/${row.paypal_order_id}`);
    const unit = validateOrder(order, row);
    if (unit.payments?.captures?.length) {
      row = await reconcile(order, row);
    } else if (input.action === 'capture') {
      if (order.status !== 'APPROVED') throw new HttpError(409, 'Godkänn först betalningen i PayPal.');
      await paypal(`/v2/checkout/orders/${row.paypal_order_id}/capture`, 'POST', {}, `p${row.id.replaceAll('-', '')}`);
      // Retrieve authoritative order details including amount, payee and capture status.
      order = await paypal(`/v2/checkout/orders/${row.paypal_order_id}`);
      row = await reconcile(order, row);
    }
    return reply(200, summary(row));
  } catch (error) {
    // Do not expose provider payloads, credentials, user tokens or database errors.
    return reply(error instanceof HttpError ? error.status : 502, {
      error: error instanceof HttpError ? error.message : 'Anslutningen avbröts. Kontrollera samma test igen innan du startar ett nytt.'
    });
  }
}
