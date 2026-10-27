const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/listing-management.js'), 'utf8');
const listing = (overrides={}) => ({
  id:'11111111-1111-4111-8111-111111111111',
  brand:'IKEA', value:1000, price:850, expires_on:'2030-12-31',
  status:'active', photo_review_status:'approved', photo_review_reason:null,
  ...overrides
});
const queueItem = {
  listing_id:'22222222-2222-4222-8222-222222222222',
  brand:'SJ', face_value:500, asking_price:400, expires_on:'2030-12-31',
  listing_status:'active', submitted_at:'2026-10-27T08:00:00Z',
  photo_path:'seller/challenge/image.jpg', proof_code:'PASS-TEST123'
};

function harness({admin=false,own=[listing()],queue=[]}={}) {
  const elements = new Map();
  const calls=[];
  const make = id => ({
    id, innerHTML:'', textContent:'', dataset:{}, disabled:false,
    classList:{values:new Set(),add(x){this.values.add(x)},remove(x){this.values.delete(x)},toggle(x,on){if(on)this.values.add(x);else this.values.delete(x)}},
    replaceChildren(){this.innerHTML=''},
    querySelectorAll(){return []},
    addEventListener(_,fn){this.clickHandler=fn}
  });
  for(const id of ['listing-management','lm-own-list','lm-admin-panel','lm-admin-list','lm-status','lm-admin-status','lm-page','lm-prev','lm-next'])elements.set(id,make(id));
  const rpc = async (name,args)=>{
    calls.push({name,args});
    if(name==='is_passiton_admin')return {data:admin,error:null};
    if(name==='admin_listing_review_queue')return {data:queue,error:null};
    return {data:null,error:null};
  };
  const authClient={
    rpc,
    from(name){
      assert.equal(name,'gift_card_listings');
      return {select(){return this},eq(){return this},order(){return this},limit:async()=>({data:own,error:null})};
    },
    storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/signed/short-lived'},error:null})}}},
    auth:{onAuthStateChange(){},getSession:()=>new Promise(()=>{})}
  };
  const document={getElementById:id=>elements.get(id)};
  const state={user:{id:'buyer-1'}};
  const window={confirm:()=>true,prompt:()=> 'Fotot visar inte rätt kod.'};
  const context={document,state,window,authClient,console,queueMicrotask,
    escapeHTML:x=>String(x).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    money:n=>`${n} kr`,refreshMarketplaceListings:async()=>{}};
  vm.runInNewContext(source,context);
  return {elements,calls,state,window,root:elements.get('listing-management')};
}

test('seller sees own rows and administrator queue is hidden', async () => {
  const h=harness({own:[listing({brand:'IKEA <bad>'})]});
  await h.window.passitonListingManagement.refresh();
  const html=h.elements.get('lm-own-list').innerHTML;
  assert.match(html,/IKEA &lt;bad&gt;/);
  assert.match(html,/Spara pris/);
  assert.match(html,/Pausa/);
  assert.match(html,/Ta bort/);
  assert.equal(h.elements.get('lm-admin-panel').classList.values.has('hidden'),true);
  assert.equal(h.calls.filter(c=>c.name==='admin_listing_review_queue').length,0);
});

test('seller action uses authenticated RPC, not direct table update', async () => {
  const h=harness();
  await h.window.passitonListingManagement.refresh();
  const article={dataset:{lmId:listing().id},querySelector(){return {value:'750'}}};
  const control={dataset:{lmAction:'price'},closest(selector){return selector==='button'?this:selector==='[data-lm-id]'?article:null}};
  await h.root.clickHandler({target:control});
  assert.equal(h.calls.filter(c=>c.name==='manage_own_listing').length,1);
  const item=h.calls.find(c=>c.name==='manage_own_listing');
  assert.equal(item.args.p_listing_id,listing().id);
  assert.equal(item.args.p_action,'price');
  assert.equal(item.args.p_price,750);
});

test('rejected and removed listings have no edit / resume buttons', async () => {
  const h=harness({own:[listing({status:'removed',photo_review_status:'rejected',photo_review_reason:'Felaktig bild'})]});
  await h.window.passitonListingManagement.refresh();
  const html=h.elements.get('lm-own-list').innerHTML;
  assert.doesNotMatch(html,/Spara pris/);
  assert.doesNotMatch(html,/Återaktivera/);
  assert.match(html,/Felaktig bild/);
});

test('admin can review only with server RPC and a reason for rejection', async () => {
  const h=harness({admin:true,queue:[queueItem]});
  await h.window.passitonListingManagement.refresh();
  assert.match(h.elements.get('lm-admin-list').innerHTML,/PASS-TEST123/);
  assert.equal(h.elements.get('lm-admin-panel').classList.values.has('hidden'),false);
  const article={dataset:{lmReviewId:queueItem.listing_id}};
  const control={dataset:{lmDecision:'rejected'},closest(selector){return selector==='button'?this:selector==='[data-lm-review-id]'?article:null}};
  await h.root.clickHandler({target:control});
  const action=h.calls.find(c=>c.name==='admin_review_listing');
  assert.equal(action.args.p_decision,'rejected');
  assert.match(action.args.p_reason,/Fotot visar inte/);
});

test('signed-out user sees no listing manager',async()=>{
  const h=harness();
  h.state.user=null;
  await h.window.passitonListingManagement.refresh();
  assert.equal(h.elements.get('listing-management').classList.values.has('hidden'),true);
});


test('pending unreviewed listing may be resumed after pause', async () => {
  const h=harness({own:[listing({status:'paused',photo_review_status:'pending'})]});
  await h.window.passitonListingManagement.refresh();
  const html=h.elements.get('lm-own-list').innerHTML;
  assert.match(html,/Återaktivera/);
  assert.match(html,/Fotogranskningen är pausad/);
  assert.doesNotMatch(html,/data-lm-action="pause"/);
  const article={dataset:{lmId:listing().id},querySelector(){return {value:'850'}}};
  const control={dataset:{lmAction:'resume'},closest(selector){return selector==='button'?this:selector==='[data-lm-id]'?article:null}};
  await h.root.clickHandler({target:control});
  const action=h.calls.find(c=>c.name==='manage_own_listing');
  assert.equal(action.args.p_action,'resume');
});

test('rejected paused listing cannot be resumed', async () => {
  const h=harness({own:[listing({status:'paused',photo_review_status:'rejected'})]});
  await h.window.passitonListingManagement.refresh();
  assert.doesNotMatch(h.elements.get('lm-own-list').innerHTML,/Återaktivera/);
});

test('no unnecessary refresh button and admin area has no divider', () => {
  const html=fs.readFileSync(path.join(__dirname,'../frontend/index.html'),'utf8');
  assert.doesNotMatch(html,/id="lm-refresh"/);
  assert.match(html,/id="lm-admin-panel" class="lm-admin-panel hidden"/);
  assert.doesNotMatch(html,/<hr><div class="lm-header">/);
});

test('SQL refuses paused review and excludes paused pending listings from the queue', () => {
  const sql=fs.readFileSync(path.join(__dirname,'../backend/supabase/migrations/202610270002_pause_pending_listing_reviews.sql'),'utf8');
  assert.match(sql,/v_listing\.photo_review_status not in \('pending', 'approved'\)/);
  assert.match(sql,/and l\.status = 'active'/);
  assert.match(sql,/or v_listing\.status <> 'active'/);
});
