import { $, money, escapeHTML } from '../utils.js';
import { state } from '../state.js';
import { updateBag } from '../ui.js';

function activityHTML(item,type){
  const savings=item.value-item.price;
  return `<div class="activity-item"><div class="activity-brand brand-${item.cls}">${escapeHTML(item.brand)}</div><div class="activity-copy"><strong>${escapeHTML(item.brand)} presentkort</strong><span>Värde ${money(item.value)} · ${type==='purchase'?'Köpt i demon':'Giltig till '+item.expiry}</span></div><div class="activity-amount"><strong>${money(item.price)}</strong><span>${type==='purchase'?'Sparat '+money(savings):'Aktiv annons'}</span></div></div>`;
}
export function renderDashboard(){
  const bought=state.purchases.reduce((s,p)=>s+p.value,0);const saved=state.purchases.reduce((s,p)=>s+(p.value-p.price),0);
  $('#stat-bought').textContent=money(bought);$('#stat-saved').textContent=money(saved);$('#stat-listed').textContent=state.listings.length;
  $('#purchase-list').innerHTML=state.purchases.length?state.purchases.map(i=>activityHTML(i,'purchase')).join(''):'<div class="empty-mini">Du har inte gjort något demoköp ännu.</div>';
  $('#listing-list').innerHTML=state.listings.length?state.listings.map(i=>activityHTML(i,'listing')).join(''):'<div class="empty-mini">Du har inga aktiva demoannonser.</div>';
  updateBag();
}
