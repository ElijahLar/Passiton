/* Standalone sandbox page: does not load app.js or modify its checkout/localStorage. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const message = (text, error = false) => {
    $('sandbox-status').textContent = text;
    $('sandbox-status').dataset.error = String(error);
    $('sandbox-status').scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };
  if (!['http:', 'https:'].includes(location.protocol)) {
    message('Starta sidan via en lokal webbserver, enligt sandboxguiden.', true); return;
  }
  const config = window.PASSITON_SUPABASE_CONFIG;
  if (!config?.url || !config.publishableKey || !window.supabase?.createClient) {
    message('Supabase kunde inte laddas. Kontrollera anslutningen och konfigurationen.', true); return;
  }
  const client = window.supabase.createClient(config.url, config.publishableKey);
  let user;
  let attempt;
  let storageKey;
  let busy = false;
  let buttons;

  const persist = () => localStorage.setItem(storageKey, JSON.stringify(attempt));
  const details = result => {
    $('sandbox-details').hidden = !result.orderId;
    $('sandbox-order').textContent = result.orderId || '—';
    $('sandbox-capture').textContent = result.captureId || '—';
    $('sandbox-check').disabled = !result.orderId;
  };
  const showResult = result => {
    details(result);
    $('sandbox-release').disabled = !(result.status === 'completed' && result.flowVersion === 2 && result.releaseStatus === 'not_requested');
    if (result.status === 'completed') {
      $('paypal-buttons').hidden = true;
      if (result.flowVersion !== 2) message('Testbetalningen är bekräftad från den äldre versionen. Välj Nytt test för avgift och fördröjd utbetalning.');
      else if (result.releaseStatus === 'accepted') message('PayPal har tagit emot frigörandet. Kontrollera att pengarna når säljarens sandboxkonto. Detta är inte en bekräftelse på slutförd utbetalning.');
      else if (result.releaseStatus === 'requested') message('Frigörandet har påbörjats men resultatet är osäkert. Välj Kontrollera betalningen för att läsa status. Om den förblir oklar, stäm av den befintliga transaktionen i PayPal sandbox.');
      else message('Testbetalningen är bekräftad: 10,00 SEK. Plattformsavgift: 1,00 SEK. Ordern använder fördröjd utbetalning. Kontrollera innehållet belopp hos säljaren innan du frigör det. PayPal frigör automatiskt efter 28 dagar.');
    } else if (result.status === 'pending') {
      $('paypal-buttons').hidden = true;
      message('PayPal behandlar testbetalningen. Den är inte bekräftad ännu. Använd Kontrollera betalningen igen.');
    } else if (result.status === 'failed') {
      $('paypal-buttons').hidden = true;
      message('PayPal har inte godkänt testbetalningen. Kontrollera den i sandboxpanelen innan du startar ett nytt test.', true);
    } else {
      message('Testordern är skapad. Godkänn i PayPal-fönstret för att slutföra betalningen.');
    }
  };
  const api = async payload => {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session || data.session.user.id !== user.id) throw Error('Logga in igen med samma testkonto.');
    const response = await fetch(`${config.url}/functions/v1/paypal-sandbox`, {
      method: 'POST', headers: {
        apikey: config.publishableKey, Authorization: `Bearer ${data.session.access_token}`,
        'Content-Type': 'application/json'
      }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000)
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Serverfunktionen kunde inte anropas. Kontrollera installationen.');
    return result;
  };
  const check = async () => {
    if (!attempt?.orderId) return;
    showResult(await api({ action: 'status', orderId: attempt.orderId }));
  };
  const loadSDK = clientId => new Promise((resolve, reject) => {
    if (window.paypal) { resolve(); return; }
    const script = document.createElement('script');
    const params = new URLSearchParams({
      'client-id': clientId, 'merchant-id': window.sandboxMerchantId, currency: 'SEK', intent: 'capture', components: 'buttons',
      'disable-funding': 'card,credit,paylater,venmo', locale: 'sv_SE'
    });
    script.setAttribute('data-partner-attribution-id', window.sandboxBnCode);
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.onload = resolve;
    script.onerror = () => reject(Error('PayPals testknapp kunde inte laddas. Kontrollera nätverket och sandboxnyckeln.'));
    document.head.appendChild(script);
  });
  const initializePayment = async () => {
    storageKey = `passiton-paypal-sandbox:${user.id}`;
    try { attempt = JSON.parse(localStorage.getItem(storageKey)); } catch { attempt = null; }
    if (!attempt?.requestId) { attempt = { requestId: crypto.randomUUID() }; persist(); }
    const settings = await api({ action: 'config' });
    if (settings.environment !== 'sandbox' || settings.amount !== '10.00' || settings.currency !== 'SEK') {
      throw Error('Servern har oväntade testinställningar.');
    }
    $('sandbox-payment').hidden = false;
    $('sandbox-new').disabled = false;
    window.sandboxMerchantId = settings.merchantId;
    window.sandboxBnCode = settings.bnCode;
    await loadSDK(settings.clientId);
    buttons = window.paypal.Buttons({
      fundingSource: window.paypal.FUNDING.PAYPAL,
      style: { layout: 'vertical', label: 'paypal' },
      createOrder: async () => {
        message('Skapar testorder i PayPal sandbox …');
        const result = await api({ action: 'create', requestId: attempt.requestId });
        attempt.orderId = result.orderId; persist(); details(result);
        if (result.status !== 'created') {
          showResult(result); throw Error('Detta test har redan behandlats. Kontrollera betalningen eller välj Nytt test.');
        }
        return result.orderId;
      },
      onApprove: async data => {
        if (data.orderID !== attempt.orderId) throw Error('PayPal returnerade ett annat test.');
        message('Kontrollerar och slutför testbetalningen på servern …');
        showResult(await api({ action: 'capture', orderId: attempt.orderId }));
      },
      onCancel: () => message('PayPal-fönstret stängdes. Ingen betalning slutfördes här. Du kan fortsätta med samma test eller kontrollera status.'),
      onError: error => message(`${error.message || 'PayPal-testet kunde inte slutföras.'} Kontrollera samma betalning innan du startar ett nytt test.`, true)
    });
    await buttons.render('#paypal-buttons');
    if (attempt.orderId) await check();
    else message('Redo. Klicka på PayPal och logga in med din PayPal sandbox-testköpare.');
  };
  const startSession = async session => {
    user = session.user;
    $('sandbox-login').hidden = true;
    $('sandbox-account').hidden = false;
    $('sandbox-user').textContent = `Inloggad: ${user.email}`;
    await initializePayment();
  };
  $('sandbox-login').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const submit = event.currentTarget.querySelector('button');
    submit.disabled = true;
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: $('sandbox-email').value.trim(), password: $('sandbox-password').value
      });
      if (error) throw Error('Inloggningen misslyckades. Kontrollera ditt Passiton-testkonto.');
      await startSession(data.session);
    } catch (error) { message(error.message, true); }
    finally { $('sandbox-password').value = ''; busy = false; submit.disabled = false; }
  });
  $('sandbox-onboard').addEventListener('click', async () => {
    if (!confirm('Öppna PayPal för att ansluta test-säljaren och godkänna delning av kontouppgifter med plattformen?')) return;
    try {
      const result = await api({ action: 'onboard', consent: true });
      const link = $('sandbox-onboard-link');
      link.href = result.actionUrl; link.hidden = false;
      message('Öppna anslutningslänken och logga in med SÄLJARENS sandboxkonto. Återvänd sedan och kontrollera anslutningen.');
    } catch (error) { message(error.message, true); }
  });
  $('sandbox-seller-check').addEventListener('click', async () => {
    $('sandbox-seller-check').disabled = true;
    message('Kontrollerar säljaranslutningen hos PayPal …');
    try {
      const result = await api({ action: 'seller-status' });
      message(result.ready ? 'Säljarens grundanslutning är klar. Efter ny anslutning med avgift och fördröjning kan du prova ett nytt köp; PayPal kontrollerar de extra behörigheterna när ordern skapas.' : 'Säljaren är inte klar. Slutför onboarding och bekräfta e-post i PayPal sandbox.');
    } catch (error) { message(error.message, true); }
    finally { $('sandbox-seller-check').disabled = false; }
  });
  $('sandbox-release').addEventListener('click', async () => {
    if (busy || !attempt?.orderId || $('sandbox-release').disabled) return;
    if (!confirm('Frigör testbetalningen till sandbox-säljaren? Kontrollera först att pengarna hålls hos PayPal.')) return;
    busy = true; $('sandbox-release').disabled = true;
    message('Begär frigörande hos PayPal …');
    try { showResult(await api({ action: 'release', orderId: attempt.orderId, confirm: true })); }
    catch (error) { message(`${error.message} Välj Kontrollera betalningen och stäm av i PayPal sandbox. Skicka inget nytt frigörande.`, true); }
    finally { busy = false; }
  });
  $('sandbox-logout').addEventListener('click', async () => {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) { message('Utloggningen misslyckades. Försök igen.', true); return; }
    location.reload();
  });
  $('sandbox-check').addEventListener('click', async () => {
    if (busy) return;
    busy = true; $('sandbox-check').disabled = true;
    try { await check(); } catch (error) { message(error.message, true); }
    finally { busy = false; $('sandbox-check').disabled = !attempt?.orderId; }
  });
  $('sandbox-new').addEventListener('click', () => {
    if (!confirm('Kontrollera först föregående test i PayPal sandbox om resultatet är oklart. Starta ett nytt test?')) return;
    localStorage.removeItem(storageKey); location.reload();
  });
  try {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) await startSession(data.session);
    else message('Logga in med ditt Passiton-testkonto för att börja.');
  } catch (error) { message(error.message || 'Testmiljön kunde inte startas.', true); }
})();
