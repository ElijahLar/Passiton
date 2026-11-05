/* Mitt PassitOn dashboard hub: reuses the existing sections rather than cloning their controls. */
(() => {
  'use strict';
  const dialog = document.getElementById('hub-dialog');
  const body = document.getElementById('hub-dialog-body');
  const store = document.getElementById('hub-content-store');
  const grid = document.querySelector('.hub-grid');
  if (!dialog || !body || !store || !grid) return;

  const panels = {
    commerce: document.getElementById('hub-commerce'),
    offers: document.getElementById('price-offers-panel'),
    saved: document.getElementById('hub-saved'),
    admin: document.getElementById('lm-admin-panel'),
    orders: document.getElementById('disputes')
  };
  const details = {
    commerce: ['Ditt konto', 'Köp och försäljning', 'Din köphistorik och dina egna annonser.'],
    offers: ['Förhandla tryggt', 'Mina prisförslag', 'Skickade och mottagna bud samt överenskomna priser.'],
    saved: ['Dina favoriter', 'Sparade annonser', 'Presentkort som du valt att spara för senare.'],
    admin: ['Endast administratörer', 'Granska inkomna annonser', 'Granska inkomna fotobevis och fatta beslut.'],
    orders: ['PassitOn Trygg Affär', 'Order och dispyter', 'Orderhistorik och eventuella ärenden.']
  };
  const originalOrdersParent = panels.orders.parentElement;
  const originalOrdersNext = panels.orders.nextSibling;
  let activeKey = null;
  let isAdmin = false;
  let adminUser = null;
  let adminRequest = 0;
  let adminChecked = false;
  let previousFocus = null;

  // Live listings are stored privately in Supabase; sample cards remain local-only.
  let savedIds = new Set();
  let savedLoadedFor = null;
  let savedRequest = 0;
  let savedLoading = false;
  let savingIds = new Set();
  function storageKey() {
    return 'passiton-saved:' + (state.user?.id || 'guest');
  }
  function getLocalDemoSaved() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey()) || '[]');
      return Array.isArray(data)
        ? data.filter(id => typeof id === 'string' && !id.startsWith('listing-')).slice(0, 250)
        : [];
    } catch { return []; }
  }
  function isLiveId(id) {
    return /^listing-[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(id));
  }
  function getSaved() {
    return [...savedIds, ...getLocalDemoSaved()];
  }
  function isSaved(id) { return getSaved().includes(String(id)); }
  async function loadSaved() {
    const userId = state.user?.id;
    const request = ++savedRequest;
    savedLoading = true;
    if (!userId || !authClient) {
      savedLoading = false;
      savedIds = new Set();
      savedLoadedFor = null;
      syncHeartButtons();
      if (activeKey === 'saved') renderSaved();
      return;
    }
    try {
      const {data,error} = await authClient.from('saved_listings')
        .select('listing_id').eq('user_id',userId).order('created_at',{ascending:false}).limit(250);
      if (error) throw error;
      if (request !== savedRequest || state.user?.id !== userId) return;
      savedIds = new Set((data || []).map(row => 'listing-' + row.listing_id));
      savedLoadedFor = userId;
      syncHeartButtons();
      if (activeKey === 'saved') renderSaved();
    } catch(error) {
      if (request !== savedRequest || state.user?.id !== userId) return;
      savedLoadedFor = null;
      console.warn('Saved listings unavailable; run the saved_listings SQL migration', error);
      if (activeKey === 'saved') renderSaved('Sparade annonser kunde inte hämtas. Kontrollera att Supabase-migreringen är installerad.');
    } finally { if (request === savedRequest) savedLoading = false; }
  }
  async function toggleSaved(id) {
    if (!state.user || !authClient) {
      toast('Logga in på Mitt PassitOn för att spara annonser.');
      navTo('dashboard');
      return;
    }
    const key = String(id);
    if (savingIds.has(key)) return;
    if (!isLiveId(key)) {
      const current = getLocalDemoSaved();
      const selected = current.includes(key) ? current.filter(x => x !== key) : [...current, key];
      localStorage.setItem(storageKey(), JSON.stringify(selected.slice(-250)));
      syncHeartButtons();
      if (activeKey === 'saved') renderSaved();
      toast(selected.includes(key) ? 'Demokortet sparades lokalt.' : 'Demokortet togs bort.');
      return;
    }
    if (savedLoadedFor !== state.user.id) {
      toast('Dina sparade annonser laddas. Försök igen strax.');
      await loadSaved();
      return;
    }
    const userId = state.user.id;
    const uuid = key.slice('listing-'.length);
    const wasSaved = savedIds.has(key);
    savingIds.add(key);
    try {
      const result = wasSaved
        ? await authClient.from('saved_listings').delete().eq('user_id',userId).eq('listing_id',uuid)
        : await authClient.from('saved_listings').insert({user_id:userId,listing_id:uuid});
      if (result.error) throw result.error;
      if (state.user?.id !== userId) return;
      if (wasSaved) savedIds.delete(key); else savedIds.add(key);
      syncHeartButtons();
      if (activeKey === 'saved') renderSaved();
      toast(wasSaved ? 'Annonsen togs bort från sparade.' : 'Annonsen sparades.');
    } catch(error) {
      console.error('Could not save listing',error);
      toast('Kunde inte spara. Kontrollera Supabase-anslutningen och försök igen.');
    } finally {
      savingIds.delete(key);
    }
  }
  function syncHeartButtons() {
    document.querySelectorAll('[data-save-id]').forEach(button => {
      const saved = isSaved(button.dataset.saveId);
      button.textContent = saved ? '♥' : '♡';
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', saved ? 'Ta bort sparad annons' : 'Spara annons');
      button.title = saved ? 'Ta bort från sparade' : 'Spara annons';
    });
  }
  function renderSaved(errorMessage = '') {
    const saved = getSaved();
    document.getElementById('hub-saved-total').textContent = saved.length + (saved.length === 1 ? ' sparad' : ' sparade');
    const container = document.getElementById('hub-saved-list');
    container.replaceChildren();
    if (errorMessage) {
      const note = document.createElement('p');
      note.className = 'hub-empty';
      note.textContent = errorMessage;
      container.append(note);
      return;
    }
    if (!saved.length) {
      container.innerHTML = '<p class="hub-empty">Inga sparade annonser ännu. Klicka på hjärtat på ett presentkort för att lägga till det här.</p>';
      return;
    }
    saved.forEach(id => {
      const card = findProductCard(id);
      const item = document.createElement('article');
      item.className = 'hub-saved-item';
      if (!card) {
        item.innerHTML = '<div class="hub-saved-brand">—</div><div><strong>Annons ej tillgänglig</strong><small>Den kan ha tagits bort eller sålts.</small></div>';
      } else {
        const brand = document.createElement('div');
        brand.className = 'hub-saved-brand';
        brand.textContent = card.brand;
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = card.brand + ' presentkort';
        const subtitle = document.createElement('small');
        subtitle.textContent = money(card.price) + ' · Värde ' + money(card.value);
        info.append(title, subtitle);
        item.append(brand, info);
      }
      const controls = document.createElement('div');
      controls.className = 'hub-saved-item-actions';
      if (card) {
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Visa annons';
        open.addEventListener('click', () => { close(); openProduct(id); });
        controls.append(open);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Ta bort';
      remove.addEventListener('click', () => toggleSaved(id));
      controls.append(remove);
      item.append(controls);
      container.append(item);
    });
  }
  function restorePanel() {
    if (!activeKey) return;
    const panel = panels[activeKey];
    if (activeKey === 'orders') {
      originalOrdersParent.insertBefore(panel, originalOrdersNext);
      panel.classList.remove('active');
    } else store.append(panel);
    activeKey = null;
    body.replaceChildren();
  }
  function close() {
    if (dialog.open) dialog.close();
    restorePanel();
    previousFocus?.focus?.();
    previousFocus = null;
  }
  function open(key) {
    if (!Object.hasOwn(panels, key) || !state.user) {
      if (!state.user) navTo('dashboard');
      return;
    }
    if (key === 'admin' && !isAdmin) return;
    if (activeKey === key) return;
    if (activeKey) restorePanel();
    previousFocus = document.activeElement;
    activeKey = key;
    const [kicker,title,description] = details[key];
    document.getElementById('hub-dialog-kicker').textContent = kicker;
    document.getElementById('hub-dialog-title').textContent = title;
    document.getElementById('hub-dialog-description').textContent = description;
    body.append(panels[key]);
    if (key === 'saved') renderSaved();
    if (key === 'orders') {
      panels.orders.classList.add('active');
      window.passitonLoadDisputes?.();
    }
    if (key === 'offers') window.passitonPriceOffers?.refresh();
    if (key === 'commerce' || key === 'admin') window.passitonListingManagement?.refresh();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    document.getElementById('hub-dialog-close').focus();
  }
  function showAdminCard() {
    const card = grid.querySelector('[data-hub-open="admin"]');
    const orders = grid.querySelector('[data-hub-open="orders"]');
    card?.classList.toggle('hidden', !(isAdmin && state.user?.id === adminUser));
    orders?.classList.toggle('hub-card-orders-reflow', !isAdmin);
  }
  async function refreshAdmin() {
    const userId = state.user?.id || null;
    if (userId !== adminUser) {
      adminUser = userId;
      isAdmin = false;
      adminChecked = false;
      ++adminRequest; // Discard responses belonging to an earlier account.
      showAdminCard();
      if (activeKey === 'admin') close();
    }
    if (!userId || !authClient || adminChecked) return;
    // Allow a later dashboard refresh to retry a failed permission lookup.
    // Avoid duplicate concurrent checks (renderDashboard also calls refresh).
    const request = ++adminRequest;
    adminChecked = true;
    try {
      const {data:authData,error:authError} = await authClient.auth.getUser();
      if (authError || authData?.user?.id !== userId) throw authError || new Error('Authenticated user changed');
      const {data,error} = await authClient.rpc('is_passiton_admin');
      if (error) throw error;
      if (request !== adminRequest || state.user?.id !== userId) return;
      isAdmin = data === true;
      showAdminCard();
    } catch(error) {
      if (request !== adminRequest || state.user?.id !== userId) return;
      adminChecked = false;
      isAdmin = false;
      showAdminCard();
      console.warn('Could not check administrator status', error);
    }
  }
  function onAuthChange() {
    if (!state.user && activeKey) close();
    const userId = state.user?.id || null;
    if (savedLoadedFor !== userId) {
      savedLoadedFor = null;
      savedIds = new Set();
      if (userId && !savedLoading) loadSaved();
      else { ++savedRequest; savedLoading = false; syncHeartButtons(); }
    }
    refreshAdmin();
    if (activeKey === 'saved') renderSaved();
  }
  function refresh() {
    syncHeartButtons();
    refreshAdmin();
    if (state.user && savedLoadedFor !== state.user.id && !savedLoading) loadSaved();
    if (activeKey === 'saved') renderSaved();
  }
  grid.addEventListener('click', e => {
    const button = e.target.closest('[data-hub-open]');
    if (button) open(button.dataset.hubOpen);
  });
  document.getElementById('hub-dialog-close').addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => {
    if (activeKey) restorePanel();
    previousFocus?.focus?.();
    previousFocus = null;
  });
  window.passitonHub = {open, close, refresh, onAuthChange, toggleSaved, isSaved, syncHeartButtons};
  onAuthChange();
  // app.js creates the market before this module is loaded.
  if (typeof renderMarket === 'function') renderMarket();
})();
