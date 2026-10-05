import { $, $$ } from './utils.js';
import { state } from './state.js';

export function navTo(id){
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
  window.scrollTo({top:0,behavior:'smooth'});
  document.dispatchEvent(new CustomEvent('viewchange', { detail: id }));
}

export function updateBag(){const count=state.purchases.length;$('#bag-count').textContent=count;$('#bag-count').classList.toggle('hidden',!count)}
let toastTimer;export function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),2600)}
