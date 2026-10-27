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
      <p class="lm-proof-code">Förväntad kod i fotot: <strong>${safe(row.proof_code)}</strong></p>
      <p class="lm-warning">Jämför kod, datum/klockslag och saldo med bilden. Ett foto bevisar inte att saldot faktiskt finns eller att koden är oanvänd.</p>
      <div class="lm-buttons">
        <button class="secondary-cta lm-small" data-lm-proof="${safe(row.listing_id)}">Visa privat fotobevis</button>
        <button class="primary-cta lm-small" data-lm-decision="approved">Godkänn foto</button>
        <button class="secondary-cta lm-small lm-danger" data-lm-decision="rejected">Avslå</button>
      </div><img class="lm-proof-image" alt="Privat fotobevis för granskning" hidden></article>`;
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
          .select('id,brand,value,price,expires_on,status,photo_review_status,photo_review_reason,created_at')
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
    root.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
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

  root.addEventListener('click', async (event) => {
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
      } catch (error) {
        console.error('Proof image could not be opened', error);
        note('Fotot kunde inte öppnas. Kontrollera Storage-policyn.', true, adminStatus);
      } finally { control.disabled = false; }
      return;
    }
    const decision = control.dataset.lmDecision;
    if (!['approved', 'rejected'].includes(decision)) return;
    const reason = decision === 'rejected'
      ? window.prompt('Ange varför fotot avslås (minst 10 tecken). Skicka aldrig med själva presentkortskoden här.')
      : null;
    if (decision === 'rejected' && (reason === null || reason.trim().length < 10)) {
      if (reason !== null) note('Ange minst 10 tecken som förklaring.', true, adminStatus);
      return;
    }
    if (decision === 'approved' && !window.confirm('Har du kontrollerat engångskoden, saldot och datumet på fotot? Godkänn endast fotobeviset, inte kortets giltighet.')) return;
    await mutate(async () => {
      await rpc('admin_review_listing', {
        p_listing_id: id, p_decision: decision, p_reason: reason
      });
      page = 0;
    }, adminStatus);
  });

  // The page is a classic multi-view SPA; the existing dashboard calls this hook.
  window.passitonListingManagement = { refresh };
  if (authClient) {
    authClient.auth.onAuthStateChange(() => queueMicrotask(refresh));
    authClient.auth.getSession().then(() => queueMicrotask(refresh)).catch(() => {});
  }
})();
