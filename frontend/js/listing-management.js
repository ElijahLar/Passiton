/* IP-01: seller listing management and private administrator photo review.
 * API permissions and state transitions are enforced by PostgreSQL RPCs.
 * Never expose stored gift-card codes in browser or admin review payloads.
 */
(() => {
  'use strict';
  const root = document.getElementById('listing-management');
  if (!root) return;
  const ownList = document.getElementById('lm-own-list');
  const adminPanel = document.getElementById('lm-admin-panel');
  const adminList = document.getElementById('lm-admin-list');
  const status = document.getElementById('lm-status');
  const adminStatus = document.getElementById('lm-admin-status');
  const pageLabel = document.getElementById('lm-page');
  const prev = document.getElementById('lm-prev');
  const next = document.getElementById('lm-next');
  const PAGE_SIZE = 25;
  const rows = { seller: [], queue: [] };
  let admin = false;
  let page = 0;
  let requestId = 0;
  let busy = false;

  const safe = (v) => escapeHTML(String(v ?? ''));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const errorText = (error) => {
    const m = String(error?.message ?? '');
    if (/unsettled order/i.test(m)) return 'Annonsen har en pågående order. Avsluta ordern innan du ändrar annonsen.';
    if (/access denied|admin access|required|permission/i.test(m)) return 'Du saknar behörighet för den här åtgärden.';
    if (/expired|unexpired/i.test(m)) return 'Presentkortet har gått ut och kan inte återaktiveras.';
    if (/rejected|awaiting review|cannot be edited/i.test(m)) return 'Annonsen kan inte ändras i nuvarande granskningsstatus.';
    if (/rate|too many/i.test(m)) return 'För många ändringar. Försök igen senare.';
    return 'Åtgärden kunde inte genomföras. Uppdatera sidan och försök igen.';
  };
  const note = (message, isError = false, target = status) => {
    target.textContent = message;
    target.dataset.tone = isError ? 'error' : 'success';
  };
  const labelStatus = (row) => {
    if (row.status === 'removed') return 'Borttagen';
    if (row.status === 'sold') return 'Såld';
    if (row.expires_on < today()) return 'Utgången';
    if (row.status === 'paused') return 'Pausad';
    if (row.balance_status === 'supplement') return 'Komplettering krävs – skicka en ny annons med nytt foto';
    if (row.balance_status === 'expired') return 'Väntar på ny saldokontroll';
    if (row.photo_review_status === 'pending') return 'Väntar på granskning';
    if (row.photo_review_status === 'rejected') return 'Underkänd';
    return 'Aktiv';
  };
  const rpc = async (fn, args) => {
    const { data, error } = await authClient.rpc(fn, args);
    if (error) throw error;
    return data;
  };

  function sellerHTML(row) {
    const expired = row.expires_on < today();
    const editable = ['active', 'paused'].includes(row.status)
      && row.photo_review_status !== 'rejected' && !expired;
    const removable = ['active', 'paused'].includes(row.status);
    const resume = row.status === 'paused' && ['pending', 'approved'].includes(row.photo_review_status) && !expired;
    const action = row.status === 'active'
      ? '<button class="secondary-cta lm-small" data-lm-action="pause">Pausa</button>'
      : resume ? '<button class="secondary-cta lm-small" data-lm-action="resume">Återaktivera</button>' : '';
    const reason = row.photo_review_status === 'rejected' && row.photo_review_reason
      ? `<p class="lm-reason">Orsak: ${safe(row.photo_review_reason)}</p>` : '';
    return `<article class="lm-item" data-lm-id="${safe(row.id)}">
      <div class="lm-row"><div><strong>${safe(row.brand)} presentkort</strong>
      <p>Värde ${money(Number(row.value))} · Giltigt till ${safe(row.expires_on)}</p>
      ${reason}</div><span class="lm-tag">${labelStatus(row)}</span></div>
      ${row.status === 'paused' && row.photo_review_status === 'pending'
        ? '<p class="lm-review-pause-note">Fotogranskningen är pausad. Återaktivera för att fortsätta granskningen.</p>'
        : ''}
      <div class="lm-row lm-controls"><label>Försäljningspris (kr)
        <input class="lm-price" aria-label="Pris för ${safe(row.brand)}" type="number" min="1" step="0.01"
          max="${Number(row.value)}" value="${Number(row.price)}" ${editable ? '' : 'disabled'}>
      </label><div class="lm-buttons">
        ${editable ? '<button class="secondary-cta lm-small" data-lm-action="price">Spara pris</button>' : ''}
        ${action}
        ${removable ? '<button class="secondary-cta lm-small lm-danger" data-lm-action="remove">Ta bort</button>' : ''}
      </div></div></article>`;
  }
  function renderSeller() {
    ownList.innerHTML = rows.seller.length
      ? rows.seller.map(sellerHTML).join('')
      : '<p class="lm-empty">Du har inga annonser ännu.</p>';
  }
  function adminHTML(row) {
    return `<article class="lm-item" data-lm-review-id="${safe(row.listing_id)}">
      <div class="lm-row"><div><strong>${safe(row.brand)} presentkort</strong>
        <p>Värde ${money(Number(row.face_value))} · Pris ${money(Number(row.asking_price))}</p>
        <p>Inskickad ${new Date(row.submitted_at).toLocaleString('sv-SE')} · Giltigt till ${safe(row.expires_on)}</p>
      </div><span class="lm-tag">Väntar</span></div>
      <p>${safe(row.category)} · Säljarkonto ${safe(row.seller)}</p>
      <p>${safe((row.risks||[]).join(' · '))}</p>
      <p class="lm-proof-code">Förväntad kod i fotot: <strong>${safe(row.proof_code)}</strong></p>
      <p class="lm-warning">Jämför kod, datum/klockslag och saldo med bilden. Ett foto bevisar inte att saldot faktiskt finns eller att koden är oanvänd.</p>
      <p>${safe(row.method)} ${safe(row.notes)}</p>
      ${row.balance_url ? `<a href="${safe(row.balance_url)}" target="_blank" rel="noopener noreferrer">Öppna officiell saldokontroll</a>` : 'Företaget saknar kontrollsida.'}
      <div class="lm-check-fields"><button type="button" data-show-code>Visa kod och PIN för kontroll</button>
      <label>Resultat<select name="result"><option value="unavailable">Kunde inte genomföras</option><option value="passed">Godkänd</option><option value="failed">Misslyckad</option></select></label>
      <label>Kontrollerat saldo (kr)<input name="amount" type="number" min="0" step="0.01"></label>
      <label>Verifierad giltighetstid, om tillgänglig<input name="expiry" type="date"></label>
      <label><input type="checkbox" name="block">Spärra koden vid dokumenterat bedrägeri (kräver avslag)</label>
      <label>Intern kommentar (utelämna kod och PIN)<textarea name="comment" maxlength="500"></textarea></label>
      ${['Fotot och engångskoden stämmer','Företag och korttyp är godkända','Koden och eventuell PIN fungerar','Saldot motsvarar annonsens värde','Giltigheten kontrollerad där det är möjligt','Ingen blockerande risk eller dubblett'].map(label=>`<label><input type="checkbox" name="check"> ${label}</label>`).join('')}
      </div><div class="lm-buttons">
        <button class="secondary-cta lm-small" data-lm-proof="${safe(row.listing_id)}" ${row.photo_path ? '' : 'disabled'}>Visa privat fotobevis</button>
        <button class="primary-cta lm-small" data-lm-decision="approved">Godkänn annons</button>
        <button class="secondary-cta lm-small" data-lm-decision="supplement">Begär komplettering</button>
        <button class="secondary-cta lm-small lm-danger" data-lm-decision="rejected">Avslå</button>
      </div><a data-enlarge hidden target="_blank" rel="noopener noreferrer">Öppna fotot i full storlek</a><img class="lm-proof-image" alt="Privat fotobevis för granskning" hidden></article>`;
  }
  function renderAdmin() {
    adminPanel.classList.toggle('hidden', !admin);
    if (!admin) {
      adminList.replaceChildren();
      return;
    }
    adminList.innerHTML = rows.queue.length
      ? rows.queue.map(adminHTML).join('')
      : '<p class="lm-empty">Inga fotobevis väntar på granskning på den här sidan.</p>';
    pageLabel.textContent = `Sida ${page + 1}`;
    prev.disabled = busy || page === 0;
    next.disabled = busy || rows.queue.length < PAGE_SIZE;
  }

  async function refresh() {
    const current = ++requestId;
    const userId = state.user?.id;
    if (!userId || !authClient) {
      rows.seller = []; rows.queue = []; admin = false;
      note('', false); note('', false, adminStatus);
      renderSeller(); renderAdmin();
      root.classList.add('hidden');
      return;
    }
    root.classList.remove('hidden');
    try {
      const [mine, canAdmin] = await Promise.all([
        authClient.from('gift_card_listings')
          .select('id,brand,value,price,expires_on,status,photo_review_status,photo_review_reason,balance_status,created_at')
          .eq('seller_id', userId).order('created_at', { ascending: false }).limit(200),
        rpc('is_passiton_admin', {})
      ]);
      if (mine.error) throw mine.error;
      if (current !== requestId || state.user?.id !== userId) return;
      rows.seller = mine.data || [];
      admin = canAdmin === true;
      renderSeller();
      if (admin) await refreshQueue(current, userId);
      else { rows.queue = []; renderAdmin(); }
    } catch (error) {
      if (current !== requestId) return;
      console.error('Listing management could not load', error);
      note('Annonshanteringen kunde inte laddas. Kontrollera att IP-01-migreringen är installerad.', true);
      rows.seller = []; rows.queue = []; admin = false;
      renderSeller(); renderAdmin();
    }
  }
  async function refreshQueue(current = requestId, userId = state.user?.id) {
    const queue = await rpc('admin_listing_review_queue', {
      p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE
    });
    if (current !== requestId || state.user?.id !== userId) return;
    rows.queue = queue || [];
    renderAdmin();
  }
  async function mutate(work, target) {
    if (busy) return;
    busy = true;
    [root, adminPanel].forEach(panel => panel.querySelectorAll('button, input').forEach(b => { b.disabled = true; }));
    try {
      await work();
      note('Ändringen har sparats.', false, target);
      // Keep marketplace cards and the existing seller dashboard in sync.
      try { await refreshMarketplaceListings(); }
      catch (error) { console.warn('Marketplace refresh failed', error); }
      await refresh();
    } catch (error) {
      console.error('Listing action failed', error);
      note(errorText(error), true, target);
    } finally {
      busy = false;
      // Re-render after failure as well; leaves no stale disabled controls.
      renderSeller(); renderAdmin();
    }
  }

  const handleClick = async (event) => {
    const control = event.target.closest('button');
    if (!control || busy) return;
    if (control.id === 'lm-prev' || control.id === 'lm-next') {
      page = Math.max(0, page + (control.id === 'lm-next' ? 1 : -1));
      try { await refreshQueue(); } catch (e) { note(errorText(e), true, adminStatus); }
      return;
    }
    const sellerArticle = control.closest('[data-lm-id]');
    if (sellerArticle && control.dataset.lmAction) {
      const id = sellerArticle.dataset.lmId;
      const action = control.dataset.lmAction;
      const row = rows.seller.find(x => x.id === id);
      if (!row) return;
      if (action === 'remove' && !window.confirm('Ta bort annonsen permanent från marknadsplatsen?')) return;
      const input = sellerArticle.querySelector('.lm-price');
      const price = action === 'price' ? Number(input.value) : null;
      if (action === 'price' && (!input.value || !Number.isFinite(price)
        || price <= 0 || price >= Number(row.value) || Math.abs(price * 100 - Math.round(price * 100)) > 1e-6)) {
        note('Ange ett giltigt pris under presentkortets värde (högst två decimaler).', true);
        return;
      }
      await mutate(() => rpc('manage_own_listing', {
        p_listing_id: id, p_action: action, p_price: price
      }), status);
      return;
    }
    const reviewArticle = control.closest('[data-lm-review-id]');
    if (!admin || !reviewArticle) return;
    const id = reviewArticle.dataset.lmReviewId;
    const row = rows.queue.find(x => x.listing_id === id);
    if (!row) return;
    if (control.dataset.lmProof) {
      try {
        control.disabled = true;
        const { data, error } = await authClient.storage.from('passiton-photo-proofs')
          .createSignedUrl(row.photo_path, 60);
        if (error) throw error;
        if (!admin || !state.user) return;
        const img = reviewArticle.querySelector('.lm-proof-image');
        img.src = data.signedUrl;
        img.hidden = false;
        const enlarge = reviewArticle.querySelector('[data-enlarge]');
        enlarge.href=data.signedUrl;
        enlarge.hidden=false;
      } catch (error) {
        console.error('Proof image could not be opened', error);
        note('Fotot kunde inte öppnas. Kontrollera Storage-policyn.', true, adminStatus);
      } finally { control.disabled = false; }
      return;
    }
    if (control.hasAttribute?.('data-show-code')) {
      const userId = state.user?.id;
      try {
        const data = await rpc('review_credentials',{p_listing:id});
        if (userId && state.user?.id===userId && reviewArticle.isConnected)
          window.alert(`Presentkortskod: ${data.code}${data.pin ? '\nPIN: '+data.pin : ''}`);
      } catch { note('Uppgifterna kunde inte öppnas.',true,adminStatus); }
      return;
    }
    const decision = control.dataset.lmDecision;
    if (!['approved', 'rejected', 'supplement'].includes(decision)) return;
    const reason = decision !== 'approved'
      ? window.prompt('Ange vad säljaren behöver åtgärda (minst 10 tecken). Skicka aldrig med själva presentkortskoden här.')
      : null;
    if (decision !== 'approved' && (reason === null || reason.trim().length < 10)) {
      if (reason !== null) note('Ange minst 10 tecken som förklaring.', true, adminStatus);
      return;
    }
    const field = name => reviewArticle.querySelector(`[name="${name}"]`).value;
    const checks = [...reviewArticle.querySelectorAll('[name="check"]')].map(input=>input.checked);
    const amount = field('amount');
    if (decision==='approved' && (checks.includes(false) || field('result')!=='passed' || !amount || Number(amount)!==Number(row.face_value))) {
      note('Fyll i kontrollen och stäm av samtliga sex punkter.',true,adminStatus);return;
    }
    await mutate(async () => {
      await rpc('review_card', {
        p_listing:id,p_decision:decision,p_reason:reason,p_block:reviewArticle.querySelector('[name="block"]').checked===true,p_checks:checks,p_result:field('result'),
        p_amount:amount===''?null:Number(amount),p_expiry:field('expiry')||null,p_comment:field('comment')||null
      });
      page = 0;
    }, adminStatus);
  };
  // The two panels are siblings, so both need to receive their own click events.
  root.addEventListener('click', handleClick);
  adminPanel.addEventListener('click', handleClick);

  // The page is a classic multi-view SPA; the existing dashboard calls this hook.
  window.passitonListingManagement = { refresh };
  if (authClient) {
    authClient.auth.onAuthStateChange(() => queueMicrotask(refresh));
    authClient.auth.getSession().then(() => queueMicrotask(refresh)).catch(() => {});
  }
})();

(() => {
  const panel=document.querySelector?.('#verification-config');
  if (!panel) return;
  const form=panel.querySelector('form');
  const fields=form.elements;
  const status=panel.querySelector('[role=status]');
  let brands=[];
  function showBrand() {
    const brand=brands.find(row=>row.name===fields.brand.value);
    if (!brand) return;
    for (const [name,value] of Object.entries(brand)) {
      const field=fields.namedItem(name);
      if (!field) continue;
      if (field.type==='checkbox') field.checked=value;
      else field.value=value??'';
    }
  }
  const clear = () => {
    brands=[]; fields.brand.replaceChildren(); form.reset(); status.textContent='';
    panel.open=false;
  };
  if(authClient) authClient.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_OUT' || event==='SIGNED_IN') clear();
  });
  panel.addEventListener('toggle',async()=>{
    if (!panel.open) return;
    const userId=state.user?.id;
    const {data,error}=await authClient.rpc('verification_admin_config');
    if(!userId || userId!==state.user?.id || !panel.open)return;
    if(error){status.textContent='Kunde inte läsa företagsregistret.';return;}
    brands=data.brands; fields.days.value=data.days;
    fields.brand.replaceChildren(...brands.map(b=>new Option(b.name,b.name)));
    showBrand();
  });
  fields.brand.addEventListener('change',showBrand);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const config=Object.fromEntries(new FormData(form));
    for (const name of ['digital','pin_required','ignore_spaces','ignore_hyphens']) config[name]=fields[name].checked;
    try { new RegExp(config.code_pattern); new RegExp(config.pin_pattern); }
    catch {status.textContent='Ange giltiga reguljära uttryck för kod och PIN.';return;}
    if(config.status==='active' && !window.confirm('Har du verifierat den officiella kontrollmetoden och att kortet kan lösas in digitalt med kod och eventuell PIN?'))return;
    const {error}=await authClient.rpc('save_verification_brand',{p_brand:fields.brand.value,p_days:Number(fields.days.value),p_data:config});
    status.textContent=error?'Kontrollera uppgifterna och försök igen.':'Reglerna har sparats.';
    if(!error){
      Object.assign(brands.find(b=>b.name===fields.brand.value),config);
      await loadVerifiedBrands();
      await window.passitonListingManagement.refresh();
    }
  });
})();
