const state = {
  purchases: JSON.parse(localStorage.getItem('passiton-purchases') || '[]'),
  cart: JSON.parse(localStorage.getItem('passiton-cart') || '[]'),
  listings: JSON.parse(localStorage.getItem('passiton-listings') || '[]'),
  liveListings: [],
  checkoutItems: [],
  checkoutFromCart: false,
  lastOrder: null,
  selectedId: 1,
  search: '',
  category: 'all',
  minDiscount: 0,
  sort: 'popular',
  user: null,
  authReady: false,
  authMode: 'signup',
  pendingNavigation: '',
  authBusy: false,
  sellingBusy: false,
  authUnavailable: '',
  listingError: '',
  identityStatus: 'unverified',
  identityError: '',
  identityBusy: false
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const money = n => new Intl.NumberFormat('sv-SE').format(Math.round(n)) + ' kr';
const pct = c => Math.round((1 - c.price / c.value) * 100);
const escapeHTML = str => String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function navTo(id){
  if(id==='sell'&&!state.user){
    state.pendingNavigation='sell';
    id='dashboard';
  }else if(id==='sell'&&state.user&&state.identityStatus!=='verified'){
    state.pendingNavigation='sell';
    id='dashboard';
  }
  if(id==='checkout'&&!state.checkoutItems.length)id='cart';
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
  window.scrollTo({top:0,behavior:'smooth'});
  if(id === 'market') renderMarket();
  if(id === 'cart') renderCart();
  if(id === 'checkout') renderCheckout();
  if(id === 'order-complete') renderOrderConfirmation();
  if(id === 'dashboard'){
    renderDashboard();
    if(state.pendingNavigation&&!state.user)setAuthMessage('Logga in eller skapa ett konto för att publicera en annons.','info');
    else if(state.pendingNavigation&&state.user&&state.identityStatus!=='verified')setIdentityMessage('Verifiera din identitet innan du publicerar en annons.','info');
  }
}

$$('[data-nav]').forEach(btn => btn.addEventListener('click', () => navTo(btn.dataset.nav)));

function artHTML(card){
  return `<div class="product-art brand-${card.cls}">
    <button class="heart-float" aria-label="Spara annons">♡</button>
    <div class="brand-card">${escapeHTML(card.brand)}</div>
  </div>`;
}

function cardHTML(card){
  return `<article class="product-card" data-card-id="${card.id}" tabindex="0" role="button" aria-label="Öppna ${escapeHTML(card.brand)} presentkort">
    ${artHTML(card)}
    <div class="product-meta">
      <div><h3>${escapeHTML(card.brand)} presentkort</h3><p>Värde ${money(card.value)} · ${card.isLive?'Säljarannons':'Verifierad'}</p></div>
      <div class="product-meta-price"><strong>${money(card.price)}</strong><span>Spara ${pct(card)}%</span></div>
    </div>
  </article>`;
}

const categoryLabels={Hem:'Hem & inredning',Mode:'Mode',Elektronik:'Elektronik',Mat:'Mat & dagligvaror',Sport:'Sport & fritid',Resor:'Resor & transport'};
function availableCards(){return [...state.liveListings,...cards]}
function findProductCard(id){
  const existing=availableCards().find(card=>String(card.id)===String(id));
  if(existing)return existing;
  const localListing=state.listings.find(listing=>String(listing.id)===String(id));
  if(!localListing)return null;
  return {
    ...localListing,
    categoryLabel:localListing.categoryLabel||categoryLabels[localListing.category]||localListing.category||'Presentkort',
    use:localListing.use||`hos ${localListing.brand}`,
    isDemoListing:true
  };
}

function filteredCards(){
  let list = availableCards().filter(c => {
    const q = state.search.toLowerCase();
    const matchesSearch = !q || c.brand.toLowerCase().includes(q) || c.categoryLabel.toLowerCase().includes(q);
    const matchesCategory = state.category === 'all' || c.category === state.category;
    return matchesSearch && matchesCategory && pct(c) >= state.minDiscount;
  });
  list = [...list].sort((a,b) => {
    if(state.sort === 'discount') return pct(b) - pct(a);
    if(state.sort === 'price') return a.price - b.price;
    if(state.sort === 'value') return b.value - a.value;
    return b.popular - a.popular;
  });
  return list;
}

function renderMarket(){
  const list = filteredCards();
  $('#market-grid').innerHTML = list.map(cardHTML).join('');
  $('#result-count').textContent = `${list.length} presentkort`;
  $('#empty-state').classList.toggle('hidden', list.length > 0);
  $$('.product-card').forEach(card => {
    const open = e => {
      if(e.target.closest('.heart-float')) return;
      openProduct(card.dataset.cardId);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', e => {if(e.key === 'Enter') open(e)});
  });
  $$('.heart-float').forEach(btn => btn.addEventListener('click', e => {e.stopPropagation(); btn.textContent = btn.textContent === '♡' ? '♥' : '♡';}));
}

function brandCardMarkup(card, size='main'){
  return `<div class="scene-wall"></div><div class="scene-floor"></div><div class="scene-table"></div><div class="scene-plant"></div><div class="scene-card brand-${card.cls}"><span class="brand-card" style="position:static;transform:none;width:100%;height:100%;box-shadow:none">${escapeHTML(card.brand)}</span></div>`;
}

function galleryHTML(card){
  return `
    <div class="gallery-shot">${brandCardMarkup(card)}</div>
    <div class="gallery-shot small">${brandCardMarkup(card,'small')}</div>
    <div class="gallery-shot store" data-brand="${escapeHTML(card.brand)}"></div>
    <div class="gallery-shot abstract"></div>`;
}

function openProduct(id){
  const card = findProductCard(id) || cards[0];
  const isOwnListing=card.isLive&&card.sellerId===state.user?.id;
  const isInspectionListing=Boolean(card.isLive||card.isDemoListing);
  state.selectedId = card.id;
  $('#gallery').innerHTML = galleryHTML(card);
  $('#breadcrumbs').innerHTML = `Köp <span>›</span> ${escapeHTML(card.categoryLabel)} <span>›</span> ${escapeHTML(card.brand)} <span>›</span> ${escapeHTML(card.brand)} presentkort`;
  $('#detail-title').textContent = `${card.brand} presentkort`;
  $('#detail-subtitle').textContent = `Digitalt presentkort för ${card.categoryLabel.toLowerCase()}`;
  $('#detail-value').textContent = money(card.value);
  $('#detail-price').textContent = money(card.price);
  $('#detail-save').textContent = `Spara ${pct(card)}%`;
  $('#detail-status-icon').textContent=isInspectionListing?'!':'✓';
  $('#detail-status-label').textContent=card.isLive?(isOwnListing?'Din annons · ej verifierad':'Säljarannons · ej verifierad'):card.isDemoListing?'Demoannons · ej publicerad':'Verifierad annons';
  $('#detail-status').classList.toggle('not-verified',isInspectionListing);
  $('#detail-seller-name').textContent=isOwnListing?'Du':card.isDemoListing?'Du':card.sellerName||'M. A.';
  $('#detail-seller-status').textContent=card.isLive?(isOwnListing?'Din annons · ej verifierad':'Ej verifierad säljare'):card.isDemoListing?'Demopost':'✓ Verifierad säljare';
  $('#detail-seller-status').classList.toggle('not-verified',isInspectionListing);
  $('#fact-expiry').textContent = new Date(card.expiry).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'});
  $('#fact-use').textContent = card.isLive?'Presentkortskoden lagras privat. Koden skickas inte i den här demon.':card.isDemoListing?'Demoposten finns bara i den här webbläsaren.':card.use;
  $('#about-copy').textContent = card.isLive?(isOwnListing?'Din annons är aktiv på Passiton. Presentkortet har inte verifierats av Passiton ännu.':`Annons publicerad av ${card.sellerName}. Presentkortet har inte verifierats av Passiton ännu.`):card.isDemoListing?'Det här är en lokal demoannons och den är inte publicerad i marknadsplatsen.':`${card.brand}-presentkortet levereras digitalt och kan användas hos ${card.use}. Ett enkelt sätt att få mer för pengarna.`;
  const suggested = Math.round(card.value * .90 / 10) * 10;
  const fee = Math.round(suggested * .05);
  $('#similar-sale').textContent = money(suggested);
  $('#similar-fee').textContent = money(fee);
  $('#similar-net').textContent = money(suggested - fee);
  $('#live-listing-notice').textContent=card.isLive?'Du kan prova demo-kassan för den här annonsen. Ingen betalning dras och ingen presentkortskod skickas.':'Den här demoannonsen är inte publicerad och går inte att köpa.';
  $('#live-listing-notice').classList.toggle('hidden',!isInspectionListing);
  $('#buy-now').disabled=Boolean(card.isDemoListing);
  $('#buy-now').textContent = card.isDemoListing?'Demoannons kan inte köpas':`Köp nu · ${money(card.price)}`;
  $('#add-to-cart').disabled=Boolean(card.isDemoListing);
  $('#add-to-cart').textContent=card.isDemoListing?'Demoannons kan inte läggas i korgen':'Lägg i varukorgen';
  navTo('product');
}

$('#back-to-market').addEventListener('click', () => navTo('market'));
$('#buy-now').addEventListener('click', () => {
  const card = findProductCard(state.selectedId);
  if(!card||card.isDemoListing)return;
  beginCheckout([card]);
});

$('#add-to-cart').addEventListener('click',()=>{
  const card=findProductCard(state.selectedId);
  if(!card||card.isDemoListing)return;
  if(state.cart.some(item=>String(item.id)===String(card.id))){
    toast('Presentkortet finns redan i varukorgen.');
    return;
  }
  state.cart.unshift({...card});
  localStorage.setItem('passiton-cart',JSON.stringify(state.cart));
  updateBag();
  toast('Presentkortet har lagts i varukorgen.');
});

$('#search-input').addEventListener('input', e => {state.search = e.target.value.trim(); renderMarket();});
$('#sort-filter').addEventListener('change', e => {state.sort = e.target.value; renderMarket();});
$('#discount-filter').addEventListener('input', e => {state.minDiscount = Number(e.target.value); $('#discount-output').textContent = `${e.target.value}%`; renderMarket();});
$$('input[name="cat"]').forEach(r => r.addEventListener('change', e => {state.category=e.target.value; renderMarket();}));
$('#clear-filters').addEventListener('click', () => {
  state.search='';state.category='all';state.minDiscount=0;state.sort='popular';
  $('#search-input').value='';$('#discount-filter').value=0;$('#discount-output').textContent='0%';$('#sort-filter').value='popular';
  $('input[name="cat"][value="all"]').checked=true;renderMarket();
});

$('.search-toggle').addEventListener('click', () => {$('#header-search').classList.toggle('hidden'); if(!$('#header-search').classList.contains('hidden')) $('#global-search').focus();});
$('#close-search').addEventListener('click', () => $('#header-search').classList.add('hidden'));
$('#global-search').addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    state.search=e.target.value.trim();$('#search-input').value=state.search;$('#header-search').classList.add('hidden');navTo('market');
  }
});

const expiryInput = $('#sell-expiry');
const future = new Date(); future.setFullYear(future.getFullYear()+1); expiryInput.value = future.toISOString().slice(0,10);
const brandClass = brand => ({IKEA:'ikea',Zalando:'zalando','H&M':'hm',Elgiganten:'elgiganten',Stadium:'stadium',ICA:'ica','Åhléns':'ahlens',SJ:'sj'}[brand] || 'ikea');

function updateSellerPreview(){
  const brand = $('#sell-brand').value || 'IKEA';
  const value = Math.max(Number($('#sell-value').value)||0,0);
  const price = Math.max(Number($('#sell-price').value)||0,0);
  const fee = Math.round(price*.05);
  const net = Math.max(price-fee,0);
  const savings = Math.max(value-price,0);
  const savingsPct = value ? Math.round((savings/value)*100) : 0;
  $('#seller-card-preview').className = `seller-card-preview brand-${brandClass(brand)}`;
  $('.preview-brand').textContent = brand;
  $('#preview-brand').textContent = `${brand} presentkort`;
  $('#preview-value').textContent = money(value);
  $('#preview-price').textContent = money(price);
  $('#preview-save').textContent = `Spara ${Math.max(savingsPct,0)}%`;
  $('#calc-price').textContent = money(price);
  $('#calc-fee').textContent = money(fee);
  $('#calc-net').textContent = money(net);
  $('#discount-copy').textContent = `Köparen sparar ${money(savings)} (${Math.max(savingsPct,0)}%).`;
}
['sell-brand','sell-value','sell-price'].forEach(id => $('#'+id).addEventListener('input',updateSellerPreview));
updateSellerPreview();

$('#sell-form').addEventListener('submit', async e => {
  e.preventDefault();
  if(!state.user||!authClient){
    state.pendingNavigation='sell';
    navTo('dashboard');
    setAuthMessage('Logga in eller skapa ett konto för att publicera en annons.','info');
    return;
  }
  if(state.identityStatus!=='verified'){
    state.pendingNavigation='sell';
    navTo('dashboard');
    setIdentityMessage('Verifiera din identitet med Stripe Identity innan du publicerar en annons.','info');
    return;
  }
  const brand=$('#sell-brand').value, category=$('#sell-category').value, value=Number($('#sell-value').value), price=Number($('#sell-price').value);
  if(price >= value){toast('Priset måste vara lägre än presentkortets värde.');return;}
  const expiry=$('#sell-expiry').value;
  if(expiry<new Date().toISOString().slice(0,10)){setSellMessage('Välj ett giltighetsdatum som inte har passerat.','error');return;}
  state.sellingBusy=true;setSellMessage('');renderAccountState();
  try{
    const {error}=await authClient.rpc('create_gift_card_listing',{
      p_brand:brand,
      p_category:category,
      p_value:value,
      p_price:price,
      p_expires_on:expiry,
      p_gift_card_code:$('#sell-code').value.trim()
    });
    if(error)throw error;

    e.target.reset();
    expiryInput.value=future.toISOString().slice(0,10);
    $('#sell-value').value=1000;
    $('#sell-price').value=900;
    updateSellerPreview();
    setSellMessage('Annonsen är publicerad på Passiton. Presentkortskoden visas inte i annonsen.','success');
    try{await refreshMarketplaceListings();}catch{}
    toast('Annonsen är publicerad.');
    navTo('dashboard');
  }catch(error){
    const detail=String(error?.message||'').toLowerCase();
    const needsMigration=error?.code==='PGRST202'||error?.code==='PGRST205'||error?.code==='42P01'||detail.includes('create_gift_card_listing');
    const needsIdentity=detail.includes('identity verification required');
    setSellMessage(needsMigration
      ?'Annonser är inte aktiverade i Supabase än. Kör SQL-migreringen som beskrivs i backend/README.md.'
      :needsIdentity
        ?'Du behöver verifiera din identitet innan du kan publicera en annons.'
        :'Annonsen kunde inte publiceras. Kontrollera uppgifterna och försök igen.','error');
  }finally{
    state.sellingBusy=false;
    renderAccountState();
  }
});

function activityHTML(item,type){
  const savings=item.value-item.price;
  const activityLabel=type==='purchase'?(item.orderId?`Demoorder · ${escapeHTML(item.orderId)}`:'Köpt i demon'):`${item.isLive?'Publicerad':'Demoannons'} · giltig till ${escapeHTML(item.expiry)}`;
  const amountLabel=type==='purchase'?'Sparat '+money(savings):item.isLive?'Visa annons →':'Visa demo →';
  const rowContent=`<div class="activity-brand brand-${item.cls}">${escapeHTML(item.brand)}</div><div class="activity-copy"><strong>${escapeHTML(item.brand)} presentkort</strong><span>Värde ${money(item.value)} · ${activityLabel}</span></div><div class="activity-amount"><strong>${money(item.price)}</strong><span>${amountLabel}</span></div>`;
  if(type==='listing'){
    const description=item.isLive?'Visa aktiv annons':'Visa demoannons';
    return `<button class="activity-item activity-open-listing" type="button" data-open-listing="${escapeHTML(item.id)}" aria-label="${description} för ${escapeHTML(item.brand)} presentkort">${rowContent}</button>`;
  }
  return `<div class="activity-item">${rowContent}</div>`;
}
function renderDashboard(){
  const bought=state.purchases.reduce((s,p)=>s+p.value,0);const saved=state.purchases.reduce((s,p)=>s+(p.value-p.price),0);
  const myLiveListings=state.liveListings.filter(item=>item.sellerId===state.user?.id);
  const myListings=[...myLiveListings,...state.listings];
  $('#stat-bought').textContent=money(bought);$('#stat-saved').textContent=money(saved);$('#stat-listed').textContent=myListings.length;
  $('#purchase-list').innerHTML=state.purchases.length?state.purchases.map(i=>activityHTML(i,'purchase')).join(''):'<div class="empty-mini">Du har inte gjort något demoköp ännu.</div>';
  $('#listing-list').innerHTML=myListings.length?myListings.map(i=>activityHTML(i,'listing')).join(''):'<div class="empty-mini">Du har inga publicerade annonser ännu.</div>';
  updateBag();
  renderAccountState();
}
function updateBag(){
  const count=state.cart.length;
  $('#bag-count').textContent=count;
  $('#bag-count').classList.toggle('hidden',!count);
  $('#bag-btn').setAttribute('aria-label',count?`Varukorg, ${count} presentkort`:'Varukorg');
  $('#bag-btn').title=count?`Varukorg, ${count} presentkort`:'Varukorg';
}

const cartTotal=items=>items.reduce((total,item)=>total+Number(item.price||0),0);

function cartItemHTML(item){
  const itemType=item.isLive?'Aktiv säljarannons':'Demokort';
  return `<article class="cart-item">
    <div class="cart-item-brand brand-${escapeHTML(item.cls)}">${escapeHTML(item.brand)}</div>
    <div class="cart-item-info"><strong>${escapeHTML(item.brand)} presentkort</strong><span>Värde ${money(item.value)} · ${itemType}</span></div>
    <div class="cart-item-actions"><strong>${money(item.price)}</strong><button type="button" data-remove-cart="${escapeHTML(item.id)}">Ta bort</button></div>
  </article>`;
}

function renderCart(){
  const hasItems=state.cart.length>0;
  $('#cart-summary').classList.toggle('hidden',!hasItems);
  $('#cart-items').innerHTML=hasItems?state.cart.map(cartItemHTML).join(''):`<div class="cart-empty"><h2>Varukorgen är tom.</h2><p>Lägg till ett presentkort så kan du gå igenom demo-kassan.</p><button id="empty-cart-shop" class="secondary-cta" type="button">Se presentkort</button></div>`;
  $('#cart-item-count').textContent=state.cart.length;
  $('#cart-total').textContent=money(cartTotal(state.cart));
  updateBag();
}

function renderCheckout(){
  if(!state.checkoutItems.length){
    navTo('cart');
    return;
  }
  $('#checkout-order-items').innerHTML=state.checkoutItems.map(item=>`<div class="checkout-order-item"><span>${escapeHTML(item.brand)} presentkort</span><strong>${money(item.price)}</strong></div>`).join('');
  $('#checkout-total').textContent=money(cartTotal(state.checkoutItems));
}

function renderOrderConfirmation(){
  if(!state.lastOrder){
    navTo('dashboard');
    return;
  }
  $('#confirmation-order-number').textContent=state.lastOrder.orderNumber;
  $('#confirmation-copy').textContent=state.lastOrder.firstName
    ?`Tack, ${state.lastOrder.firstName}. Din demoorder är registrerad.`
    :'Tack. Din demoorder är registrerad.';
}

function beginCheckout(items,fromCart=false){
  if(!items.length){
    navTo('cart');
    return;
  }
  state.checkoutItems=items.map(item=>({...item}));
  state.checkoutFromCart=fromCart;
  navTo('checkout');
}

$('#cart-items').addEventListener('click',e=>{
  const removeButton=e.target.closest('[data-remove-cart]');
  if(removeButton){
    const removedId=removeButton.dataset.removeCart;
    state.cart=state.cart.filter(item=>String(item.id)!==String(removedId));
    localStorage.setItem('passiton-cart',JSON.stringify(state.cart));
    renderCart();
    return;
  }
  if(e.target.closest('#empty-cart-shop'))navTo('market');
});

$('#checkout-from-cart').addEventListener('click',()=>beginCheckout(state.cart,true));

$('#checkout-form').addEventListener('submit',e=>{
  e.preventDefault();
  const items=state.checkoutItems;
  if(!items.length){
    navTo('cart');
    return;
  }

  const buyerName=e.currentTarget.elements['buyer-name'].value.trim();
  const orderNumber=`DEMO-${Date.now().toString(36).toUpperCase()}`;
  const boughtAt=new Date().toISOString();
  const profileItems=items.map(item=>({...item,boughtAt,orderId:orderNumber,demoOrder:true}));
  state.purchases.unshift(...profileItems);
  localStorage.setItem('passiton-purchases',JSON.stringify(state.purchases));
  state.lastOrder={
    orderNumber,
    firstName:buyerName.split(/\s+/)[0]||'',
    itemCount:items.length
  };

  if(state.checkoutFromCart){
    const purchasedIds=new Set(items.map(item=>String(item.id)));
    state.cart=state.cart.filter(item=>!purchasedIds.has(String(item.id)));
    localStorage.setItem('passiton-cart',JSON.stringify(state.cart));
  }

  // Test payment values are never read or stored; clear every entered field after the demo order.
  e.currentTarget.reset();
  state.checkoutItems=[];
  state.checkoutFromCart=false;
  updateBag();
  navTo('order-complete');
});

$('#listing-list').addEventListener('click',e=>{
  const listing=e.target.closest('[data-open-listing]');
  if(listing)openProduct(listing.dataset.openListing);
});

let authClient=null;

async function refreshMarketplaceListings(){
  if(!authClient)return;
  const today=new Date().toISOString().slice(0,10);
  const {data,error}=await authClient.from('gift_card_listings')
    .select('id,seller_id,seller_name,brand,category,value,price,expires_on,created_at,status')
    .eq('status','active')
    .gte('expires_on',today)
    .order('created_at',{ascending:false});
  if(error){
    state.listingError=error.code==='42P01'||error.code==='PGRST205'
      ?'Kör annonsmigreringen i Supabase SQL Editor innan du publicerar. Se backend/README.md.'
      :'Kunde inte ladda annonser från Supabase. Kontrollera anslutningen och annonsmigreringen.';
    renderAccountState();
    throw error;
  }
  state.listingError='';
  state.liveListings=(data||[]).map(row=>({
    id:`listing-${row.id}`,
    listingId:row.id,
    sellerId:row.seller_id,
    sellerName:row.seller_name,
    brand:row.brand,
    category:row.category,
    categoryLabel:categoryLabels[row.category]||row.category,
    value:Number(row.value),
    price:Number(row.price),
    expiry:row.expires_on,
    use:`hos ${row.brand}`,
    cls:brandClass(row.brand),
    popular:101,
    createdAt:row.created_at,
    isLive:true
  }));
  renderAccountState();
  if($('#market').classList.contains('active'))renderMarket();
  if($('#dashboard').classList.contains('active'))renderDashboard();
}

function continuePendingNavigation(){
  if(!state.user||!state.pendingNavigation)return;
  const destination=state.pendingNavigation;
  state.pendingNavigation='';
  navTo(destination);
}

function setAuthMessage(message,tone='info'){
  const el=$('#auth-message');
  el.textContent=message;
  el.dataset.tone=tone;
  el.classList.toggle('hidden',!message);
}

function setSellMessage(message,tone='info'){
  const el=$('#sell-form-message');
  el.textContent=message;
  el.dataset.tone=tone;
  el.classList.toggle('hidden',!message);
}

function setIdentityMessage(message,tone='info'){
  const el=$('#identity-message');
  el.textContent=message;
  el.dataset.tone=tone;
  el.classList.toggle('hidden',!message);
}

function identityCopy(){
  const map={
    unverified:['Ej verifierad','Verifiera din identitet med Stripe Identity för att kunna publicera annonser.'],
    requires_input:['Behöver verifieras','Slutför eller försök verifieringen igen för att kunna sälja.'],
    processing:['Verifiering behandlas','Stripe behandlar din verifiering. Status uppdateras när resultatet är klart.'],
    verified:['Verifierad','Din identitet är verifierad. Du kan publicera annonser.'],
    canceled:['Verifiering avbruten','Starta en ny verifiering för att kunna sälja.'],
    redacted:['Verifieringsdata raderad','Du behöver verifiera din identitet igen innan du kan sälja.']
  };
  return map[state.identityStatus]||map.unverified;
}

async function refreshIdentityStatus(){
  if(!authClient||!state.user){
    state.identityStatus='unverified';
    state.identityError='';
    renderAccountState();
    return;
  }

  const {data,error}=await authClient
    .from('identity_verifications')
    .select('status,last_error_code,verified_at')
    .eq('user_id',state.user.id)
    .maybeSingle();

  if(error){
    const missing=error.code==='42P01'||error.code==='PGRST205';
    state.identityError=missing
      ?'Stripe Identity är inte aktiverat i Supabase än. Kör Identity-migreringen.'
      :'Kunde inte läsa verifieringsstatus just nu.';
    state.identityStatus='unverified';
  }else{
    state.identityError='';
    state.identityStatus=data?.status||'unverified';
  }
  renderAccountState();
  continuePendingNavigation();
}

async function startIdentityVerification(){
  if(!authClient||!state.user||state.identityBusy)return;
  state.identityBusy=true;
  setIdentityMessage('');
  renderAccountState();

  try{
    const {data,error}=await authClient.functions.invoke('create-identity-session',{body:{}});
    if(error)throw error;

    if(data?.status==='verified'){
      state.identityStatus='verified';
      setIdentityMessage('Din identitet är redan verifierad.','success');
      renderAccountState();
      continuePendingNavigation();
      return;
    }

    if(data?.status==='processing'&&!data?.url){
      state.identityStatus='processing';
      setIdentityMessage('Verifieringen behandlas av Stripe. Ladda om sidan om en stund för att se resultatet.','info');
      renderAccountState();
      return;
    }

    if(!data?.url)throw new Error('NO_VERIFICATION_URL');
    window.location.assign(data.url);
  }catch(error){
    console.error('Identity verification could not start:',error);
    setIdentityMessage('Verifieringen kunde inte startas. Kontrollera Supabase/Stripe-konfigurationen och försök igen.','error');
  }finally{
    state.identityBusy=false;
    renderAccountState();
  }
}

function setAuthMode(mode){
  state.authMode=mode;
  const isSignup=mode==='signup';
  $('#auth-title').textContent=isSignup?'Skapa konto':'Logga in';
  $('#auth-copy').textContent=isSignup?'Använd din e-postadress och välj ett lösenord.':'Logga in med e-postadressen och lösenordet till ditt konto.';
  $('#auth-name-field').classList.toggle('hidden',!isSignup);
  $('#auth-name').required=isSignup;
  $('#auth-password').minLength=isSignup?8:1;
  $('#auth-password').autocomplete=isSignup?'new-password':'current-password';
  $('#auth-submit').textContent=isSignup?'Skapa konto':'Logga in';
  $('#auth-mode-toggle').textContent=isSignup?'Har du redan ett konto? Logga in':'Nytt på Passiton? Skapa konto';
  setAuthMessage('');
  renderAccountState();
}

function renderAccountState(){
  const signedIn=Boolean(state.user);
  $('#auth-heading').classList.toggle('hidden',signedIn);
  $('#auth-form').classList.toggle('hidden',signedIn);
  $('#account-signed-in').classList.toggle('hidden',!signedIn);
  $('#auth-unavailable').textContent=state.authUnavailable;
  $('#auth-unavailable').classList.toggle('hidden',!state.authUnavailable||signedIn);

  const name=state.user?.user_metadata?.full_name||state.user?.user_metadata?.name||state.user?.email?.split('@')[0]||'Välkommen';
  $('#account-name').textContent=name;
  $('#account-email').textContent=state.user?.email||'';
  $('#account-initials').textContent=name.trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toLocaleUpperCase('sv-SE')||'P';

  const accountNav=$('#account-nav');
  accountNav.title=signedIn?`Inloggad som ${state.user.email||name}`:'Logga in eller skapa konto';
  accountNav.setAttribute('aria-label',accountNav.title);

  $('#sell-auth-notice').classList.toggle('hidden',signedIn);
  $('#sell-service-notice').textContent=state.listingError;
  $('#sell-service-notice').classList.toggle('hidden',!state.listingError||!signedIn);

  const identityVerified=state.identityStatus==='verified';
  $('#sell-identity-notice').classList.toggle('hidden',!signedIn||identityVerified);

  const identityPanel=$('#identity-panel');
  const [identityTitle,identityDescription]=identityCopy();
  identityPanel.dataset.status=state.identityStatus;
  $('#identity-status-title').textContent=identityTitle;
  $('#identity-status-copy').textContent=state.identityError||identityDescription;
  const identityButton=$('#identity-verify-button');
  identityButton.classList.toggle('hidden',!signedIn||identityVerified);
  identityButton.disabled=state.identityBusy||Boolean(state.authUnavailable);
  identityButton.textContent=state.identityBusy
    ?'Startar verifiering…'
    :state.identityStatus==='requires_input'
      ?'Försök igen'
      :'Verifiera identitet';

  const locked=!authClient||state.authBusy||state.sellingBusy||Boolean(state.authUnavailable);
  $('#auth-form').querySelectorAll('input,button').forEach(control=>{control.disabled=locked;});
  $('#sign-out').disabled=state.authBusy;
  $('#sell-form').querySelectorAll('input,select,button').forEach(control=>{control.disabled=locked||!signedIn||!identityVerified||Boolean(state.listingError);});
}

function initializeSupabaseAuth(){
  const config=window.PASSITON_SUPABASE_CONFIG||{};
  if(window.location.protocol==='file:'){
    state.authUnavailable='Konton kräver att sidan körs via en lokal webbserver. Följ startguiden i README.';
    state.authReady=true;
  }else if(!window.supabase?.createClient){
    state.authUnavailable='Supabase-biblioteket kunde inte laddas. Kontrollera internetanslutningen och ladda om sidan.';
    state.authReady=true;
  }else if(!config.url||!config.publishableKey||/YOUR_|PLACEHOLDER/i.test(`${config.url} ${config.publishableKey}`)){
    state.authUnavailable='Lägg till din Supabase Project URL och publishable key i js/supabase-config.js för att aktivera konton.';
    state.authReady=true;
  }else{
    try{
      authClient=window.supabase.createClient(config.url,config.publishableKey);
      authClient.auth.onAuthStateChange((_event,session)=>{
        state.authUnavailable='';
        state.authReady=true;
        state.user=session?.user||null;
        if(!state.user){
          state.identityStatus='unverified';
          state.identityError='';
        }
        renderAccountState();
        if($('#dashboard').classList.contains('active'))renderDashboard();
        if(state.user)refreshIdentityStatus().catch(()=>{});
        else continuePendingNavigation();
      });
      authClient.auth.getSession().then(async({data,error})=>{
        if(error)state.authUnavailable='Kunde inte ansluta till kontotjänsten. Kontrollera Supabase-konfigurationen och försök igen.';
        else state.authUnavailable='';
        state.authReady=true;
        state.user=data?.session?.user||null;
        renderAccountState();
        if(!error){
          try{await refreshMarketplaceListings();}catch{}
          if(state.user)try{await refreshIdentityStatus();}catch{}
        }
        continuePendingNavigation();
      }).catch(()=>{
        state.authUnavailable='Kunde inte ansluta till kontotjänsten. Kontrollera Supabase-konfigurationen och försök igen.';
        state.authReady=true;
        renderAccountState();
      });
    }catch{
      authClient=null;
      state.authUnavailable='Supabase-konfigurationen kunde inte läsas. Kontrollera js/supabase-config.js.';
      state.authReady=true;
    }
  }
  renderAccountState();
}

$('#auth-mode-toggle').addEventListener('click',()=>setAuthMode(state.authMode==='signup'?'login':'signup'));
$('#auth-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!authClient)return;
  const email=$('#auth-email').value.trim();
  const password=$('#auth-password').value;
  const isSignup=state.authMode==='signup';
  state.authBusy=true;renderAccountState();setAuthMessage('');
  try{
    let result;
    if(isSignup){
      const name=$('#auth-name').value.trim();
      result=await authClient.auth.signUp({
        email,
        password,
        options:{
          data:{full_name:name},
          emailRedirectTo:`${window.location.origin}${window.location.pathname}`
        }
      });
      if(result.error)throw result.error;
      if(result.data.session){
        state.user=result.data.user;
        toast('Ditt konto är klart.');
      }else{
        setAuthMessage(`Kontot är skapat. Öppna bekräftelselänken som skickats till ${email} för att logga in.`,'success');
      }
    }else{
      result=await authClient.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      state.user=result.data.user;
    }
    if(state.user){
      try{await refreshMarketplaceListings();}catch{}
      continuePendingNavigation();
    }
  }catch(error){
    const detail=String(error?.message||'').toLowerCase();
    let message;
    if(detail.includes('invalid login credentials')||detail.includes('invalid credentials'))message='E-postadress eller lösenord stämmer inte.';
    else if(detail.includes('email not confirmed'))message='Bekräfta din e-postadress via länken vi skickat innan du loggar in.';
    else if(detail.includes('rate limit'))message='För många försök på kort tid. Vänta en stund och försök igen.';
    else if(detail.includes('password')&&detail.includes('weak'))message='Välj ett starkare lösenord med minst 8 tecken.';
    else message=isSignup?'Kontot kunde inte skapas. Kontrollera uppgifterna och försök igen.':'Inloggningen misslyckades. Kontrollera uppgifterna och försök igen.';
    setAuthMessage(message,'error');
  }finally{
    state.authBusy=false;
    renderAccountState();
  }
});

$('#identity-verify-button').addEventListener('click',startIdentityVerification);

$('#sign-out').addEventListener('click',async()=>{
  if(!authClient)return;
  state.authBusy=true;renderAccountState();
  try{
    const {error}=await authClient.auth.signOut();
    if(error)throw error;
    state.user=null;
    setAuthMode('login');
    setAuthMessage('Du är utloggad.','success');
  }catch{
    setAuthMessage('Det gick inte att logga ut. Försök igen.','error');
  }finally{
    state.authBusy=false;
    renderAccountState();
  }
});

let toastTimer;function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),2600)}

renderMarket();renderDashboard();updateBag();initializeSupabaseAuth();
