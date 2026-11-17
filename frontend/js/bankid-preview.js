(function () {
  'use strict';
  const config = window.PASSITON_BANKID_PREVIEW;
  if (!config) return;

  const panel = document.querySelector('#bankid-preview');
  const status = panel.querySelector('[role=status]');
  const start = document.querySelector('#bankid-preview-start');
  const openApp = document.querySelector('#bankid-preview-app');
  const cancel = document.querySelector('#bankid-preview-cancel');
  const qr = document.querySelector('#bankid-preview-qr');
  const layout = document.querySelector('.sell-layout');
  const messages = {
    outstandingTransaction: 'Skanna QR-koden med BankID-appen i testläge eller öppna appen på den här enheten.',
    noClient: 'Öppna BankID-appen i testläge och skanna QR-koden.',
    started: 'Fortsätt i BankID-appen.',
    userSign: 'Bekräfta identifieringen i BankID-appen.',
    expiredTransaction: 'Tiden gick ut. Starta ett nytt försök.',
    certificateErr: 'BankID kunde inte användas. Kontrollera att du använder ett test-BankID.',
    userCancel: 'Du avbröt identifieringen i BankID-appen.',
    cancelled: 'Identifieringen avbröts. Du kan starta ett nytt försök.',
    startFailed: 'Appen startade inte i tid. Öppna testappen innan du skannar nästa QR-kod.'
  };

  let account;
  let authClient;
  let result = { status: 'idle' };
  let timer;
  let busy = false;
  let retry = false;
  let generation = 0;

  const render = (message) => {
    const permitted = !config.requiresAccount || Boolean(account);
    const pending = result.status === 'pending';
    panel.classList.toggle('hidden', !permitted);
    start.classList.toggle('hidden', (pending && !retry) || result.status === 'complete');
    start.textContent = retry ? 'Fortsätt kontrollera' : 'Starta BankID-test';
    start.disabled = busy;
    cancel.classList.toggle('hidden', !pending);
    cancel.disabled = busy;
    qr.classList.toggle('hidden', !pending || !result.qr || retry);
    if (pending && result.qr && !retry) qr.src = result.qr;
    else qr.removeAttribute('src');

    const token = pending && !retry ? result.autoStartToken : null;
    openApp.classList.toggle('hidden', !token);
    if (token) {
      const scheme = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ?
        'https://app.bankid.com/' : 'bankid:///';
      openApp.href = scheme + '?autostarttoken=' + encodeURIComponent(token);
    } else {
      openApp.removeAttribute('href');
    }

    const text = message ?? (result.status === 'complete' ?
      'BankID-testet lyckades. Testidentifieringen är klar.' :
      result.delayed ? 'BankID svarar långsamt. Vi fortsätter att kontrollera.' :
      messages[result.hintCode] ?? (pending ? messages.outstandingTransaction :
        result.status === 'failed' ? 'Identifieringen misslyckades. Försök igen.' :
          'Använd ett test-BankID. På en dator kan du skanna QR-koden med en testtelefon.'));
    if (status.textContent !== text) status.textContent = text;
  };

  function schedulePoll() {
    clearTimeout(timer);
    if (!document.hidden && result.status === 'pending' && !retry) {
      timer = setTimeout(() => void run('poll'), 1000);
    }
  }

  async function run(action) {
    if (busy || (config.requiresAccount && !account)) return;
    clearTimeout(timer);
    const requestGeneration = generation;
    busy = true;
    const headers = {};
    if (action === 'start') render('Startar identifiering …');
    if (action === 'cancel') render('Avbryter identifiering …');
    try {
      if (config.requiresAccount) {
        const { data } = await authClient.auth.getSession();
        if (data?.session?.user?.id !== account) throw new Error('signInRequired');
        headers.Authorization = 'Bearer ' + data.session.access_token;
      }
      if (requestGeneration !== generation) return;
      const response = await fetch('/api/bankid/' + action, { method: 'POST', headers, cache: 'no-store' });
      const payload = await response.json();
      if (requestGeneration !== generation) return;
      if (!response.ok) throw new Error(payload.error);
      retry = false;
      const wasVerified = Boolean(result.verifiedAt);
      if (payload.status !== 'busy') result = payload;
      if (wasVerified !== Boolean(result.verifiedAt)) renderAccountState();
      render(action === 'cancel' && result.status === 'idle' ? 'Identifieringen avbröts.' : undefined);
    } catch (error) {
      if (requestGeneration !== generation) return;
      retry = result.status === 'pending';
      render(error.message === 'signInRequired' ? 'Logga in på testkontot igen.' :
        'Det gick inte att nå BankID-testet. Kontrollera att förhandsvisningen körs och försök igen.');
    } finally {
      if (requestGeneration === generation) {
        busy = false;
        start.disabled = false;
        cancel.disabled = false;
        schedulePoll();
      }
    }
  }

  start.addEventListener('click', () => void run(retry ? 'poll' : 'start'));
  cancel.addEventListener('click', () => void run('cancel'));
  document.addEventListener('visibilitychange', schedulePoll);

  layout.classList.toggle('hidden', !config.requiresAccount);
  if (!config.requiresAccount) {
    document.querySelector('#sell .section-intro h1').textContent = 'Testa säljarverifiering';
    document.querySelector('#sell .section-intro p').classList.add('hidden');
  }
  document.querySelector('#bankid-preview-scope').textContent = config.requiresAccount ?
    'Verifiera ditt testkonto innan du skickar en testannons.' :
    'Här kan du prova identifieringen. Testet skapar inga annonser eller konton.';

  window.passitonBankIdPreview = {
    openWithoutAccount: !config.requiresAccount,
    canSell: () => Boolean(result.verifiedAt),
    onAccount(user, client) {
      const nextAccount = user?.id ?? null;
      if (nextAccount === account) return;
      account = nextAccount;
      authClient = client;
      generation += 1;
      clearTimeout(timer);
      busy = false;
      retry = false;
      result = { status: 'idle' };
      render();
      if (!config.requiresAccount || account) queueMicrotask(() => void run('status'));
    }
  };
})();
