/* GTM dataLayer events for Passiton.
 * No personal data, gift-card codes, search text or transaction identifiers.
 * Configure GA4 consent rules in GTM before publishing.
 */
(function(){
  'use strict';
  const allowedEvents = new Set([
    'passiton_virtual_page_view', 'passiton_view_listing', 'passiton_add_to_cart',
    'passiton_begin_demo_checkout', 'passiton_demo_order_complete',
    'passiton_listing_submitted', 'passiton_signup_requested',
    'passiton_login', 'passiton_search'
  ]);
  const allowedFields = new Set([
    'page_title', 'page_path', 'page_location', 'item_brand', 'item_category',
    'listing_type', 'item_count', 'search_length'
  ]);
  const views = {
    market:'Köp', product:'Presentkort', sell:'Sälj', cart:'Varukorg',
    checkout:'Demo-kassa', 'order-complete':'Demoorder klar',
    dashboard:'Mitt konto', disputes:'Reklamationer', how:'Så fungerar det', about:'Om oss'
  };
  function track(event, fields = {}) {
    if(!allowedEvents.has(event))return;
    const payload = {event};
    for(const [key,value] of Object.entries(fields)){
      if(!allowedFields.has(key))continue;
      if(typeof value==='string' && value.length<=100)payload[key]=value;
      else if(typeof value==='number' && Number.isInteger(value) && value>=0 && value<=10000)payload[key]=value;
    }
    window.dataLayer=window.dataLayer||[];
    window.dataLayer.push(payload);
  }
  function virtualPageView(view){
    if(!Object.prototype.hasOwnProperty.call(views,view))return;
    // Avoid query strings: Supabase authentication sometimes adds sensitive parameters.
    const path=window.location.pathname+'#'+view;
    track('passiton_virtual_page_view',{
      page_title:'Passiton | '+views[view],
      page_path:path,
      page_location:window.location.origin+path
    });
  }
  window.passitonAnalytics={track,virtualPageView};
})();
