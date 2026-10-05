export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];
export const money = n => new Intl.NumberFormat('sv-SE').format(Math.round(n)) + ' kr';
export const pct = c => Math.round((1 - c.price / c.value) * 100);
export const escapeHTML = str => String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
