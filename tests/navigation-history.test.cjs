const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../frontend/js/navigation-history.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
const policy=fs.readFileSync(path.join(__dirname,'../frontend/integritetspolicy.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../frontend/js/app.js'),'utf8');

assert.match(html,/href="integritetspolicy\.html"/);
assert.match(html,/id="auth-policy-confirm" type="checkbox" required/);
assert.match(policy,/<h1>Integritetspolicy för Passiton<\/h1>/);
assert.match(policy,/PayPal-betalningar och utbetalningar används inte/);
assert.match(html,/src="js\/navigation-history\.js"/);
assert.ok(html.indexOf('js/navigation-history.js')>html.indexOf('js/dashboard-hub.js'));
assert.match(app,/\$\$\('\[data-nav\]'\)\.forEach/);
assert.match(app,/passitonNavigationHistory\?\.record\(id,state\.selectedId\)/);

let url=new URL('https://passiton.nu/frontend/index.html');
let currentIndex=0;
let navCalls=0;
const entries=[{state:null,url:url.href}];
const listeners={};
const page={id:'market'};
const selection={selectedId:'demo-1'};
const history={
  get state(){return entries[currentIndex].state;},
  replaceState(state,unused,next){
    if(next)url=new URL(next,url);
    entries[currentIndex]={state,url:url.href};
  },
  pushState(state,unused,next){
    url=new URL(next,url);
    ++currentIndex;
    entries.splice(currentIndex);
    entries.push({state,url:url.href});
  }
};
const window={
  history,
  location:{
    get pathname(){return url.pathname;},
    get search(){return url.search;},
    get hash(){return url.hash;}
  },
  addEventListener(name,fn){listeners[name]=fn;},
  passitonHub:{close(){}}
};
function navTo(view){
  ++navCalls;
  page.id=view;
  window.passitonNavigationHistory?.record(view,selection.selectedId);
}
function openProduct(id){
  selection.selectedId=id;
  navTo('product');
}
vm.runInNewContext(source,{
  window,document:{querySelector(selector){return selector==='.view.active'?page:null;}},
  URLSearchParams,findProductCard(id){return id?{id}:null;},
  state:selection,navTo,openProduct
});
assert.equal(history.state.passitonView,'market');
navTo('how');
openProduct('listing-abc');
assert.equal(currentIndex,2);
assert.equal(url.hash,'#passiton=product&id=listing-abc');
function travel(direction){
  currentIndex+=direction;
  url=new URL(entries[currentIndex].url);
  listeners.popstate({state:entries[currentIndex].state});
  listeners.hashchange();
}
const beforeBack=navCalls;
travel(-1);
assert.equal(page.id,'how');
assert.equal(navCalls,beforeBack+1,'Back must not restore twice');
travel(-1);
assert.equal(page.id,'market');
travel(1);
assert.equal(page.id,'how');
travel(1);
assert.equal(page.id,'product');
assert.equal(selection.selectedId,'listing-abc');
assert.equal(history.state.passitonView,'product');
console.log('Browser history and privacy page regression tests passed');
