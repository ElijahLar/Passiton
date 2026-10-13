/* PassItOn demo disputes. All money and delivery states are SIMULATED.
 * Authorization and state transitions live in Supabase RPCs and RLS, never the UI.
 */
(() => {
  const el = (id) => document.getElementById(id);
  const s = { orders: [], cases: [], messages: [], fraudReviews: [], admin: false, orderId: null, loading: false, busy: false, userId: null };
  const safe = (value) => escapeHTML(String(value ?? ''));
  const date = (value) => value ? new Date(value).toLocaleString('sv-SE',{dateStyle:'short',timeStyle:'short'}) : '—';
  const activeOrder = () => s.orders.find(o => o.id === s.orderId);
  const activeCase = () => s.cases.find(d => d.order_id === s.orderId);
  const buyer = (order) => order && order.buyer_id === state.user?.id;
  const statusText = (order, dispute) =>
    dispute?.status === 'escalated' ? 'Eskalering till PassItOn' :
    dispute?.status === 'open' ? 'Dispyt pågår' :
    dispute?.status === 'resolved' ? 'Dispyt avslutad' :
    order.status === 'held' ? 'Väntar på bekräftelse (demo)' :
    order.status === 'refunded' ? 'Återbetald (simulerad)' : 'Frigjord (simulerad)';
  const fail = (error) => {
    console.error('PassItOn disputes:', error);
    el('dispute-notice').textContent = error?.message?.includes('Could not find') ||
      /PGRST20[25]|42P01|42883/.test(error?.code||'')
      ? 'Databasen saknar dispytsystemet. Kör SQL-migreringen 202610130002_add_demo_disputes.sql i Supabase.'
      : 'Åtgärden misslyckades: ' + (error?.message || 'Försök igen.');
    el('dispute-notice').classList.remove('hidden');
    el('dispute-notice').dataset.tone='error';
  };
  const note = (message) => {
    el('dispute-notice').textContent=message;
    el('dispute-notice').classList.toggle('hidden',!message);
    el('dispute-notice').dataset.tone='info';
  };
  const request = async (fn,args={}) => {
    const {data,error}=await authClient.rpc(fn,args);
    if(error)throw error;
    return data;
  };
  const withBusy = async (work) => {
    if(s.busy)return;
    s.busy=true;
    try{await work();}catch(e){fail(e);}
    finally{s.busy=false;}
  };
  const setSelected = (id) => {
    el('dispute-checklist').querySelectorAll('input[type="checkbox"]').forEach(input=>{input.checked=false;});
    s.orderId=id;
    el('dispute-start-form').classList.add('hidden');
    render();
    loadThread();
  };

  async function load({refresh=true}={}){
    const user=state.user;
    s.userId=user?.id||null;
    el('dispute-guest-note').classList.toggle('hidden',!!user);
    el('dispute-content').classList.toggle('hidden',!user);
    if(!user||!authClient){
      s.orders=[];s.cases=[];s.messages=[];s.orderId=null;s.admin=false;
      return;
    }
    if(s.loading)return;
    s.loading=true;
    if(refresh)note('Laddar dina demoorder och ärenden…');
    try{
      await request('demo_settle_expired_orders');
      const [o,d,a]=await Promise.all([
        authClient.from('demo_orders').select('id,listing_id,buyer_id,seller_id,brand,card_value,price,status,delivered_at,review_deadline,created_at').order('created_at',{ascending:false}),
        authClient.from('demo_disputes').select('id,order_id,buyer_id,seller_id,reason,status,outcome,opened_at,escalated_at,resolved_at').order('opened_at',{ascending:false}),
        request('is_passiton_admin')
      ]);
      if(o.error)throw o.error;
      if(d.error)throw d.error;
      if(state.user?.id!==s.userId)return;
      s.orders=o.data||[];
      s.cases=d.data||[];
      s.admin=Boolean(a);
      s.fraudReviews=s.admin?(await request('demo_get_fraud_reviews'))||[]:[];
      // A seller or buyer cannot open a case that has no matching authorized order.
      if(s.orderId&&!s.orders.some(x=>x.id===s.orderId))s.orderId=null;
      if(!s.orderId&&s.orders.length)s.orderId=s.orders[0].id;
      note('');
      render();
      if(s.orderId)await loadThread();
    }catch(e){fail(e);}
    finally{s.loading=false;}
  }

  function renderList(){
    const host=el('dispute-orders-list');
    host.innerHTML=s.orders.length?s.orders.map(order=>{
      const dispute=s.cases.find(d=>d.order_id===order.id);
      const selected=order.id===s.orderId?' active':'';
      return '<button class="dispute-order-row'+selected+'" data-dispute-order="'+safe(order.id)+'" type="button">'+
        '<span class="dispute-order-label">'+safe(order.brand)+' · '+(buyer(order)?'Köp':'Försäljning')+'</span>'+
        '<strong>'+money(order.price)+'</strong>'+
        '<small>'+safe(statusText(order,dispute))+' · '+safe(date(order.created_at))+'</small>'+
        '</button>';
    }).join(''):'<p class="dispute-empty-list">Inga demoorder ännu. Prova demo-kassan på en granskad säljarannons.</p>';

    el('dispute-admin-panel').classList.toggle('hidden',!s.admin);
    if(s.admin){
      const escalated=s.cases.filter(d=>d.status==='escalated');
      el('dispute-admin-list').innerHTML=escalated.length?escalated.map(d=>{
        const order=s.orders.find(o=>o.id===d.order_id);
        return '<button class="dispute-order-row" data-dispute-order="'+safe(d.order_id)+'" type="button">'+
          '<strong>#'+safe(d.id.slice(0,8).toUpperCase())+' · '+safe(order?.brand||'Order')+'</strong>'+
          '<small>Eskalering · '+safe(date(d.escalated_at))+'</small></button>';
      }).join(''):'<p class="dispute-empty-list">Inga eskalerade ärenden.</p>';
      const flagged=s.fraudReviews.filter(f=>!f.police_reported_at);
      if(flagged.length)el('dispute-admin-list').innerHTML+='<h3 class="dispute-subheading">Intern bedrägerigranskning</h3>'+flagged.map(f=>{
        const d=s.cases.find(x=>x.id===f.dispute_id);
        return d?'<button class="dispute-order-row" data-dispute-order="'+safe(d.order_id)+'" type="button"><strong>Intern granskning #'+safe(d.id.slice(0,8))+'</strong><small>'+safe(date(f.flagged_at))+'</small></button>':'';
      }).join('');
    }
  }

  function render(){
    renderList();
    const order=activeOrder(), d=activeCase();
    el('dispute-empty').classList.toggle('hidden',!!order);
    el('dispute-detail').classList.toggle('hidden',!order);
    if(!order)return;
    const isBuyer=buyer(order);
    const allowed=order.status==='held' && Date.parse(order.review_deadline)>Date.now() && !d;
    el('dispute-order-ref').textContent='DEMO #'+order.id.slice(0,8).toUpperCase();
    el('dispute-order-title').textContent=order.brand+' · '+money(order.price);
    el('dispute-order-meta').textContent=(isBuyer?'Du är köpare':s.admin&&state.user?.id!==order.seller_id?'Adminvy':'Du är säljare')+
      ' · Skapad '+date(order.created_at);
    el('dispute-order-status').textContent=statusText(order,d);
    const meta=el('dispute-order-instructions');
    meta.textContent=d?
      'Reklamation: '+({invalid_code:'Koden fungerar inte',wrong_balance:'Fel saldo',expired:'Utgånget presentkort',
        not_received:'Presentkort saknas',other:'Annat'}[d.reason]||d.reason)+
        '. Inga pengar flyttas i demon. En öppen dispyt blockerar simulerad automatisk frigöring.' :
      order.status==='held'?'Simulerad kontrolltid till '+date(order.review_deadline)+
        '. Köparen kan godkänna eller reklamera före tidsfristen. Inga riktiga presentkort levereras i demon.' :
      'Demoordern är avslutad. Inga pengar eller presentkortskoder har överförts.';
    const checklist=el('dispute-checklist');
    checklist.classList.toggle('hidden',!(!d&&allowed&&isBuyer));
    const checklistComplete=[...checklist.querySelectorAll('input')].every(input=>input.checked);
    const actions=el('dispute-actions');
    actions.innerHTML=!d&&allowed&&isBuyer
      ? '<button id="dispute-approve" type="button" class="secondary-cta inline-cta" '+(checklistComplete?'':'disabled title="Markera samtliga kontrollpunkter först"')+'>Godkänn demoorder</button>'+
        '<button id="dispute-open" type="button" class="primary-cta inline-cta">Jag har ett problem</button>'
      : '';
    el('dispute-start-form').classList.toggle('hidden',!el('dispute-start-form').dataset.open || !!d || !allowed);
    el('dispute-thread-panel').classList.toggle('hidden',!d);
    if(d) {
      el('dispute-thread-state').textContent=d.status==='escalated'?
        'Ärendet granskas av PassItOn.' : d.status==='resolved'?
        'Ärendet avslutades '+date(d.resolved_at)+'.' : 'Köparen och säljaren försöker lösa problemet.';
      el('dispute-message-form').classList.toggle('hidden',d.status==='resolved');
      const escalate=el('dispute-escalate');
      const canEscalate=d.status==='open' &&
        (state.user?.id===d.buyer_id||state.user?.id===d.seller_id);
      escalate.classList.toggle('hidden',!canEscalate);
      const sellerReplied=s.messages.some(m=>m.author_id===d.seller_id&&m.kind==='message');
      escalate.disabled=canEscalate && !sellerReplied &&
        Date.parse(d.opened_at)+24*3600000>Date.now();
      escalate.title=escalate.disabled?'Vänta 24 timmar eller tills säljaren svarar':'Skicka till admin';
      const c=el('dispute-resolution-actions');
      const fraud=s.fraudReviews.find(f=>f.dispute_id===d.id);
      c.innerHTML=(d.status==='resolved'?
        '<p class="dispute-done">Beslut: '+safe(d.outcome==='refund_simulated'?'Simulerad återbetalning':
          d.outcome==='release_simulated'?'Simulerad utbetalning':'Köparen drog tillbaka ärendet')+'</p>' :
        (isBuyer?'<button type="button" data-dispute-action="withdraw" class="secondary-cta inline-cta">Dra tillbaka dispyt</button>':'')+
        (s.admin && d.status==='escalated'?
          '<button type="button" data-dispute-action="release" class="secondary-cta inline-cta">Admin: Frigör (demo)</button>'+
          '<button type="button" data-dispute-action="refund" class="primary-cta inline-cta">Admin: Återbetala (demo)</button>':''))
        +(s.admin&&d.escalated_at?
          '<button type="button" data-dispute-action="flag" class="secondary-cta inline-cta">Flagga misstänkt bedrägeri</button>'+
          (fraud&&!fraud.police_reported_at?'<button type="button" data-dispute-action="report" class="secondary-cta inline-cta">Registrera gjord polisanmälan</button>':'')+
          (fraud?'<p class="field-note">Intern granskning: '+safe(fraud.suspicion_note)+' · '+safe(fraud.police_reported_at?'Polisanmälan registrerad i systemet':'Inte markerad som polisanmäld')+'</p>':''):'');
    }
  }

  async function loadThread(){
    const d=activeCase();
    s.messages=[];
    if(!d){render();return;}
    const currentId=d.id;
    try{
      const {data,error}=await authClient.from('demo_dispute_messages')
        .select('id,dispute_id,author_id,kind,body,evidence_path,created_at')
        .eq('dispute_id',d.id).order('created_at',{ascending:true});
      if(error)throw error;
      if(activeCase()?.id!==currentId)return;
      s.messages=data||[];
      render();
      const host=el('dispute-messages');
      host.innerHTML=s.messages.map(msg=>{
        const role=msg.kind==='system'?'System':msg.author_id===d.buyer_id?'Köpare':
          msg.author_id===d.seller_id?'Säljare':'PassItOn';
        return '<div class="dispute-bubble '+(msg.kind==='system'?'system':msg.author_id===state.user?.id?'own':'other')+'">'+
          '<small>'+safe(role)+' · '+safe(date(msg.created_at))+'</small>'+
          '<p>'+safe(msg.body)+'</p>'+
          (msg.evidence_path?'<button type="button" class="dispute-link" data-evidence="'+safe(msg.evidence_path)+'">Visa privat bildbevis</button>':'')+
          '</div>';
      }).join('');
      host.scrollTop=host.scrollHeight;
    }catch(e){fail(e);}
  }

  const ordersContainer=el('disputes');
  ordersContainer.addEventListener('change',e=>{
    if(!e.target.matches('[data-dispute-check]'))return;
    const approve=el('dispute-approve');
    if(approve)approve.disabled=![...el('dispute-checklist').querySelectorAll('input')].every(input=>input.checked);
  });
  ordersContainer.addEventListener('click',async(e)=>{
    const orderButton=e.target.closest('[data-dispute-order]');
    if(orderButton){setSelected(orderButton.dataset.disputeOrder);return;}
    if(e.target.closest('#dispute-open')){
      el('dispute-start-form').dataset.open='yes';
      el('dispute-start-form').classList.remove('hidden');return;
    }
    if(e.target.closest('#dispute-approve')){
      if(!confirm('Godkänn denna DEMOORDER? Detta är ingen riktig utbetalning.'))return;
      return withBusy(async()=>{await request('demo_confirm_order',{p_order_id:s.orderId});await load();});
    }
    if(e.target.closest('#dispute-escalate')){
      if(!confirm('Eskalera till PassItOn för granskning?'))return;
      return withBusy(async()=>{
        await request('demo_escalate_dispute',{p_dispute_id:activeCase().id});await load();
      });
    }
    const action=e.target.closest('[data-dispute-action]');
    if(action){
      const kind=action.dataset.disputeAction;
      if(kind==='flag'){
        const reason=prompt('Varför misstänker du bedrägeri? (minst 15 tecken)\nAnge inga känsliga presentkortskoder.');
        if(reason===null)return;
        return withBusy(async()=>{
          await request('demo_flag_suspected_fraud',{p_dispute_id:activeCase().id,p_note:reason.trim()});
          await load();
        });
      }
      if(kind==='report'){
        const reference=prompt('Ange referens från en REDAN genomförd polisanmälan. Detta skickar ingen ny anmälan.');
        if(reference===null)return;
        return withBusy(async()=>{
          await request('demo_record_manual_police_report',{p_dispute_id:activeCase().id,p_reference:reference.trim()});
          await load();
        });
      }
      if(!confirm(kind==='refund'?'Markera SIMULERAD återbetalning?':
        kind==='release'?'Markera SIMULERAD utbetalning?':'Dra tillbaka din reklamation?'))return;
      return withBusy(async()=>{
        await request('demo_close_dispute',{p_dispute_id:activeCase().id,p_action:kind});
        await load();
      });
    }
    const evidence=e.target.closest('[data-evidence]');
    if(evidence){
      try {
        const {data,error}=await authClient.storage.from('passiton-dispute-evidence')
          .createSignedUrl(evidence.dataset.evidence,60);
        if(error)throw error;
        window.open(data.signedUrl,'_blank','noopener,noreferrer');
      }catch(err){fail(err);}
    }
  });

  el('dispute-start-form').addEventListener('submit',e=>{
    e.preventDefault();
    return withBusy(async()=>{
      const order=activeOrder();
      if(!order)throw Error('Välj en demoorder');
      const id=await request('demo_open_dispute',{
        p_order_id:order.id,p_reason:el('dispute-reason').value,
        p_details:el('dispute-details').value.trim()
      });
      if(!id)throw Error('Dispyt kunde inte skapas');
      e.target.reset();delete e.target.dataset.open;
      await load();
    });
  });

  el('dispute-message-form').addEventListener('submit',e=>{
    e.preventDefault();
    return withBusy(async()=>{
      const d=activeCase(),file=el('dispute-evidence-file').files?.[0];
      if(!d)throw Error('Välj en dispyt');
      let evidencePath=null;
      if(file){
        const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
        if(!ext||!file.size||file.size>3145728)throw Error('Tillåtna bildbevis: JPG, PNG, WebP, max 3 MB');
        evidencePath=d.id+'/'+state.user.id+'/'+crypto.randomUUID()+'.'+ext;
        const {error}=await authClient.storage.from('passiton-dispute-evidence')
          .upload(evidencePath,file,{contentType:file.type,cacheControl:'0',upsert:false});
        if(error)throw error;
      }
      await request('demo_post_dispute_message',{
        p_dispute_id:d.id,p_body:el('dispute-message-input').value.trim(),
        p_evidence_path:evidencePath
      });
      e.target.reset();
      await loadThread();
    });
  });
  el('dispute-refresh').addEventListener('click',()=>load());

  // Exposed only for navigation hooks in the existing non-module frontend.
  window.passitonLoadDisputes=()=>load();
  window.passitonResetDisputes=()=>{
    s.userId=null;s.orderId=null;s.orders=[];s.cases=[];s.messages=[];s.fraudReviews=[];s.admin=false;
    render();
  };
})();