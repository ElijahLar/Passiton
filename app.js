const cards = [
  { id: 1, brand: 'IKEA', category: 'Hem', categoryLabel: 'Hem & inredning', value: 1000, price: 880, expiry: '2027-12-31', use: 'Alla IKEA varuhus och ikea.se', cls: 'ikea', popular: 100 },
  { id: 2, brand: 'Zalando', category: 'Mode', categoryLabel: 'Mode', value: 1000, price: 850, expiry: '2027-09-30', use: 'Zalando.se', cls: 'zalando', popular: 95 },
  { id: 3, brand: 'H&M', category: 'Mode', categoryLabel: 'Mode', value: 500, price: 425, expiry: '2027-08-15', use: 'H&M butik och online', cls: 'hm', popular: 90 },
  { id: 4, brand: 'Elgiganten', category: 'Elektronik', categoryLabel: 'Elektronik', value: 2000, price: 1760, expiry: '2028-01-31', use: 'Elgiganten butik och online', cls: 'elgiganten', popular: 86 },
  { id: 5, brand: 'Stadium', category: 'Sport', categoryLabel: 'Sport & fritid', value: 750, price: 640, expiry: '2027-11-01', use: 'Stadium butik och online', cls: 'stadium', popular: 80 },
  { id: 6, brand: 'ICA', category: 'Mat', categoryLabel: 'Mat & dagligvaror', value: 1000, price: 940, expiry: '2027-10-01', use: 'Deltagande ICA-butiker', cls: 'ica', popular: 78 },
  { id: 7, brand: 'Åhléns', category: 'Mode', categoryLabel: 'Mode & skönhet', value: 800, price: 696, expiry: '2027-07-31', use: 'Åhléns butik och online', cls: 'ahlens', popular: 72 },
  { id: 8, brand: 'SJ', category: 'Resor', categoryLabel: 'Resor & transport', value: 500, price: 430, expiry: '2027-12-15', use: 'SJ.se och SJ-appen', cls: 'sj', popular: 70 },
  { id: 9, brand: 'IKEA', category: 'Hem', categoryLabel: 'Hem & inredning', value: 500, price: 445, expiry: '2028-03-01', use: 'Alla IKEA varuhus och ikea.se', cls: 'ikea', popular: 67 }
];

const state = {
  purchases: JSON.parse(localStorage.getItem('passiton-purchases') || '[]'),
  listings: JSON.parse(localStorage.getItem('passiton-listings') || '[]'),
  selectedId: 1,
  search: '',
  category: 'all',
  minDiscount: 0,
  sort: 'popular'
};

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const money = n => new Intl.NumberFormat('sv-SE').format(Math.round(n)) + ' kr';
const pct = c => Math.round((1 - c.price / c.value) * 100);
const escapeHTML = str => String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function navTo(id){
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
  window.scrollTo({top:0,behavior:'smooth'});
  if(id === 'market') renderMarket();
  if(id === 'dashboard') renderDashboard();
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
      <div><h3>${escapeHTML(card.brand)} presentkort</h3><p>Värde ${money(card.value)} · Verifierad</p></div>
      <div class="product-meta-price"><strong>${money(card.price)}</strong><span>Spara ${pct(card)}%</span></div>
    </div>
  </article>`;
}

function filteredCards(){
  let list = cards.filter(c => {
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
      openProduct(Number(card.dataset.cardId));
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
  const card = cards.find(c => c.id === id) || cards[0];
  state.selectedId = card.id;
  $('#gallery').innerHTML = galleryHTML(card);
  $('#breadcrumbs').innerHTML = `Köp <span>›</span> ${escapeHTML(card.categoryLabel)} <span>›</span> ${escapeHTML(card.brand)} <span>›</span> ${escapeHTML(card.brand)} presentkort`;
  $('#detail-title').textContent = `${card.brand} presentkort`;
  $('#detail-subtitle').textContent = `Digitalt presentkort för ${card.categoryLabel.toLowerCase()}`;
  $('#detail-value').textContent = money(card.value);
  $('#detail-price').textContent = money(card.price);
  $('#detail-save').textContent = `Spara ${pct(card)}%`;
  $('#fact-expiry').textContent = new Date(card.expiry).toLocaleDateString('sv-SE',{day:'numeric',month:'short',year:'numeric'});
  $('#fact-use').textContent = card.use;
  $('#about-copy').textContent = `${card.brand}-presentkortet levereras digitalt och kan användas hos ${card.use}. Ett enkelt sätt att få mer för pengarna.`;
  const suggested = Math.round(card.value * .90 / 10) * 10;
  const fee = Math.round(suggested * .05);
  $('#similar-sale').textContent = money(suggested);
  $('#similar-fee').textContent = money(fee);
  $('#similar-net').textContent = money(suggested - fee);
  $('#buy-now').textContent = `Köp nu · ${money(card.price)}`;
  navTo('product');
}

$('#back-to-market').addEventListener('click', () => navTo('market'));
$('#buy-now').addEventListener('click', () => {
  const card = cards.find(c => c.id === state.selectedId);
  state.purchases.unshift({...card,boughtAt:new Date().toISOString()});
  localStorage.setItem('passiton-purchases',JSON.stringify(state.purchases));
  updateBag();
  toast(`${card.brand}-presentkortet är köpt i demon ✓`);
  navTo('dashboard');
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

$('#sell-form').addEventListener('submit', e => {
  e.preventDefault();
  const brand=$('#sell-brand').value, category=$('#sell-category').value, value=Number($('#sell-value').value), price=Number($('#sell-price').value);
  if(price >= value){toast('Priset måste vara lägre än presentkortets värde.');return;}
  const listing={id:Date.now(),brand,category,value,price,expiry:$('#sell-expiry').value,cls:brandClass(brand),createdAt:new Date().toISOString()};
  state.listings.unshift(listing);localStorage.setItem('passiton-listings',JSON.stringify(state.listings));
  e.target.reset();expiryInput.value=future.toISOString().slice(0,10);$('#sell-value').value=1000;$('#sell-price').value=900;updateSellerPreview();
  toast('Demoannonsen är publicerad ✓');navTo('dashboard');
});

function activityHTML(item,type){
  const savings=item.value-item.price;
  return `<div class="activity-item"><div class="activity-brand brand-${item.cls}">${escapeHTML(item.brand)}</div><div class="activity-copy"><strong>${escapeHTML(item.brand)} presentkort</strong><span>Värde ${money(item.value)} · ${type==='purchase'?'Köpt i demon':'Giltig till '+item.expiry}</span></div><div class="activity-amount"><strong>${money(item.price)}</strong><span>${type==='purchase'?'Sparat '+money(savings):'Aktiv annons'}</span></div></div>`;
}
function renderDashboard(){
  const bought=state.purchases.reduce((s,p)=>s+p.value,0);const saved=state.purchases.reduce((s,p)=>s+(p.value-p.price),0);
  $('#stat-bought').textContent=money(bought);$('#stat-saved').textContent=money(saved);$('#stat-listed').textContent=state.listings.length;
  $('#purchase-list').innerHTML=state.purchases.length?state.purchases.map(i=>activityHTML(i,'purchase')).join(''):'<div class="empty-mini">Du har inte gjort något demoköp ännu.</div>';
  $('#listing-list').innerHTML=state.listings.length?state.listings.map(i=>activityHTML(i,'listing')).join(''):'<div class="empty-mini">Du har inga aktiva demoannonser.</div>';
  updateBag();
}
function updateBag(){const count=state.purchases.length;$('#bag-count').textContent=count;$('#bag-count').classList.toggle('hidden',!count)}
let toastTimer;function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),2600)}

renderMarket();renderDashboard();updateBag();
