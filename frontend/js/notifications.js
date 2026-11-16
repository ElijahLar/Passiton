/* NS-01: Notification center and email preferences. No private emails or secrets in the browser. */
(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const categories = ['offers', 'purchases', 'verification', 'cases'];
  const fields = {
    offers: 'email_offers',
    purchases: 'email_purchases',
    verification: 'email_verification',
    cases: 'email_cases',
    saved_price_drop: 'email_saved_price_drop',
    saved_sold: 'email_saved_sold'
  };
  const labels = {
    offers: 'Prisförslag',
    purchases: 'Köp och betalningar',
    verification: 'Verifiering',
    cases: 'Ärenden',
    saved_price_drop: 'Mail vid prissänkning av sparat presentkort',
    saved_sold: 'Mail när ett sparat presentkort har sålts'
  };
  const defaults = () => Object.fromEntries(Object.values(fields).map(field => [field, false]));
  let prefs = defaults();
  let notices = [];
  let activeUser = null;
  let channel = null;
  let currentFilter = 'all';
  let popupVisible = false;
  let refreshTimer = null;
  let preferencesRequest = 0;

  const input = (key, scope) => document.querySelector(`[data-ns-pref="${key}"][data-ns-scope="${scope}"]`);
  const setMessage = (id, msg, error = false) => {
    const node = byId(id);
    if (!node) return;
    node.textContent = msg;
    node.dataset.tone = error ? 'error' : 'success';
  };

  function bindCheckAll(scope) {
    const master = document.querySelector(`[data-ns-all="${scope}"]`);
    if (!master) return;
    const boxes = categories.map(cat => input(cat, scope));
    const sync = () => {
      master.checked = boxes.every(box => box?.checked);
      master.indeterminate = !master.checked && boxes.some(box => box?.checked);
    };
    master.addEventListener('change', () => {
      boxes.forEach(box => { if (box) box.checked = master.checked; });
      sync();
    });
    boxes.forEach(box => box?.addEventListener('change', sync));
    sync();
  }
  function getSignupChoices() {
    return Object.fromEntries(categories.map(cat => [cat, Boolean(input(cat, 'signup')?.checked)]));
  }
  function syncSettings() {
    Object.entries(fields).forEach(([key, field]) => {
      const box = input(key, 'settings');
      if (box) box.checked = Boolean(prefs[field]);
    });
    const master = document.querySelector('[data-ns-all="settings"]');
    if (master) {
      master.checked = categories.every(cat => Boolean(input(cat, 'settings')?.checked));
      master.indeterminate = !master.checked && categories.some(cat => Boolean(input(cat, 'settings')?.checked));
    }
  }
  async function loadPrefs() {
    if (!activeUser || !authClient) return;
    const expected = activeUser;
    const seq = ++preferencesRequest;
    const { data, error } = await authClient.from('notification_preferences')
      .select('*').eq('user_id', expected).maybeSingle();
    if (seq !== preferencesRequest || activeUser !== expected) return;
    if (error) {
      setMessage('ns-prefs-status', 'Mailinställningarna kunde inte hämtas. Kontrollera att NS-01-migreringen är installerad.', true);
      return;
    }
    prefs = { ...defaults(), ...(data || {}) };
    syncSettings();
    setMessage('ns-prefs-status', data ? '' : 'Dina mailval är avstängda tills du aktiverar dem.');
  }
  async function savePrefs(event) {
    event.preventDefault();
    if (!activeUser || !authClient) return;
    const userId = activeUser;
    const payload = { user_id: userId };
    Object.entries(fields).forEach(([key, field]) => { payload[field] = Boolean(input(key, 'settings')?.checked); });
    const save = byId('ns-save-prefs');
    save.disabled = true;
    setMessage('ns-prefs-status', 'Sparar...');
    try {
      const { error } = await authClient.from('notification_preferences').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      if (activeUser === userId) {
        prefs = { ...prefs, ...payload };
        setMessage('ns-prefs-status', 'Dina mailinställningar har sparats.');
      }
    } catch (error) {
      console.warn('Could not update email preferences', error);
      setMessage('ns-prefs-status', 'Kunde inte spara. Försök igen.', true);
    } finally {
      save.disabled = false;
    }
  }
  function relativeTime(date) {
    const delta = Date.now() - Date.parse(date);
    if (!Number.isFinite(delta)) return '';
    if (delta < 60000) return 'Nyss';
    if (delta < 3600000) return Math.floor(delta / 60000) + ' min sedan';
    if (delta < 86400000) return Math.floor(delta / 3600000) + ' tim sedan';
    return new Date(date).toLocaleDateString('sv-SE');
  }
  const icons = { verification: '✓', offer: '↗', dispute: '✉', demo: '▤', saved: '♡' };
  function iconFor(type) {
    return icons[Object.keys(icons).find(key => type?.includes(key))] || '•';
  }
  function noticeNode(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ns-notice' + (item.is_read ? '' : ' ns-unread');
    const symbol = document.createElement('span');
    symbol.className = 'ns-icon';
    symbol.textContent = iconFor(item.type);
    const copy = document.createElement('span');
    copy.className = 'ns-notice-copy';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const description = document.createElement('span');
    description.textContent = item.message;
    const timestamp = document.createElement('small');
    timestamp.textContent = relativeTime(item.created_at);
    copy.append(title, description, timestamp);
    button.append(symbol, copy);
    button.addEventListener('click', () => openNotice(item));
    return button;
  }
  function renderNotices() {
    const count = notices.filter(item => !item.is_read).length;
    const badge = byId('ns-badge');
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', !count);
    byId('ns-bell').setAttribute('aria-label', count ? `Notiser, ${count} olästa` : 'Notiser');
    const dropdownList = byId('ns-dropdown-list');
    const historyList = byId('ns-history-list');
    dropdownList.replaceChildren();
    historyList.replaceChildren();
    if (!notices.length) {
      dropdownList.innerHTML = '<p class="ns-empty">Du har inga notiser ännu.</p>';
    } else {
      notices.slice(0, 6).forEach(item => dropdownList.append(noticeNode(item)));
    }
    const filtered = notices.filter(item => currentFilter === 'all' || !item.is_read);
    if (!filtered.length) historyList.innerHTML = '<p class="ns-empty">Inga notiser att visa.</p>';
    else filtered.forEach(item => historyList.append(noticeNode(item)));
    byId('ns-unread-total').textContent = count + ' olästa';
  }
  async function loadNotices() {
    if (!activeUser || !authClient) return;
    const userId = activeUser;
    const { data, error } = await authClient.from('notifications')
      .select('id,type,title,message,related_entity_type,related_entity_id,is_read,created_at,read_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(200);
    if (activeUser !== userId) return;
    if (error) { console.warn('Cannot load notifications', error); return; }
    notices = data || [];
    renderNotices();
  }
  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; loadNotices(); }, 200);
  }
  async function markRead(ids) {
    if (!activeUser || !authClient || !ids.length) return;
    const userId = activeUser;
    const now = new Date().toISOString();
    const { error } = await authClient.from('notifications')
      .update({ is_read: true, read_at: now }).eq('user_id', userId).in('id', ids);
    if (error) { console.warn('Could not mark notifications read', error); return; }
    if (activeUser !== userId) return;
    notices = notices.map(n => ids.includes(n.id) ? { ...n, is_read: true, read_at: now } : n);
    renderNotices();
  }
  function openNotice(item) {
    if (!item.is_read) markRead([item.id]);
    hidePopup();
    if (item.related_entity_type === 'listing' && item.related_entity_id) {
      const key = 'listing-' + item.related_entity_id;
      if (findProductCard(key)) { openProduct(key); return; }
      navTo('market'); toast('Annonsen är inte längre tillgänglig.');
    } else if (item.related_entity_type === 'offer') {
      navTo('dashboard'); window.passitonHub?.open('offers');
    } else if (item.related_entity_type === 'dispute' || item.related_entity_type === 'order') {
      navTo('dashboard'); window.passitonHub?.open('orders');
    } else {
      navTo('dashboard');
    }
  }
  function hidePopup() {
    popupVisible = false;
    byId('ns-dropdown').classList.add('hidden');
    byId('ns-bell').setAttribute('aria-expanded', 'false');
  }
  function showHistory() {
    hidePopup();
    if (!activeUser) { navTo('dashboard'); return; }
    navTo('dashboard');
    window.passitonHub?.open('notifications');
  }
  async function onAuthChange() {
    const next = state.user?.id || null;
    if (next === activeUser) return;
    activeUser = next;
    ++preferencesRequest;
    if (channel && authClient) await authClient.removeChannel(channel);
    channel = null;
    notices = [];
    prefs = defaults();
    renderNotices();
    syncSettings();
    byId('ns-bell').classList.toggle('hidden', !next);
    hidePopup();
    if (!next || !authClient) return;
    await Promise.all([loadPrefs(), loadNotices()]);
    if (activeUser !== next) return;
    channel = authClient.channel('passiton-notifications-' + next)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + next }, scheduleRefresh)
      .subscribe();
  }
  function setup() {
    bindCheckAll('signup');
    bindCheckAll('settings');
    byId('ns-prefs-form').addEventListener('submit', savePrefs);
    byId('ns-bell').addEventListener('click', (event) => {
      event.stopPropagation();
      popupVisible = !popupVisible;
      byId('ns-dropdown').classList.toggle('hidden', !popupVisible);
      byId('ns-bell').setAttribute('aria-expanded', String(popupVisible));
      if (popupVisible) loadNotices();
    });
    byId('ns-dropdown').addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => { if (popupVisible) hidePopup(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hidePopup(); });
    document.querySelectorAll('[data-ns-history]').forEach(button => button.addEventListener('click', showHistory));
    document.querySelectorAll('[data-ns-read-all]').forEach(button => button.addEventListener('click', () =>
      markRead(notices.filter(n => !n.is_read).map(n => n.id))));
    document.querySelectorAll('[data-ns-filter]').forEach(button => button.addEventListener('click', () => {
      currentFilter = button.dataset.nsFilter;
      document.querySelectorAll('[data-ns-filter]').forEach(tab => {
        const selected = tab === button;
        tab.setAttribute('aria-selected', String(selected));
        tab.classList.toggle('is-active', selected);
      });
      renderNotices();
    }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && activeUser) loadNotices(); });
    onAuthChange();
  }
  window.passitonNotifications = { onAuthChange, refresh: loadNotices, signupPreferences: getSignupChoices };
  setup();
})();
