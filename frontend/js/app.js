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
  photoProof: null,
  checkoutBusy: false,
  offerCheckoutId: null
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
  }
  if(id==='checkout'&&!state.checkoutItems.length)id='cart';
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
  window.scrollTo({top:0,behavior:'smooth'});
  if(id === 'market') renderMarket();
  if(id === 'cart') renderCart();
  if(id === 'checkout') renderCheckout();
  if(id === 'order-complete') renderOrderConfirmation();
  if(id === 'disputes') window.passitonLoadDisputes?.();
  if(id === 'dashboard'){
    renderDashboard();
    if(state.pendingNavigation&&!state.user)setAuthMessage('Logga in eller skapa ett konto för att publicera en annons.','info');
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
      <div><h3>${escapeHTML(card.brand)} presentkort</h3><p>Värde ${money(card.value)} · ${card.isLive?'Foto granskat':'Demokort'}</p></div>
      <div class="product-meta-price"><strong>${money(card.price)}</strong><span>Spara ${pct(card)}%</span></div>
    </div>
  </article>`;
}

const categoryLabels={Hem:'Hem & inredning',Mode:'Mode',Elektronik:'Elektronik',Mat:'Mat & dagligvaror',Sport:'Sport & fritid',Resor:'Resor & transport'};
function availableCards(){return [...state.liveListings.filter(card=>card.photoReviewStatus==='approved'),...cards]}
function findProductCard(id){
  const existing=[...state.liveListings,...cards].find(card=>String(card.id)===String(id));
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
  const awaitingReview=Boolean(card.isLive&&card.photoReviewStatus!=='approved');
  const isInspectionListing=Boolean(awaitingReview||!card.isLive);
  state.selectedId = card.id;
  $('#gallery').innerHTML = galleryHTML(card);
  $('#breadcrumbs').innerHTML = `Köp <span>›</span> ${escapeHTML(card.categoryLabel)} <span>›</span> ${escapeHTML(card.brand)} <span>›</span> ${escapeHTML(card.brand)} presentkort`;
  $('#detail-title').textContent = `${card.brand} presentkort`;
  $('#detail-subtitle').textContent = `Digitalt presentkort för ${card.categoryLabel.toLowerCase()}`;
  $('#detail-value').textContent = money(card.value);
  $('#detail-price').textContent = money(card.price);
  $('#detail-save').textContent = `Spara ${pct(card)}%`;
  $('#detail-status-icon').textContent=isInspectionListing?'!':'✓';
  $('#detail-status-label').textContent=card.isLive?(awaitingReview?(card.photoReviewStatus==='rejected'?'Fotobevis underkänt':'Inväntar fotogranskning'):'Fotobevis granskat'):card.isDemoListing?'Demoannons · ej publicerad':'Demokort';
  $('#detail-status').classList.toggle('not-verified',isInspectionListing);
  $('#detail-seller-name').textContent=isOwnListing?'Du':card.isDemoListing?'Du':card.sellerName||'M. A.';
  $('#detail-seller-status').textContent=card.isLive?(isOwnListing?'Du är säljaren':'Identitet inte verifierad'):card.isDemoListing?'Demopost':'Exempelsäljare';
  $('#detail-seller-status').classList.toggle('not-verified',true);
  $('#fact-expiry').textContent = new Date(card.expiry).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'});
  $('#fact-use').textContent = card.isLive?'Presentkortskoden lagras privat. Koden skickas inte i den här demon.':card.isDemoListing?'Demoposten finns bara i den här webbläsaren.':card.use;
  $('#about-copy').textContent = card.isLive?(awaitingReview?'Annonsen väntar på manuell fotogranskning och är ännu inte synlig för köpare.':'Ett färskt fotobevis har granskats manuellt. Detta garanterar inte kortets saldo eller giltighet.'):card.isDemoListing?'Det här är en lokal demoannons och den är inte publicerad i marknadsplatsen.':`${card.brand}-presentkortet är ett demokort.`;
  const suggested = Math.round(card.value * .90 / 10) * 10;
  const fee = Math.round(suggested * .05);
  $('#similar-sale').textContent = money(suggested);
  $('#similar-fee').textContent = money(fee);
  $('#similar-net').textContent = money(suggested - fee);
  $('#live-listing-notice').textContent=card.isLive?(awaitingReview?'Annonsen är inte publicerad. En granskare behöver kontrollera bilden och engångskoden.':'Bilden har granskats; kortets saldo är inte garanterat. Kassa är fortfarande endast en demo.'):'Den här demoannonsen är inte publicerad och går inte att köpa.';
  $('#live-listing-notice').classList.toggle('hidden',!isInspectionListing);
  $('#buy-now').disabled=Boolean(card.isDemoListing||awaitingReview);
  $('#buy-now').textContent = awaitingReview?'Inväntar granskning':card.isDemoListing?'Demoannons kan inte köpas':`Köp nu · ${money(card.price)}`;
  $('#add-to-cart').disabled=Boolean(card.isDemoListing||awaitingReview);
  $('#add-to-cart').textContent=awaitingReview?'Ej tillgänglig än':card.isDemoListing?'Demoannons kan inte läggas i korgen':'Lägg i varukorgen';
  navTo('product');
  window.passitonPriceOffers?.onProductOpen(card);
}

$('#back-to-market').addEventListener('click', () => navTo('market'));
$('#buy-now').addEventListener('click', () => {
  const card = findProductCard(state.selectedId);
  if(!card||card.isDemoListing||(card.isLive&&card.photoReviewStatus!=='approved'))return;
  beginCheckout([card]);
});

$('#add-to-cart').addEventListener('click',()=>{
  const card=findProductCard(state.selectedId);
  if(!card||card.isDemoListing||(card.isLive&&card.photoReviewStatus!=='approved'))return;
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


function refreshPhotoProofUI(){
  const proof=state.photoProof;
  const valid=Boolean(proof&&state.user&&proof.sellerId===state.user.id);
  const remaining=valid?Math.max(0,Math.ceil((Date.parse(proof.expires_at)-Date.now())/1000)):0;
  $('#sell-proof-details').classList.toggle('hidden',!valid);
  $('#sell-proof-code').textContent=valid?proof.proof_code:'';
  $('#sell-proof-countdown').textContent=!valid?'':remaining>0
    ?`Giltig i ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')} – ladda upp fotot innan tiden går ut.`
    :'Koden har gått ut. Generera en ny och ta ett nytt foto.';
  $('#sell-proof-photo').disabled=!valid||remaining===0||state.sellingBusy||Boolean(state.listingError);
}
setInterval(refreshPhotoProofUI,1000);

$('#sell-proof-generate').addEventListener('click',async()=>{
  if(!state.user||!authClient||state.sellingBusy)return;
  state.sellingBusy=true;
  setSellMessage('');
  renderAccountState();
  try{
    const sellerId=state.user.id;
    const {data,error}=await authClient.rpc('begin_listing_photo_proof');
    if(error)throw error;
    if(!data?.[0]?.challenge_id||!data[0].proof_code||!data[0].expires_at)throw Error('NO_PROOF_CODE');
    if(state.user?.id!==sellerId)throw Error('ACCOUNT_CHANGED');
    state.photoProof={...data[0],sellerId};
    $('#sell-proof-photo').value='';
    $('#sell-proof-photo-name').textContent='';
    setSellMessage('Skriv koden på papper och ta ett nytt foto med saldo och datum/klockslag.','info');
  }catch(error){
    console.error('Could not generate photo proof code',error);
    setSellMessage('Koden kunde inte genereras. Kontrollera att fotobevis-migreringen har körts i Supabase.','error');
  }finally{
    state.sellingBusy=false;
    renderAccountState();
  }
});

$('#sell-proof-photo').addEventListener('change',e=>{
  const file=e.target.files?.[0];
  $('#sell-proof-photo-name').textContent=file?`${file.name} · ${(file.size/1048576).toFixed(1)} MB`:'';
});

$('#sell-form').addEventListener('submit', async e => {
  e.preventDefault();
  if(!state.user||!authClient){
    state.pendingNavigation='sell';
    navTo('dashboard');
    setAuthMessage('Logga in eller skapa ett konto för att publicera en annons.','info');
    return;
  }
  if(state.sellingBusy)return;
  const proof=state.photoProof;
  const photo=$('#sell-proof-photo').files?.[0];
  if(!proof||proof.sellerId!==state.user.id||Date.parse(proof.expires_at)<=Date.now()){
    setSellMessage('Generera en ny engångskod. Den måste vara giltig när du skickar in fotot.','error');
    return;
  }
  if(!photo){
    setSellMessage('Välj ett nytaget foto som visar koden, saldot och datum/klockslag.','error');
    return;
  }
  const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo.type];
  if(!extension||photo.size>5*1024*1024||photo.size===0){
    setSellMessage('Fotot måste vara JPG, PNG eller WebP och högst 5 MB.','error');
    return;
  }
  const brand=$('#sell-brand').value, category=$('#sell-category').value, value=Number($('#sell-value').value), price=Number($('#sell-price').value);
  if(price >= value){toast('Priset måste vara lägre än presentkortets värde.');return;}
  const expiry=$('#sell-expiry').value;
  if(expiry<new Date().toISOString().slice(0,10)){setSellMessage('Välj ett giltighetsdatum som inte har passerat.','error');return;}
  state.sellingBusy=true;setSellMessage('');renderAccountState();
  try{
    const photoPath=`${state.user.id}/${proof.challenge_id}/${crypto.randomUUID()}.${extension}`;
    const {error:uploadError}=await authClient.storage.from('passiton-photo-proofs')
      .upload(photoPath,photo,{upsert:false,contentType:photo.type,cacheControl:'0'});
    if(uploadError)throw uploadError;
    const {error}=await authClient.rpc('create_gift_card_listing',{
      p_brand:brand,
      p_category:category,
      p_value:value,
      p_price:price,
      p_expires_on:expiry,
      p_gift_card_code:$('#sell-code').value.trim(),
      p_proof_challenge_id:proof.challenge_id,
      p_proof_photo_path:photoPath
    });
    if(error)throw error;

    e.target.reset();
    state.photoProof=null;
    $('#sell-proof-photo-name').textContent='';
    refreshPhotoProofUI();
    expiryInput.value=future.toISOString().slice(0,10);
    $('#sell-value').value=1000;
    $('#sell-price').value=900;
    updateSellerPreview();
    setSellMessage('Annonsen har skickats för manuell fotogranskning. Den syns inte för köpare ännu.','success');
    try{await refreshMarketplaceListings();}catch{}
    toast('Annons inskickad för granskning.');
    navTo('dashboard');
  }catch(error){
    const detail=String(error?.message||'').toLowerCase();
    const needsMigration=error?.code==='PGRST202'||error?.code==='PGRST205'||error?.code==='42P01'||detail.includes('create_gift_card_listing');
    const expired=detail.includes('photo proof code has expired')||detail.includes('photo proof code')||detail.includes('freshly uploaded proof photo');
    setSellMessage(needsMigration
      ?'Fotobevis kräver den nya Supabase-migreringen. Följ backend/README.md.'
      :expired?'Koden eller fotot är inte längre giltigt. Generera en ny kod och ta ett nytt foto.'
      :'Fotot eller annonsen kunde inte skickas. Kontrollera uppladdningen och försök igen.','error');
  }finally{
    state.sellingBusy=false;
    renderAccountState();
  }
});

function activityHTML(item,type){
  const savings=item.value-item.price;
  const listingStatus=item.isLive?(item.photoReviewStatus==='approved'?'Foto granskat':item.photoReviewStatus==='rejected'?'Foto underkänt':'Väntar på granskning'):'Demoannons';
  const activityLabel=type==='purchase'?(item.orderId?`Demoorder · ${escapeHTML(item.orderId)}`:'Köpt i demon'):`${listingStatus} · giltig till ${escapeHTML(item.expiry)}`;
  const amountLabel=type==='purchase'?'Sparat '+money(savings):item.isLive?'Visa annons →':'Visa demo →';
  const rowContent=`<div class="activity-brand brand-${item.cls}">${escapeHTML(item.brand)}</div><div class="activity-copy"><strong>${escapeHTML(item.brand)} presentkort</strong><span>Värde ${money(item.value)} · ${activityLabel}</span></div><div class="activity-amount"><strong>${money(item.price)}</strong><span>${amountLabel}</span></div>`;
  if(type==='listing'){
    const description=item.isLive?'Visa din annons och granskningsstatus':'Visa demoannons';
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
  window.passitonListingManagement?.refresh();
  window.passitonPriceOffers?.refresh();
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
  const itemType=item.isLive?(item.photoReviewStatus==='approved'?'Fotobevis granskat':'Ej granskad'):'Demokort';
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
  if(!items.some(item=>item.offerCheckout))state.offerCheckoutId=null;
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

$('#checkout-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const items=state.checkoutItems;
  if(!items.length){
    navTo('cart');
    return;
  }

  if(state.checkoutBusy)return;
  const liveItems=items.filter(item=>item.isLive);
  if(liveItems.length&&(!state.user||!authClient)){
    toast('Logga in för att skapa en demoorder som kan reklameras.');
    state.pendingNavigation='checkout';
    navTo('dashboard');
    return;
  }
  const buyerName=e.currentTarget.elements['buyer-name'].value.trim();
  const orderNumber=`DEMO-${Date.now().toString(36).toUpperCase()}`;
  const boughtAt=new Date().toISOString();
  const profileItems=[];
  state.checkoutBusy=true;
  const submit=$('#checkout-form button[type="submit"]');
  submit.disabled=true;
  try {
    let demoIds=[];
    if(liveItems.length) {
      if(state.offerCheckoutId){
        if(items.length!==1||liveItems.length!==1)throw Error('Prisförslag måste köpas separat');
        const {data,error}=await authClient.rpc('demo_buy_accepted_offer',{
          p_offer_id:state.offerCheckoutId
        });
        if(error)throw error;
        if(data?.already_purchased)throw Error('Erbjudandet har redan köpts');
        if(!data?.order_id||!Number.isFinite(Number(data.price)))throw Error('Ogiltigt svar för budköp');
        items[0].price=Number(data.price);
        demoIds=[data.order_id];
      }else{
        const {data,error}=await authClient.rpc('demo_create_orders',{
          p_listing_ids:liveItems.map(item=>item.listingId)
        });
        if(error)throw error;
        if(!Array.isArray(data)||data.length!==liveItems.length)throw Error('Unexpected demo order response');
        demoIds=data;
      }
    }
    let liveIndex=0;
    for(const item of items) {
      const demoOrderId=item.isLive?demoIds[liveIndex++]:null;
      profileItems.push({...item,boughtAt,orderId:orderNumber,demoOrder:true,demoOrderId});
    }
  } catch(error) {
    console.error('Could not create demo order',error);
    toast('Demoorder kunde inte skapas. Kontrollera Supabase-migreringen. Inget har debiterats.');
    return;
  } finally {
    state.checkoutBusy=false;
    submit.disabled=false;
  }
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
  state.offerCheckoutId=null;
  updateBag();
  navTo('order-complete');
  refreshMarketplaceListings().catch(()=>{});
  window.passitonPriceOffers?.refresh();
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
    .select('id,seller_id,seller_name,brand,category,value,price,expires_on,created_at,status,photo_review_status')
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
    photoReviewStatus:row.photo_review_status,
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

  const locked=!authClient||state.authBusy||state.sellingBusy||Boolean(state.authUnavailable);
  $('#auth-form').querySelectorAll('input,button').forEach(control=>{control.disabled=locked;});
  $('#sign-out').disabled=state.authBusy;
  $('#sell-form').querySelectorAll('input,select,button').forEach(control=>{control.disabled=locked||!signedIn||Boolean(state.listingError);});
  if(state.photoProof&&state.photoProof.sellerId!==state.user?.id)state.photoProof=null;
  refreshPhotoProofUI();
  window.passitonPriceOffers?.onAuthChange();
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
        if(!state.user)window.passitonResetDisputes?.();
        renderAccountState();
        if($('#dashboard').classList.contains('active'))renderDashboard();
        continuePendingNavigation();
      });
      authClient.auth.getSession().then(async({data,error})=>{
        if(error)state.authUnavailable='Kunde inte ansluta till kontotjänsten. Kontrollera Supabase-konfigurationen och försök igen.';
        else state.authUnavailable='';
        state.authReady=true;
        state.user=data?.session?.user||null;
        renderAccountState();
        if(!error){
          try{await refreshMarketplaceListings();}catch{}
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
      window.passitonLoadDisputes?.();
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

$('#sign-out').addEventListener('click',async()=>{
  if(!authClient)return;
  state.authBusy=true;renderAccountState();
  try{
    const {error}=await authClient.auth.signOut();
    if(error)throw error;
    state.user=null;
    window.passitonResetDisputes?.();
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
