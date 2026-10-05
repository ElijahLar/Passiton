import { state } from './state.js';

export function savePurchases() {
  localStorage.setItem('passiton-purchases', JSON.stringify(state.purchases));
}

export function saveListings() {
  localStorage.setItem('passiton-listings', JSON.stringify(state.listings));
}
