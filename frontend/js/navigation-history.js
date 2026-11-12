/* Browser Back/Forward history for Passiton SPA views.
 * Keep browser authentication fragments untouched; only our own #passiton= routes
 * are read as navigation targets. Never store customer details in route state.
 */
(function(){
  'use strict';
  const allowed=new Set(['market','product','sell','dashboard','cart','checkout','order-complete','how','about']);
  let restoring=false;
  let pendingProduct=null;

  function routeHash(view,productId){
    return '#passiton='+encodeURIComponent(view)+(view==='product'&&productId!=null?'&id='+encodeURIComponent(String(productId)):'');
  }
  function routeFromURL(){
    const hash=window.location.hash;
    if(!hash.startsWith('#passiton='))return null;
    const params=new URLSearchParams(hash.slice(1));
    const view=params.get('passiton');
    if(!allowed.has(view))return null;
    return {view, productId:params.get('id')};
  }
  function routeFromEntry(entry){
    if(entry&&allowed.has(entry.passitonView)){
      return {view:entry.passitonView,productId:entry.passitonProduct??null};
    }
    return routeFromURL()||{view:'market',productId:null};
  }
  function restore(route){
    restoring=true;
    try{
      window.passitonHub?.close();
      if(route.view==='product'){
        if(!route.productId||!findProductCard(route.productId)){
          if(route.productId){pendingProduct=route.productId;navTo('market');}
          else navTo('market');
        }else{
          pendingProduct=null;
          openProduct(route.productId);
        }
      }else{
        pendingProduct=null;
        navTo(allowed.has(route.view)?route.view:'market');
      }
    }finally{
      restoring=false;
    }
  }
  function record(view,productId){
    if(restoring||!allowed.has(view))return;
    const product=view==='product'?String(productId??''):null;
    const previous=window.history.state;
    if(previous&&previous.passitonView===view&&(view!=='product'||String(previous.passitonProduct??'')===product))return;
    window.history.pushState({
      passitonView:view,passitonProduct:product
    },'',window.location.pathname+window.location.search+routeHash(view,product));
  }
  function retryPendingProduct(){
    if(!pendingProduct||!findProductCard(pendingProduct))return;
    if(routeFromEntry(window.history.state).view!=='product'){
      pendingProduct=null;
      return;
    }
    const id=pendingProduct;
    pendingProduct=null;
    restore({view:'product',productId:id});
  }

  window.passitonNavigationHistory={record,retryPendingProduct,isRestoring:()=>restoring};
  window.addEventListener('popstate',event=>restore(routeFromEntry(event.state)));
  // A manually edited fragment can change without a popstate event.
  window.addEventListener('hashchange',()=>{
    if(!window.location.hash.startsWith('#passiton='))return;
    const route=routeFromURL();
    if(route){
      window.history.replaceState({passitonView:route.view,passitonProduct:route.productId??null},'');
      restore(route);
    }
  });

  const initial=routeFromURL();
  if(initial){
    window.history.replaceState({passitonView:initial.view,passitonProduct:initial.productId??null},'');
    restore(initial);
  }else if(!window.history.state?.passitonView){
    // Preserves Supabase recovery/login fragments and any existing query string.
    window.history.replaceState({passitonView:'market',passitonProduct:null},'');
  }
})();
