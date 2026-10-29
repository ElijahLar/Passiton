/* PassItOn IP-02 - structured price offers. All server validation happens in Supabase RPC. */
(() => {
  'use strict';
  const rules = window.passitonOfferRules;
  const dialog = document.querySelector('#offer-dialog');
  const form = document.querySelector('#offer-form');
  const offerButton = document.querySelector('#offer-open');
  const section = document.querySelector('#price-offers-panel');
  const moneyLabel = amount => new Intl.NumberFormat('sv-SE').format(Number(amount || 0)) + ' kr';
  const clean = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const $offer = selector => document.querySelector(selector);
  let selectedCard = null;
  let pendingOfferListingId = null;
  let resumeOfferListingId = null;
  let loading = false;
  let offerData = {sent: [], received: [], active_count: 0, misses_30d: 0, blocked_until: null};
  let activeTab = 'sent';
  let available = false;
  let requestId = 0;

  function message(text, kind = 'error') {
    const el = $offer('#offer-message');
    el.textContent = text;
    el.dataset.kind = kind;
    el.classList.toggle('hidden', !text);
  }
  function showError(err) {
    console.error('Price offers:', err);
    const raw = String(err?.message || '');
    const known = ['fem aktiva', 'inlogg', 'spärrat', 'reserverad', 'inte längre', 'redan',
      'halva annonspriset', 'motbudet', 'inte tillgänglig', 'pruta', 'priset'];
    const text = known.some(part => raw.toLowerCase().includes(part)) ? raw :
      'Något gick fel. Kontrollera att prisförslagsmigreringen är installerad i Supabase.';
    toast(text);
    return text;
  }
  function signedIn() { return Boolean(state.user && authClient); }
  function canOffer(card) {
    return Boolean(card?.isLive && card.photoReviewStatus === 'approved' && card.sellerId !== state.user?.id);
  }
  function applyAvailability(card, reserved) {
    if (String(state.selectedId) !== String(card.id)) return;
    const own = card.sellerId === state.user?.id;
    available = canOffer(card) && !reserved;
    offerButton.classList.toggle('hidden', !card?.isLive || card.photoReviewStatus !== 'approved' || own);
    offerButton.disabled = !available;
    offerButton.textContent = reserved ? 'Tillfälligt reserverat' : 'Lämna prisförslag';
    if (reserved) {
      $offer('#buy-now').disabled = true;
      $offer('#add-to-cart').disabled = true;
      $offer('#live-listing-notice').textContent = 'Annonsen är reserverad för en köpare med accepterat bud.';
      $offer('#live-listing-notice').classList.remove('hidden');
    }
  }
  async function onProductOpen(card) {
    selectedCard = card;
    const seq = ++requestId;
    available = canOffer(card);
    offerButton.classList.toggle('hidden', !canOffer(card) && !(card?.isLive && card.photoReviewStatus === 'approved' && card.sellerId !== state.user?.id));
    offerButton.disabled = !available;
    offerButton.textContent = 'Lämna prisförslag';
    if (!card?.isLive || card.photoReviewStatus !== 'approved' || !authClient) return;
    try {
      const {data, error} = await authClient.rpc('price_offer_is_reserved', {p_listing_id: card.listingId});
      if (error) throw error;
      if (seq !== requestId) return;
      applyAvailability(card, Boolean(data));
      if (resumeOfferListingId === card.id) {
        resumeOfferListingId = null;
        if (available) await openOffer();
      }
    } catch (err) {
      // Avoid opening offers when the database rules are unavailable.
      if (seq === requestId) {
        available = false;
        offerButton.disabled = true;
        offerButton.textContent = 'Prisförslag är inte tillgängliga';
      }
      console.warn('Offer availability check failed:', err);
    }
  }
  function syncOfferInput() {
    const input = $offer('#offer-price');
    const price = Number(selectedCard?.price || 0);
    const min = rules.minOffer(price);
    const suggested = Math.max(min, Math.floor(price * 0.8));
    input.min = String(min);
    input.max = String(price - 1);
    input.value = String(suggested);
    $offer('#offer-listing-name').textContent = `${selectedCard?.brand || ''} presentkort`;
    $offer('#offer-original-price').textContent = moneyLabel(price);
    $offer('#offer-min-price').textContent = moneyLabel(min);
    updatePreview();
  }
  function updatePreview() {
    const amount = Number($offer('#offer-price').value);
    const valid = selectedCard && rules.isValidOffer(amount, Number(selectedCard.price));
    $offer('#offer-preview').textContent = valid
      ? `Jag erbjuder ${moneyLabel(amount)} för ditt presentkort.`
      : `Välj ett pris mellan ${moneyLabel(rules.minOffer(selectedCard?.price || 0))} och ${moneyLabel(Number(selectedCard?.price || 0) - 1)}.`;
    $offer('#offer-submit').disabled = !valid || loading;
  }
  async function openOffer() {
    if (!selectedCard?.isLive || !available) return;
    if (!signedIn()) {
      pendingOfferListingId = selectedCard.id;
      navTo('dashboard');
      setAuthMessage('Logga in eller skapa ett konto för att lämna ett prisförslag.', 'info');
      return;
    }
    await refresh();
    if (offerData.blocked_until && !rules.expired(offerData.blocked_until)) {
      toast('Du kan inte skicka nya prisförslag just nu. Se status på Mitt Passiton.');
      return;
    }
    if (offerData.active_count >= 5) {
      toast('Du har redan fem aktiva prisförslag. Vänta tills ett avslutas.');
      navTo('dashboard');
      return;
    }
    syncOfferInput();
    message('');
    $offer('#offer-count').textContent = `${offerData.active_count} av 5 aktiva prisförslag`;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    $offer('#offer-price').focus();
  }
  function closeOffer() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }
  offerButton.addEventListener('click', openOffer);
  $offer('#offer-close').addEventListener('click', closeOffer);
  dialog.addEventListener('click', e => { if (e.target === dialog) closeOffer(); });
  $offer('#offer-price').addEventListener('input', updatePreview);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (loading || !signedIn() || !selectedCard?.listingId) return;
    const amount = Number($offer('#offer-price').value);
    if (!rules.isValidOffer(amount, Number(selectedCard.price))) {
      message('Ange ett giltigt heltalsbelopp inom prisgränserna.'); return;
    }
    loading = true;
    updatePreview();
    message('Skickar prisförslaget...', 'info');
    try {
      const {error} = await authClient.rpc('price_offer_create', {
        p_listing_id: selectedCard.listingId, p_price: amount
      });
      if (error) throw error;
      closeOffer();
      toast('Prisförslaget är skickat! Du ser det under Mitt Passiton.');
      await refresh();
    } catch (err) {
      message(showError(err));
    } finally {
      loading = false;
      updatePreview();
    }
  });

  const labels = {
    pending_seller: 'Väntar på säljaren', countered: 'Nytt motbud',
    accepted_awaiting_payment: 'Accepterat · betala inom 24 h',
    declined: 'Nekat', cancelled: 'Avbrutet', expired: 'Utgånget',
    payment_expired: 'Betalning uteblev', purchased: 'Demoköp genomfört'
  };
  function detailDate(offer) {
    const date = offer.status === 'accepted_awaiting_payment' ? offer.payment_due_at :
      ['pending_seller', 'countered'].includes(offer.status) ? offer.offer_expires_at : null;
    return date ? rules.formatRemaining(date) : '';
  }
  function controls(offer, type) {
    const id = clean(offer.id);
    const accepted = offer.status === 'accepted_awaiting_payment';
    if (type === 'sent') {
      if (accepted) return `<button type="button" class="primary-cta offer-small" data-offer-pay="${id}">Till demo-kassan →</button>`;
      if (offer.status === 'countered') return `<div class="offer-actions">
        <button type="button" class="primary-cta offer-small" data-offer-action="accept_counter" data-offer-id="${id}">Acceptera motbud</button>
        <button type="button" class="secondary-cta offer-small" data-offer-action="decline_counter" data-offer-id="${id}">Tacka nej</button>
      </div>`;
      if (offer.status === 'pending_seller') return `<button type="button" class="offer-text-action" data-offer-action="cancel" data-offer-id="${id}">Återkalla prisförslag</button>`;
    } else if (offer.status === 'pending_seller') {
      return `<div class="offer-actions">
        <button type="button" class="primary-cta offer-small" data-offer-action="accept" data-offer-id="${id}">Acceptera</button>
        <button type="button" class="secondary-cta offer-small" data-offer-counter="${id}">Lämna motbud</button>
        <button type="button" class="offer-text-action" data-offer-action="decline" data-offer-id="${id}">Neka</button>
      </div><form class="offer-counter-form hidden" data-offer-counter-form="${id}">
        <label for="offer-counter-${id}">Ditt motbud, hela kronor</label>
        <div class="offer-counter-row"><input id="offer-counter-${id}" type="number" step="1" required
          min="${Number(offer.offered_price) + 1}" max="${Math.ceil(Number(offer.listing_price)) - 1}" value="${Math.min(Math.ceil(Number(offer.listing_price)) - 1,Number(offer.offered_price) + 50)}" />
        <button class="secondary-cta offer-small" type="submit">Skicka motbud</button></div>
      </form>`;
    }
    return '';
  }
  function offerHTML(offer, type) {
    const active = rules.isActive(offer.status);
    const currentPrice = offer.accepted_price || offer.counter_price || offer.offered_price;
    const badge = active ? 'offer-tag-active' : 'offer-tag-closed';
    return `<article class="offer-item">
      <div class="offer-item-top">
        <div><span class="offer-item-kicker">${type === 'sent' ? 'Säljare' : 'Köpare'} ${clean(offer.alias)}</span>
          <h3>${clean(offer.brand)} presentkort</h3></div>
        <span class="offer-tag ${badge}">${clean(labels[offer.status] || offer.status)}</span>
      </div>
      <div class="offer-values">
        <div><span>Annonspris</span><strong>${moneyLabel(offer.listing_price)}</strong></div>
        <div><span>${offer.counter_price && !offer.accepted_price ? 'Motbud' : acceptedPriceLabel(offer)}</span><strong>${moneyLabel(currentPrice)}</strong></div>
      </div>
      ${offer.counter_price && !offer.accepted_price ? `<p class="offer-original">Ditt ursprungliga bud: ${moneyLabel(offer.offered_price)}</p>` : ''}
      ${detailDate(offer) ? `<p class="offer-deadline">◷ ${clean(detailDate(offer))}</p>` : ''}
      ${controls(offer,type)}
    </article>`;
  }
  function acceptedPriceLabel(offer) {
    return offer.accepted_price ? 'Överenskommet pris' : 'Prisförslag';
  }
  function render() {
    section.classList.toggle('hidden', !state.user);
    if (!state.user) return;
    const strikes = Number(offerData.misses_30d || 0);
    const blocked = offerData.blocked_until && !rules.expired(offerData.blocked_until);
    const unpaidAccepted = offerData.sent.filter(o => o.status === 'accepted_awaiting_payment' && !rules.expired(o.payment_due_at)).length;
    $offer('#offer-active-count').textContent = `${offerData.active_count}/5 aktiva`;
    $offer('#offer-missed-count').textContent = `${Math.min(strikes, 5)}/5 missade betalningar (30 dagar)`;
    const warning = $offer('#offer-warning');
    const alerts = [];
    if (blocked) alerts.push(`Du har nått fem missade betalningar. Nya bud är spärrade till ${new Date(offerData.blocked_until).toLocaleString('sv-SE')}. Befintliga köp kan slutföras.`);
    else if (strikes > 0) alerts.push(`Du har ${strikes} missade betalningar under de senaste 30 dagarna. Vid fem spärras nya prisförslag i sju dagar.`);
    if (unpaidAccepted >= 2) alerts.push(`Du har ${unpaidAccepted} accepterade prisförslag som ännu inte är betalda. Fullfölj köpen inom 24 timmar för att undvika missade betalningar.`);
    warning.classList.toggle('hidden', alerts.length === 0);
    warning.classList.toggle('offer-warning-blocked', Boolean(blocked));
    warning.textContent = alerts.join(' ');
    $offer('#offer-tab-sent').classList.toggle('is-active', activeTab === 'sent');
    $offer('#offer-tab-received').classList.toggle('is-active', activeTab === 'received');
    $offer('#offer-tab-sent').setAttribute('aria-selected', String(activeTab === 'sent'));
    $offer('#offer-tab-received').setAttribute('aria-selected', String(activeTab === 'received'));
    const list = offerData[activeTab] || [];
    $offer('#offer-list').innerHTML = list.length ? list.map(o => offerHTML(o, activeTab)).join('')
      : `<div class="offer-empty"><strong>Inga ${activeTab === 'sent' ? 'skickade' : 'mottagna'} prisförslag ännu</strong><p>${activeTab === 'sent' ? 'Hitta ett presentkort och lämna ett prisförslag.' : 'Här syns bud från intresserade köpare.'}</p></div>`;
  }
  async function refresh() {
    if (!signedIn()) { offerData = {sent: [], received: [], active_count: 0, misses_30d: 0, blocked_until: null}; render(); return; }
    const userId = state.user.id;
    try {
      const {data, error} = await authClient.rpc('price_offer_overview');
      if (error) throw error;
      if (state.user?.id !== userId) return;
      offerData = data;
      render();
    } catch (err) {
      console.warn('Price offer overview unavailable:', err);
      if ($offer('#dashboard').classList.contains('active')) {
        $offer('#offer-list').textContent = 'Prisförslagen kunde inte läsas. Kör SQL-migreringen enligt guiden.';
        section.classList.remove('hidden');
      }
    }
  }
  $offer('#offer-tab-sent').addEventListener('click', () => { activeTab = 'sent'; render(); });
  $offer('#offer-tab-received').addEventListener('click', () => { activeTab = 'received'; render(); });
  $offer('#offer-refresh').addEventListener('click', refresh);
  $offer('#offer-list').addEventListener('click', async event => {
    const counter = event.target.closest('[data-offer-counter]');
    if (counter) {
      $offer('#offer-list').querySelector(`[data-offer-counter-form="${counter.dataset.offerCounter}"]`)?.classList.toggle('hidden');
      return;
    }
    const pay = event.target.closest('[data-offer-pay]');
    if (pay) { startCheckout(pay.dataset.offerPay); return; }
    const action = event.target.closest('[data-offer-action]');
    if (!action || loading || !signedIn()) return;
    loading = true; action.disabled = true;
    try {
      const received = offerData.received.some(o => o.id === action.dataset.offerId);
      const functionName = received ? 'price_offer_seller_action' : 'price_offer_buyer_action';
      const params = {p_offer_id: action.dataset.offerId, p_action: action.dataset.offerAction};
      if (received) params.p_counter_price = null;
      const {error} = await authClient.rpc(functionName, params);
      if (error) throw error;
      toast('Prisförslaget är uppdaterat.');
    } catch (err) { showError(err); }
    finally { loading = false; await refresh(); }
  });
  $offer('#offer-list').addEventListener('submit', async event => {
    const form = event.target.closest('[data-offer-counter-form]');
    if (!form) return;
    event.preventDefault();
    if (loading || !signedIn()) return;
    const price = Number(form.querySelector('input').value);
    if (!Number.isInteger(price)) return;
    loading = true;
    try {
      const {error} = await authClient.rpc('price_offer_seller_action', {
        p_offer_id: form.dataset.offerCounterForm, p_action: 'counter', p_counter_price: price
      });
      if (error) throw error;
      toast('Motbud skickat.');
    } catch (err) { showError(err); }
    finally { loading = false; await refresh(); }
  });
  function startCheckout(id) {
    if (!signedIn()) return;
    const offer = offerData.sent.find(o => o.id === id);
    if (!offer || offer.status !== 'accepted_awaiting_payment' || rules.expired(offer.payment_due_at)) {
      toast('Det här erbjudandet är inte längre giltigt.'); return;
    }
    const card = state.liveListings.find(c => c.listingId === offer.listing_id);
    if (!card) { toast('Annonsen kunde inte hittas. Uppdatera sidan.'); return; }
    state.offerCheckoutId = offer.id;
    beginCheckout([{...card, price: Number(offer.accepted_price), offerCheckout: true}]);
  }
  function onAuthChange() {
    if (!state.user) { state.offerCheckoutId = null; offerData = {sent: [], received: [], active_count: 0, misses_30d: 0, blocked_until: null}; render(); return; }
    if (pendingOfferListingId) {
      const id = pendingOfferListingId;
      pendingOfferListingId = null;
      resumeOfferListingId = id;
      openProduct(id);
    }
  }
  window.passitonPriceOffers = {onProductOpen, refresh, onAuthChange};
  // Because this file loads after app.js initializes, render the current account state once.
  onAuthChange();
  if (state.user) refresh();
})();
