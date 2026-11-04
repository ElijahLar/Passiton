const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../frontend/js/analytics.js'),'utf8');
const browser={dataLayer:[],location:{origin:'https://www.passiton.nu',pathname:'/frontend/'}};
vm.runInNewContext(source,{window:browser});
browser.passitonAnalytics.virtualPageView('product');
assert.equal(browser.dataLayer[0].event,'passiton_virtual_page_view');
assert.equal(browser.dataLayer[0].page_location,'https://www.passiton.nu/frontend/#product');
browser.passitonAnalytics.track('passiton_search',{search_length:8,email:'private@example.com'});
assert.equal(browser.dataLayer[1].search_length,8);
assert.equal(Object.prototype.hasOwnProperty.call(browser.dataLayer[1],'email'),false);
browser.passitonAnalytics.track('purchase',{value:100});
assert.equal(browser.dataLayer.length,2);
// Regression for the production-breaking selector typo in PR #5:
const appSource=fs.readFileSync(path.join(__dirname,'../frontend/js/app.js'),'utf8');
assert.match(appSource,/^\$\$\('\[data-nav\]'\)\.forEach\(/m,
  'Navigation must use $ (querySelectorAll array), not $ (single element)');
assert.doesNotMatch(appSource,/^\$\('\[data-nav\]'\)\.forEach\(/m);
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
assert.ok(html.indexOf('js/data/cards.js')<html.indexOf('js/app.js'),
  'Product data must load before app initialization');
assert.ok(html.indexOf('js/analytics.js')<html.indexOf('js/app.js'),
  'Analytics helper must load before instrumented app');
console.log('Passiton analytics and navigation regression smoke tests passed');
