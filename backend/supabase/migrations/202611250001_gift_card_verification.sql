begin;
create extension if not exists pgcrypto with schema extensions;
create table public.gift_card_brands (
 name text primary key, id uuid unique not null default gen_random_uuid(), category text not null,
 status text not null default 'candidate' check(status in ('candidate','active','paused')),
 digital boolean not null default false, balance_url text check(balance_url ~ '^https://[^/?#@ ]+(/[^?# ]*)?$'),
 method text not null default '', validity_info text not null default '', code_pattern text not null default '[A-Za-z0-9]+',
 pin_required boolean not null default false, pin_pattern text not null default '[0-9]+',
 ignore_spaces boolean not null default false, ignore_hyphens boolean not null default false,
 reviewed_at timestamptz, check(status <> 'active' or (digital and balance_url is not null and reviewed_at is not null and method <> ''))
);
create table private.brand_notes(brand text primary key references public.gift_card_brands, notes text not null);
insert into public.gift_card_brands(name,category) values
 ('IKEA','Hem'),('Zalando','Mode'),('H&M','Mode'),('Elgiganten','Elektronik'),('Stadium','Sport'),('ICA','Mat'),('Åhléns','Mode'),('SJ','Resor'),
 ('KICKS','Mode'),('Lindex','Mode'),('Cervera','Hem'),('Bauhaus','Hem'),('NetOnNet','Elektronik'),('Dormy','Sport'),('Naturkompaniet','Sport'),('Akademibokhandeln','Böcker och spel'),('Coop','Mat'),('Filmstaden','Resor'),('Scandic','Resor'),('GoGift','Övriga digitala presentkort'),('Emporia','Köpcentrum'),
 ('Zara','Mode'),('Kappahl','Mode'),('Dressmann','Mode'),('Carlings','Mode'),('Cubus','Mode'),('Bik Bok','Mode'),('Volt','Mode'),('Junkyard','Mode'),('Skopunkten','Mode'),('DinSko','Mode'),('Sephora','Mode'),('Rituals','Mode'),('Indiska','Mode'),('Guldfynd','Mode'),
 ('Jula','Hem'),('Biltema','Hem'),('Rusta','Hem'),('Clas Ohlson','Hem'),('Granit','Hem'),('Mio','Hem'),('Blomsterlandet','Hem'),('Granngården','Hem'),('Lagerhaus','Hem'),('Gekås Ullared','Hem'),
 ('XXL','Sport'),('Outnorth','Sport'),
 ('Lekia','Böcker och spel'),('Bokus','Böcker och spel'),('Panduro/Kreatima','Böcker och spel'),
 ('Ticketmaster','Resor'),('Ving','Resor'),('TUI','Resor'),('Apollo','Resor'),('Ticket','Resor'),('Strawberry','Resor'),
 ('Pressbyrån','Mat'),
 ('Allt-i-Ett Presentkort','Övriga digitala presentkort');
-- Shared brands stay under a single issuer to preserve cross-store duplicate detection.
insert into private.brand_notes values ('H&M','Inkluderar H&M Home.'),('Stadium','Inkluderar Stadium Outlet.'),('Filmstaden','Kontrollera om korttypen även gäller hos Svenska Bio.');
alter table public.gift_card_brands enable row level security;
revoke all on public.gift_card_brands from public,anon,authenticated;
grant select on public.gift_card_brands to anon,authenticated;
create policy brand_read on public.gift_card_brands for select using(status='active');
create policy brand_admin_read on public.gift_card_brands for select to authenticated using(public.is_passiton_admin());
create table private.verification_settings(singleton boolean primary key default true check(singleton), days integer not null check(days between 1 and 365), key bytea not null);
insert into private.verification_settings(days,key) values(30,extensions.gen_random_bytes(32));
alter table public.gift_card_listings drop constraint gift_card_listings_brand_check, drop constraint gift_card_listings_category_check,
 add foreign key(brand) references public.gift_card_brands(name),
 add column review_started_at timestamptz not null default now(), add column balance_checked_at timestamptz, add column balance_status text not null default 'pending';
alter table private.gift_card_secrets add column pin text;
create table private.card_claims(digest bytea primary key, listing_id uuid not null, blocked boolean not null default false);
create table private.card_events(id bigint generated always as identity primary key, listing_id uuid, actor uuid default auth.uid(), event text not null, happened_at timestamptz not null default now());
create table private.gift_card_balance_checks(id uuid primary key default gen_random_uuid(), listing_id uuid not null, brand text not null,
 check_type text not null check(check_type in ('listing_review','pre_delivery')), amount numeric, expiry date, method text not null,
 result text not null check(result in ('passed','failed','unavailable')), decision text not null, checklist boolean[] not null,
 reviewer uuid not null default auth.uid(), checked_at timestamptz not null default now(), comment text);
create function private.card_digest(b public.gift_card_brands, code text) returns bytea language sql stable set search_path='' as $$
 select extensions.hmac(convert_to(b.id::text || ':' || translate(code,(case when b.ignore_spaces then ' ' else '' end)||(case when b.ignore_hyphens then '-' else '' end),''),'UTF8'),key,'sha256') from private.verification_settings
$$;
insert into private.card_claims(digest,listing_id,blocked)
select private.card_digest(b,s.gift_card_code),(array_agg(l.id order by (l.status='sold') desc,l.created_at))[1],count(*)>1
from private.gift_card_secrets s join public.gift_card_listings l on l.id=s.listing_id join public.gift_card_brands b on b.name=l.brand group by 1;
create function public.card_balance_current(p_listing uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.gift_card_listings l join public.gift_card_brands b on b.name=l.brand cross join private.verification_settings s
 where l.id=p_listing and b.status='active' and l.balance_status='passed' and l.balance_checked_at >= coalesce(b.reviewed_at,'-infinity') and l.balance_checked_at>now()-make_interval(days=>s.days) and l.expires_on>=current_date)
$$;
create function public.sale_verified(l public.gift_card_listings) returns boolean language sql stable set search_path='' as $$
 select l.status='active' and l.photo_review_status='approved' and public.card_balance_current(l.id)
$$;
create policy balance_visibility on public.gift_card_listings as restrictive for select using(seller_id=auth.uid() or public.card_balance_current(id));
update public.price_offers set status='cancelled',updated_at=now() where status in ('pending_seller','countered','accepted_awaiting_payment');
update public.gift_card_listings set photo_review_status='pending' where status in ('active','paused') and photo_review_status='approved';
drop function public.create_gift_card_listing(text,text,numeric,numeric,date,text,uuid,text);
create or replace function public.create_gift_card_listing(
  p_brand text,
  p_category text,
  p_value numeric,
  p_price numeric,
  p_expires_on date,
  p_gift_card_code text,
  p_proof_challenge_id uuid,
  p_proof_photo_path text, p_pin text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := auth.uid();
  v_listing_id uuid;
  b public.gift_card_brands%rowtype;
  fingerprint bytea;
  prior private.card_claims%rowtype;
  v_challenge private.listing_photo_challenges%rowtype;
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;
  select * into b from public.gift_card_brands where name=p_brand and status='active' for share;
  if not found or b.category is distinct from p_category then raise exception 'Ogiltigt företag eller kategori'; end if;
  p_gift_card_code := translate(p_gift_card_code,(case when b.ignore_spaces then ' ' else '' end)||(case when b.ignore_hyphens then '-' else '' end),'');
  if p_gift_card_code !~ ('^('||b.code_pattern||')$') or
    (b.pin_required and (p_pin is null or length(p_pin) not between 1 and 80 or p_pin !~ ('^('||b.pin_pattern||')$'))) or
    (not b.pin_required and p_pin is not null) then raise exception 'Ogiltigt kodformat'; end if;
  if p_value is null or p_value::text in ('Infinity','NaN') or p_value<>round(p_value,2) or p_price<>round(p_price,2) or p_value <= 0 or p_price is null or p_price <= 0 or p_price >= p_value then
    raise exception 'Price must be positive and below the gift card value';
  end if;
  if p_expires_on is null or p_expires_on < current_date then
    raise exception 'Gift card must not be expired';
  end if;
  if p_gift_card_code is null or pg_catalog.char_length(pg_catalog.btrim(p_gift_card_code)) not between 1 and 200 then
    raise exception 'Gift card code is required';
  end if;

  select * into v_challenge
    from private.listing_photo_challenges
    where id = p_proof_challenge_id and seller_id = v_seller_id
    for update;
  if not found or v_challenge.consumed_at is not null or v_challenge.expires_at <= now() then
    raise exception 'Photo proof code has expired or been used';
  end if;

  if p_proof_photo_path is null
    or pg_catalog.split_part(p_proof_photo_path, '/', 1) <> v_seller_id::text
    or pg_catalog.split_part(p_proof_photo_path, '/', 2) <> v_challenge.id::text
    or pg_catalog.split_part(p_proof_photo_path, '/', 4) <> ''
    or pg_catalog.split_part(p_proof_photo_path, '/', 3) !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'passiton-photo-proofs'
        and o.name = p_proof_photo_path
        and o.created_at >= v_challenge.created_at
        and o.created_at <= v_challenge.expires_at
    )
  then
    raise exception 'A freshly uploaded proof photo is required';
  end if;

  fingerprint:=private.card_digest(b,p_gift_card_code);
  perform pg_advisory_xact_lock(hashtextextended(encode(fingerprint,'hex'),1));
  select * into prior from private.card_claims where digest=fingerprint;
  if found and (prior.blocked or not exists(select 1 from public.gift_card_listings l where l.id=prior.listing_id and l.status<>'sold' and l.photo_review_status='rejected')) then
    insert into private.card_events(listing_id,event) values(prior.listing_id,'duplicate_attempt');
    update private.listing_photo_challenges set consumed_at=now() where id=v_challenge.id;
    return null;
  end if;
  insert into public.gift_card_listings(
    seller_id, seller_name, brand, category, value, price, expires_on, photo_review_status
  ) values (
    v_seller_id, 'Privat säljare', p_brand, p_category,
    p_value, p_price, p_expires_on, 'pending'
  ) returning id into v_listing_id;

  insert into private.gift_card_secrets(listing_id, seller_id, gift_card_code,pin)
  values (v_listing_id, v_seller_id, p_gift_card_code,p_pin);

  insert into private.listing_photo_submissions(listing_id, challenge_id, seller_id, photo_path)
  values (v_listing_id, v_challenge.id, v_seller_id, p_proof_photo_path);

  update private.listing_photo_challenges
    set consumed_at = now() where id = v_challenge.id;

  insert into private.card_claims(digest,listing_id) values(fingerprint,v_listing_id) on conflict(digest) do update set listing_id=excluded.listing_id;
  if prior.listing_id is not null then insert into private.card_events(listing_id,event) values(v_listing_id,'previous_rejection'); end if;
  perform private.emit_passiton_notification(v_seller_id,'verification_pending','Annons inskickad','Ditt fotobevis och saldo väntar på granskning.','listing',v_listing_id,'submitted:'||v_listing_id);
  return v_listing_id;
end;
$$;

alter function public.admin_review_listing(uuid,text,text) set schema private;
revoke all on function private.admin_review_listing(uuid,text,text) from public,authenticated,anon;
create function public.review_credentials(p_listing uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_passiton_admin() then raise exception 'Admin krävs'; end if;
 perform 1 from public.gift_card_listings where id=p_listing and status='active' and photo_review_status='pending' and seller_id<>auth.uid() for share;
 if not found then raise exception 'Ingen granskningsuppgift'; end if;
 insert into private.card_events(listing_id,event) values(p_listing,'credentials_read');
 return (select jsonb_build_object('code',gift_card_code,'pin',pin) from private.gift_card_secrets where listing_id=p_listing);
end $$;
create function public.review_card(p_listing uuid,p_decision text,p_result text,p_amount numeric,p_expiry date,p_checks boolean[],p_reason text,p_comment text,p_block boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare l public.gift_card_listings%rowtype; b public.gift_card_brands%rowtype;
begin
 if not public.is_passiton_admin() then raise exception 'Admin krävs'; end if;
 select * into strict l from public.gift_card_listings where id=p_listing for update;
 if l.seller_id=auth.uid() or l.status<>'active' or l.photo_review_status<>'pending' or p_decision not in ('approved','rejected','supplement') then raise exception 'Ogiltigt beslut'; end if;
 select * into strict b from public.gift_card_brands where name=l.brand for share;
 if p_decision='approved' and (b.status<>'active' or p_result is distinct from 'passed' or p_checks is distinct from array[true,true,true,true,true,true]
 or p_amount is distinct from l.value or (p_expiry is not null and p_expiry<>l.expires_on)
 or not exists(select 1 from private.gift_card_secrets s join private.card_claims c on c.digest=private.card_digest(b,s.gift_card_code)
 where s.listing_id=l.id and c.listing_id=l.id and not c.blocked and s.gift_card_code ~ ('^('||b.code_pattern||')$') and (not b.pin_required or s.pin ~ ('^('||b.pin_pattern||')$')))
 or not exists(select 1 from private.card_events where listing_id=l.id and actor=auth.uid() and event='credentials_read' and happened_at>=l.review_started_at))
 then raise exception 'Kontrollera företag, kod, saldo och checklista'; end if;
 if p_block and p_decision<>'rejected' then raise exception 'Spärr kräver avslag'; end if;
 if exists(select 1 from private.gift_card_secrets s where s.listing_id=l.id and
   (strpos(coalesce(p_reason,'')||' '||coalesce(p_comment,''),s.gift_card_code)>0 or
    strpos(coalesce(p_reason,'')||' '||coalesce(p_comment,''),s.pin)>0)) then raise exception 'Utelämna kortuppgifterna'; end if;
 if p_decision='approved' then
   perform private.admin_review_listing(l.id,'approved',null);
 else
   if length(trim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Ange en motivering'; end if;
   update public.gift_card_listings set photo_review_status='rejected',photo_review_reason=trim(p_reason) where id=l.id;
   if p_block then
     update private.card_claims set blocked=true where listing_id=l.id;
     insert into private.card_events(listing_id,event) values(l.id,'blocked');
   end if;
 end if;
 insert into private.gift_card_balance_checks(listing_id,brand,check_type,amount,expiry,method,result,decision,checklist,comment)
 values(l.id,b.name,'listing_review',p_amount,p_expiry,b.method,p_result,p_decision,p_checks,p_comment);
 update public.gift_card_listings set balance_status=case when p_decision='approved' then 'passed' when p_decision='supplement' then 'supplement' else 'failed' end,
 balance_checked_at=case when p_result='passed' then now() else balance_checked_at end where id=l.id;
 if p_decision='supplement' then perform private.emit_passiton_notification(l.seller_id,'verification_supplement','Komplettera annonsen','Läs motiveringen under dina annonser och skicka in ett nytt fotobevis i en ny annons.','listing',l.id,'supplement:'||l.id); end if;
end $$;
create function private.verify_transaction() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='price_offers' then
  if new.status='payment_expired' and not public.card_balance_current(new.listing_id) then new.status:='cancelled'; return new; end if;
  if new.status not in ('pending_seller','countered','accepted_awaiting_payment') then return new; end if;
 end if;
 if not public.card_balance_current(new.listing_id) then raise exception 'Annonsen väntar på saldokontroll'; end if;
 return new;
end $$;
create trigger verify_offer before insert or update on public.price_offers for each row execute function private.verify_transaction();
create trigger verify_order before insert on public.demo_orders for each row execute function private.verify_transaction();
create function private.refresh_card_reviews() returns void language plpgsql security definer set search_path='' as $$
declare l record;
begin
 for l in select * from public.gift_card_listings where balance_status='passed' and status in ('paused','active') and not public.card_balance_current(id) for update loop
 update public.price_offers set status='cancelled',updated_at=now() where listing_id=l.id and status in ('pending_seller','countered','accepted_awaiting_payment');
 update public.gift_card_listings set balance_status='expired',photo_review_status='pending',review_started_at=now() where id=l.id;
 perform private.emit_passiton_notification(l.seller_id,'verification_expired','Ny saldokontroll krävs','Försäljningen är pausad i väntan på en ny kontroll.','listing',l.id,'expired:'||l.id||':'||l.balance_checked_at);
 end loop;
end $$;
-- Only ops without a user session run this maintenance function.
revoke all on function private.refresh_card_reviews() from public,anon,authenticated;
create extension if not exists pg_cron;
select cron.schedule('passiton-card-rechecks','*/5 * * * *','select private.refresh_card_reviews()');
create function public.verification_admin_config() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_passiton_admin() then raise exception 'Admin krävs'; end if;
 return jsonb_build_object('days',(select days from private.verification_settings),'brands',(select jsonb_agg(to_jsonb(b)||jsonb_build_object('notes',coalesce(n.notes,'')) order by b.name) from public.gift_card_brands b left join private.brand_notes n on n.brand=b.name));
end $$;
create function public.save_verification_brand(p_brand text,p_data jsonb,p_days integer) returns void language plpgsql security definer set search_path='' as $$
declare b public.gift_card_brands%rowtype;
begin
 if not public.is_passiton_admin() then raise exception 'Admin krävs'; end if;
 select * into strict b from public.gift_card_brands where name=p_brand for update;
 if (b.ignore_spaces is distinct from coalesce((p_data->>'ignore_spaces')::boolean,false) or
     b.ignore_hyphens is distinct from coalesce((p_data->>'ignore_hyphens')::boolean,false))
    and exists(select 1 from public.gift_card_listings where brand=p_brand) then
   raise exception 'Normalisering av registrerade kort kräver migrering av fingeravtrycken';
 end if;
 update public.gift_card_brands set ignore_spaces=coalesce((p_data->>'ignore_spaces')::boolean,false),
 ignore_hyphens=coalesce((p_data->>'ignore_hyphens')::boolean,false),category=p_data->>'category',status=p_data->>'status',digital=(p_data->>'digital')::boolean,
 balance_url=nullif(p_data->>'balance_url',''),method=p_data->>'method',validity_info=p_data->>'validity_info',
 code_pattern=p_data->>'code_pattern',pin_required=(p_data->>'pin_required')::boolean,pin_pattern=p_data->>'pin_pattern',reviewed_at=case when b.status='active' and b.balance_url is not distinct from nullif(p_data->>'balance_url','')
 and b.method=p_data->>'method' and b.code_pattern=p_data->>'code_pattern' and b.pin_pattern=p_data->>'pin_pattern' and b.pin_required=(p_data->>'pin_required')::boolean then b.reviewed_at else now() end where name=p_brand;
 perform '' ~ (p_data->>'code_pattern'), '' ~ (p_data->>'pin_pattern');
 insert into private.brand_notes values(p_brand,p_data->>'notes') on conflict(brand) do update set notes=excluded.notes;
 update private.verification_settings set days=p_days;
 insert into private.card_events(event) values('catalog:'||p_brand);
 perform private.refresh_card_reviews();
end $$;
drop function public.admin_listing_review_queue(integer,integer);
create function public.admin_listing_review_queue(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  listing_id uuid,
  brand text,
  face_value numeric,
  asking_price numeric,
  expires_on date,
  listing_status text,
  submitted_at timestamptz,
  photo_path text,
  proof_code text, category text, seller uuid, risks text[], balance_url text, method text, notes text
)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_passiton_admin() then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
     or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception 'Invalid pagination' using errcode='22023';
  end if;
  return query
  select l.id, l.brand, l.value, l.price, l.expires_on, l.status,
         coalesce(p.submitted_at,l.created_at), p.photo_path, c.proof_code,l.category,l.seller_id,array_remove(array[
 case when l.value>=5000 then 'Högt värde' end,case when l.expires_on<current_date+30 then 'Kort giltighetstid' end,
 case when exists(select 1 from private.card_claims claims join private.gift_card_secrets secret on secret.listing_id=l.id and claims.digest=private.card_digest(b,secret.gift_card_code) where claims.blocked or claims.listing_id<>l.id) then 'Blockerad kod eller dubblett' end,
 case when exists(select 1 from private.demo_fraud_reviews f join public.demo_disputes dis on dis.id=f.dispute_id where dis.seller_id=l.seller_id) then 'Tidigare dokumenterat ärende' end,
 case when b.status<>'active' then 'Företaget är spärrat' end,
 case when exists(select 1 from private.card_events e where e.actor=l.seller_id and e.event='duplicate_attempt') then 'Tidigare dubblettförsök' end,
 case when (select count(*) from public.gift_card_listings x where x.seller_id=l.seller_id and x.photo_review_status='rejected')>=3 then 'Flera avslag' end,
 case when exists(select 1 from private.card_events e where e.listing_id=l.id and e.event='previous_rejection') then 'Tidigare avvisad kod' end],null),b.balance_url,b.method,n.notes
  from public.gift_card_listings l
  join public.gift_card_brands b on b.name=l.brand left join private.brand_notes n on n.brand=b.name
  left join private.listing_photo_submissions p on p.listing_id = l.id
  left join private.listing_photo_challenges c on c.id = p.challenge_id
  where l.photo_review_status = 'pending'
    and l.status = 'active'
  order by p.submitted_at asc, l.id asc
  limit p_limit offset p_offset;
end;
$$;


create or replace function private.queue_passiton_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_category text;
  v_prefs public.notification_preferences%rowtype;
  v_enabled boolean := false;
begin
  v_category := case
    when new.type in ('offer_received','offer_accepted','offer_declined','offer_countered',
      'offer_expired','offer_expiring','offer_payment_due','offer_payment_expired') then 'offers'
    when new.type in ('demo_purchase','demo_sale') then 'purchases'
    when new.type in ('verification_approved','verification_rejected','verification_pending','verification_expired','verification_supplement') then 'verification'
    when new.type in ('dispute_opened','dispute_updated','dispute_resolved','dispute_message') then 'cases'
    when new.type = 'saved_price_drop' then 'saved_price_drop'
    when new.type = 'saved_sold' then 'saved_sold'
    else null end;
  if v_category is null then return new; end if;
  select * into v_prefs from public.notification_preferences where user_id=new.user_id;
  if not found then return new; end if;
  v_enabled := case v_category
    when 'offers' then v_prefs.email_offers
    when 'purchases' then v_prefs.email_purchases
    when 'verification' then v_prefs.email_verification
    when 'cases' then v_prefs.email_cases
    when 'saved_price_drop' then v_prefs.email_saved_price_drop
    when 'saved_sold' then v_prefs.email_saved_sold
    else false end;
  if v_enabled then
    insert into private.notification_email_outbox(notification_id,user_id,category)
    values(new.id,new.user_id,v_category) on conflict (notification_id) do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.admin_listing_review_queue(integer,integer) from public,anon;
grant execute on function public.admin_listing_review_queue(integer,integer) to authenticated;
revoke all on function public.create_gift_card_listing(text,text,numeric,numeric,date,text,uuid,text,text) from public,anon;
grant execute on function public.create_gift_card_listing(text,text,numeric,numeric,date,text,uuid,text,text) to authenticated;
revoke all on function public.review_card(uuid,text,text,numeric,date,boolean[],text,text,boolean) from public,anon;
grant execute on function public.review_card(uuid,text,text,numeric,date,boolean[],text,text,boolean) to authenticated;
revoke all on function public.review_credentials(uuid) from public,anon;
grant execute on function public.review_credentials(uuid) to authenticated;
revoke all on function public.verification_admin_config() from public,anon;
grant execute on function public.verification_admin_config() to authenticated;
revoke all on function public.save_verification_brand(text,jsonb,integer) from public,anon;
grant execute on function public.save_verification_brand(text,jsonb,integer) to authenticated;
create or replace function private.expire_buyer_price_offers(p_buyer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_new_misses integer;
  v_recent_misses integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_buyer::text, 731));

  update public.price_offers
  set status='expired', updated_at=now()
  where buyer_id=p_buyer and status in ('pending_seller','countered') and offer_expires_at<=now();

  with overdue as (
    update public.price_offers
    set status='payment_expired', updated_at=now()
    where buyer_id=p_buyer and status='accepted_awaiting_payment' and payment_due_at<=now()
    returning id,buyer_id,status
  ), misses as (
    insert into private.offer_payment_misses(offer_id,buyer_id)
    select id,buyer_id from overdue where status='payment_expired'
    on conflict (offer_id) do nothing
    returning offer_id
  )
  select count(*) into v_new_misses from misses;

  if v_new_misses>0 then
    select count(*) into v_recent_misses
    from private.offer_payment_misses
    where buyer_id=p_buyer and reversed_at is null and missed_at>now()-interval '30 days';
    if v_recent_misses>=5 then
      insert into private.offer_bid_blocks(buyer_id,blocked_until)
      values(p_buyer,now()+interval '7 days')
      on conflict (buyer_id) do update
      set blocked_until=greatest(private.offer_bid_blocks.blocked_until,excluded.blocked_until),
          updated_at=now();
    end if;
  end if;
end;
$$;
create or replace function private.notify_listing_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_saved record;
  v_event text;
begin
  if old.price > new.price and new.status='active' and new.photo_review_status='approved' then
    for v_saved in select s.user_id from public.saved_listings s where s.listing_id=new.id
      and s.user_id<>new.seller_id loop
      perform private.emit_passiton_notification(v_saved.user_id,'saved_price_drop',
        'Sparat presentkort har sänkts',
        new.brand || '-presentkortet har sänkts från ' || old.price || ' kr till ' || new.price || ' kr.',
        'listing',new.id,'price-drop:' || new.id::text || ':' || pg_catalog.txid_current()::text);
    end loop;
  end if;
  if old.status is distinct from new.status and new.status='sold' then
    for v_saved in select s.user_id from public.saved_listings s where s.listing_id=new.id
      and s.user_id<>new.seller_id loop
      perform private.emit_passiton_notification(v_saved.user_id,'saved_sold',
        'Ett sparat presentkort är inte längre tillgängligt',
        'Ett ' || new.brand || '-presentkort som du sparat har markerats som sålt.',
        'listing',new.id,'saved-sold:' || new.id::text);
    end loop;
  end if;
  return new;
end; $$;
-- Decision notices reuse the existing verification preference and Resend outbox.
create function private.notify_card_decision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.decision in ('approved','rejected') then
 perform private.emit_passiton_notification((select seller_id from public.gift_card_listings where id=new.listing_id),
 case when new.decision='approved' then 'verification_approved' else 'verification_rejected' end,
 case when new.decision='approved' then 'Annonsen är godkänd' else 'Annonsen har avslagits' end,
 case when new.decision='approved' then 'Foto och saldo har kontrollerats.' else 'Läs motiveringen under dina annonser.' end,
 'listing',new.listing_id,'decision:'||new.id);
 end if;
 return new;
end $$;
create trigger card_decision_notice after insert on private.gift_card_balance_checks for each row execute function private.notify_card_decision();
commit;
