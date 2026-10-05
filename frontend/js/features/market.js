import { $, $$, money, pct, escapeHTML } from '../utils.js';
import { state } from '../state.js';
import { cards } from '../data/cards.js';
import { navTo } from '../ui.js';
import { openProduct } from './product.js';

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

export function renderMarket(){
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


export function initMarket() {
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

}
