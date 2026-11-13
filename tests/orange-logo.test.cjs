const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname,'../frontend',file),'utf8');

const home=read('index.html');
const privacy=read('integritetspolicy.html');
const logo=read('assets/passiton-logo-orange.svg');
const css=read('css/passiton-logo.css');
const asset='assets/passiton-logo-orange.svg';

assert.match(logo,/<svg\s/);
assert.match(logo,/viewBox="0 0 823 303"/);
assert.match(logo,/fill="#FF8C00"/);
assert.match(logo,/fill-rule="evenodd"/);
assert.ok((logo.match(/M[0-9]+,/g)||[]).length>=8,'Logo outline must preserve separate letter shapes');
assert.match(home,/<button class="wordmark" data-nav="market" aria-label="Passiton startsida">[\s\S]*?<img src="assets\/passiton-logo-orange.svg"/);
assert.match(home,/<a class="footer-brand"[^>]+>[\s\S]*?<img src="assets\/passiton-logo-orange.svg"/);
assert.match(privacy,/<a class="privacy-brand"[^>]+>[\s\S]*?<img src="assets\/passiton-logo-orange.svg"/);
for(const html of [home,privacy]){
  assert.ok(html.includes(asset),'All brand locations should load one shared logo asset');
  assert.ok(html.includes('css/passiton-logo.css'),'Logo styling must be included');
  assert.ok(html.indexOf('css/passiton-logo.css')>html.indexOf('css/autumn-palette.css'),'Brand CSS must load last');
}
assert.match(css,/\.site-header \.wordmark img/);
assert.match(css,/@media\(max-width:820px\)/);
assert.match(home,/src="js\/navigation-history\.js"/);
assert.match(home,/href="integritetspolicy\.html"/);
console.log('Passiton orange logo regression checks passed');
