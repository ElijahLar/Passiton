import { $, money, pct, escapeHTML } from '../utils.js';
import { state } from '../state.js';
import { cards } from '../data/cards.js';
import { navTo, updateBag, toast } from '../ui.js';
import { savePurchases } from '../storage.js';

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

export function openProduct(id){
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


export function initProduct() {
  $('#back-to-market').addEventListener('click', () => navTo('market'));
  $('#buy-now').addEventListener('click', () => {
    const card = cards.find(c => c.id === state.selectedId);
    state.purchases.unshift({...card,boughtAt:new Date().toISOString()});
    savePurchases();
    updateBag();
    toast(`${card.brand}-presentkortet är köpt i demon ✓`);
    navTo('dashboard');
  });

}
