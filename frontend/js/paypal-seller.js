(() => {
  const { url, publishableKey } = window.PASSITON_SUPABASE_CONFIG;
  const client = window.supabase.createClient(url, publishableKey);
  const connect = document.getElementById('connect');
  const verify = document.getElementById('verify');
  const link = document.getElementById('referral');
  const status = document.getElementById('status');
  async function run(action) {
    connect.disabled = verify.disabled = true;
    link.hidden = true;
    status.textContent = 'Kontaktar PayPal …';
    try {
      const { data } = await client.auth.getSession();
      if (!data.session) throw Error('Logga in som säljare i PassItOn och kom tillbaka hit.');
      const response = await fetch(url + '/functions/v1/paypal-sandbox', {
        method: 'POST',
        headers: { apikey: publishableKey, Authorization: 'Bearer ' + data.session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, consent: action === 'link-seller' })
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Förfrågan misslyckades.');
      if (action === 'link-seller') {
        link.href = result.actionUrl;
        link.hidden = false;
        status.textContent = 'Öppna länken, godkänn i PayPal och återvänd hit för att spara kopplingen.';
      } else {
        status.textContent = result.ready ? 'Säljarkopplingen är verifierad och sparad.' : 'Slutför anslutningen i PayPal och kontrollera igen.';
      }
    } catch (error) { status.textContent = error.message; }
    finally { connect.disabled = verify.disabled = false; }
  }
  connect.onclick = () => run('link-seller');
  verify.onclick = () => run('verify-seller');
})();
