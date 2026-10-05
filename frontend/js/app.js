import { $$ } from './utils.js';
import { navTo } from './ui.js';
import { initMarket, renderMarket } from './features/market.js';
import { initProduct } from './features/product.js';
import { initSell } from './features/sell.js';
import { renderDashboard } from './features/dashboard.js';
import { initAccount } from './features/account.js';

$$('[data-nav]').forEach(button => {
  button.addEventListener('click', () => navTo(button.dataset.nav));
});
document.addEventListener('viewchange', event => {
  if (event.detail === 'market') renderMarket();
  if (event.detail === 'dashboard') renderDashboard();
});
initMarket();
initProduct();
initSell();
initAccount();
renderMarket();
renderDashboard();
