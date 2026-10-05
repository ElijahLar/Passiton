import { $, money } from '../utils.js';
import { state } from '../state.js';
import { navTo, toast } from '../ui.js';
import { saveListings } from '../storage.js';

export function initSell() {
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
    state.listings.unshift(listing);saveListings();
    e.target.reset();expiryInput.value=future.toISOString().slice(0,10);$('#sell-value').value=1000;$('#sell-price').value=900;updateSellerPreview();
    toast('Demoannonsen är publicerad ✓');navTo('dashboard');
  });

}
