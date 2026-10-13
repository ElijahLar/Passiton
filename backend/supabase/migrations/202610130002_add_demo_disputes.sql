-- Passiton demo purchases + Kinguin-style disputes.
-- DEMO ONLY: no money is collected, held or paid out; no gift-card code is delivered.
-- Run AFTER 202610130001_add_listing_photo_proof.sql.
begin;

-- Repair the earlier photo-proof filename check for already migrated projects.
create or replace function public.create_gift_card_listing(
  p_brand text,
  p_category text,
  p_value numeric,
  p_price numeric,
  p_expires_on date,
  p_gift_card_code text,
  p_proof_challenge_id uuid,
  p_proof_photo_path text
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := auth.uid();
  v_listing_id uuid;
  v_challenge private.listing_photo_challenges%rowtype;
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;
  if p_brand is null or p_brand not in ('IKEA', 'Zalando', 'H&M', 'Elgiganten', 'Stadium', 'ICA', 'Åhléns', 'SJ') then
    raise exception 'Unsupported gift card brand';
  end if;
  if p_category is null or p_category not in ('Hem', 'Mode', 'Elektronik', 'Mat', 'Sport', 'Resor') then
    raise exception 'Unsupported gift card category';
  end if;
  if p_value is null or p_value <= 0 or p_price is null or p_price <= 0 or p_price >= p_value then
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

  insert into public.gift_card_listings(
    seller_id, seller_name, brand, category, value, price, expires_on, photo_review_status
  ) values (
    v_seller_id, 'Privat säljare', p_brand, p_category,
    p_value, p_price, p_expires_on, 'pending'
  ) returning id into v_listing_id;

  insert into private.gift_card_secrets(listing_id, seller_id, gift_card_code)
  values (v_listing_id, v_seller_id, pg_catalog.btrim(p_gift_card_code));

  insert into private.listing_photo_submissions(listing_id, challenge_id, seller_id, photo_path)
  values (v_listing_id, v_challenge.id, v_seller_id, p_proof_photo_path);

  update private.listing_photo_challenges
    set consumed_at = now() where id = v_challenge.id;

  return v_listing_id;
end;
$$;

create table if not exists private.passiton_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.passiton_admins from public, anon, authenticated;

create or replace function public.is_passiton_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from private.passiton_admins a where a.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_passiton_admin() from public, anon;
grant execute on function public.is_passiton_admin() to authenticated;

create table if not exists public.demo_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.gift_card_listings(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  brand text not null,
  card_value numeric(12,2) not null,
  price numeric(12,2) not null,
  status text not null default 'held'
    check (status in ('held','released','refunded')),
  -- This is the deadline for demo claims, NOT a real-payment deadline.
  delivered_at timestamptz not null default now(),
  review_deadline timestamptz not null default (now() + interval '48 hours'),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id),
  check (review_deadline > delivered_at)
);
create index if not exists demo_orders_buyer_idx on public.demo_orders(buyer_id,created_at desc);
create index if not exists demo_orders_seller_idx on public.demo_orders(seller_id,created_at desc);
alter table public.demo_orders enable row level security;
revoke all on public.demo_orders from public, anon, authenticated;
grant select on public.demo_orders to authenticated;
drop policy if exists "Read own demo orders" on public.demo_orders;
create policy "Read own demo orders" on public.demo_orders for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or public.is_passiton_admin());

create table if not exists public.demo_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.demo_orders(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('invalid_code','wrong_balance','expired','not_received','other')),
  status text not null default 'open' check (status in ('open','escalated','resolved')),
  outcome text check (outcome in ('withdrawn','release_simulated','refund_simulated')),
  opened_at timestamptz not null default now(),
  escalated_at timestamptz,
  resolved_at timestamptz
);
create index if not exists demo_disputes_status_idx on public.demo_disputes(status,opened_at desc);
alter table public.demo_disputes enable row level security;
revoke all on public.demo_disputes from public, anon, authenticated;
grant select on public.demo_disputes to authenticated;
drop policy if exists "Read own demo disputes" on public.demo_disputes;
create policy "Read own demo disputes" on public.demo_disputes for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()) or public.is_passiton_admin());

create table if not exists public.demo_dispute_messages (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.demo_disputes(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  kind text not null default 'message' check (kind in ('message','system')),
  body text not null check (char_length(body) between 1 and 2000),
  evidence_path text unique,
  created_at timestamptz not null default now()
);
create index if not exists demo_dispute_messages_thread_idx
  on public.demo_dispute_messages(dispute_id,created_at,id);
alter table public.demo_dispute_messages enable row level security;
revoke all on public.demo_dispute_messages from public, anon, authenticated;
grant select on public.demo_dispute_messages to authenticated;
drop policy if exists "Read messages for own dispute" on public.demo_dispute_messages;
create policy "Read messages for own dispute" on public.demo_dispute_messages for select to authenticated
  using (exists (
    select 1 from public.demo_disputes d
    where d.id = dispute_id and
      (d.buyer_id = (select auth.uid()) or d.seller_id = (select auth.uid()) or public.is_passiton_admin())
  ));

-- Store evidence privately. Users can only read their case's evidence and
-- can only upload into their own folder of an unresolved dispute.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('passiton-dispute-evidence','passiton-dispute-evidence',false,3145728,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_access_demo_evidence(p_path text, p_upload boolean default false)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  v_dispute_id uuid;
  v_user uuid := auth.uid();
  v_dispute public.demo_disputes%rowtype;
begin
  if v_user is null then return false; end if;
  if pg_catalog.split_part(p_path,'/',1) !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or pg_catalog.split_part(p_path,'/',2) <> v_user::text and p_upload
    or pg_catalog.split_part(p_path,'/',3) !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    or pg_catalog.split_part(p_path,'/',4) <> ''
  then return false; end if;
  v_dispute_id := pg_catalog.split_part(p_path,'/',1)::uuid;
  select * into v_dispute from public.demo_disputes where id=v_dispute_id;
  if not found then return false; end if;
  if v_user <> v_dispute.buyer_id
     and v_user <> v_dispute.seller_id
     and not public.is_passiton_admin() then return false; end if;
  if not p_upload then return true; end if;
  if v_dispute.status = 'resolved' then return false; end if;
  if v_user <> v_dispute.buyer_id and v_user <> v_dispute.seller_id then return false; end if;
  return (select count(*) from storage.objects o
    where o.bucket_id='passiton-dispute-evidence'
      and pg_catalog.split_part(o.name,'/',1)=v_dispute_id::text
      and pg_catalog.split_part(o.name,'/',2)=v_user::text) < 10;
end;
$$;
revoke all on function public.can_access_demo_evidence(text,boolean) from public,anon;
grant execute on function public.can_access_demo_evidence(text,boolean) to authenticated;

drop policy if exists "Dispute participants upload evidence" on storage.objects;
create policy "Dispute participants upload evidence" on storage.objects
  for insert to authenticated with check (
    bucket_id='passiton-dispute-evidence'
    and public.can_access_demo_evidence(name,true)
  );
drop policy if exists "Dispute participants view evidence" on storage.objects;
create policy "Dispute participants view evidence" on storage.objects
  for select to authenticated using (
    bucket_id='passiton-dispute-evidence'
    and public.can_access_demo_evidence(name,false)
  );

-- A simulated checkout requires a real, approved listing, never accesses the gift-card secret.
create or replace function public.demo_create_order(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_listing public.gift_card_listings%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'Logga in för att skapa en demoorder'; end if;
  select * into v_listing from public.gift_card_listings
    where id=p_listing_id and status='active' and photo_review_status='approved'
      and expires_on >= current_date;
  if not found then raise exception 'Annonsen är inte tillgänglig'; end if;
  if v_listing.seller_id = v_user then raise exception 'Du kan inte köpa din egen annons'; end if;
  if exists(select 1 from public.demo_orders
    where listing_id=p_listing_id and buyer_id=v_user and status='held')
  then raise exception 'Du har redan en pågående demoorder för annonsen'; end if;
  insert into public.demo_orders(listing_id,buyer_id,seller_id,brand,card_value,price)
  values (p_listing_id,v_user,v_listing.seller_id,v_listing.brand,v_listing.value,v_listing.price)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.demo_create_order(uuid) from public,anon;
grant execute on function public.demo_create_order(uuid) to authenticated;

-- Checkout can contain several gift cards; either all simulated orders are
-- created together or none of them are (one database transaction).
create or replace function public.demo_create_orders(p_listing_ids uuid[])
returns uuid[] language plpgsql security definer set search_path = ''
as $$
declare
  v_listing_id uuid;
  v_order_ids uuid[] := array[]::uuid[];
  v_seen uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then raise exception 'Logga in'; end if;
  if p_listing_ids is null or array_length(p_listing_ids,1) not between 1 and 10
  then raise exception 'Välj 1–10 annonser'; end if;
  foreach v_listing_id in array p_listing_ids loop
    if v_listing_id is null or v_listing_id = any(v_seen)
    then raise exception 'Samma annons kan inte köpas två gånger'; end if;
    v_seen := array_append(v_seen,v_listing_id);
    v_order_ids := array_append(v_order_ids, public.demo_create_order(v_listing_id));
  end loop;
  return v_order_ids;
end;
$$;
revoke all on function public.demo_create_orders(uuid[]) from public,anon;
grant execute on function public.demo_create_orders(uuid[]) to authenticated;

-- Idempotent lazy settlement. Called by the signed-in UI when loading cases.
-- This updates demo state ONLY; no money ever moves.
create or replace function public.demo_settle_expired_orders()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.demo_orders o set status='released',settled_at=now()
  where status='held' and review_deadline <= now()
    and (buyer_id=auth.uid() or seller_id=auth.uid())
    and not exists(select 1 from public.demo_disputes d where d.order_id=o.id);
end;
$$;
revoke all on function public.demo_settle_expired_orders() from public,anon;
grant execute on function public.demo_settle_expired_orders() to authenticated;

create or replace function public.demo_confirm_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order public.demo_orders%rowtype;
begin
  select * into v_order from public.demo_orders where id=p_order_id for update;
  if not found or v_order.buyer_id is distinct from auth.uid() then
    raise exception 'Order saknas eller du saknar behörighet';
  end if;
  if v_order.status <> 'held' or v_order.review_deadline <= now() or exists(
    select 1 from public.demo_disputes where order_id=p_order_id
  ) then raise exception 'Ordern kan inte godkännas'; end if;
  update public.demo_orders set status='released',settled_at=now() where id=p_order_id;
end;
$$;
revoke all on function public.demo_confirm_order(uuid) from public,anon;
grant execute on function public.demo_confirm_order(uuid) to authenticated;

create or replace function public.demo_open_dispute(p_order_id uuid,p_reason text,p_details text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.demo_orders%rowtype;
  v_id uuid;
begin
  select * into v_order from public.demo_orders where id=p_order_id for update;
  if not found or v_order.buyer_id is distinct from auth.uid() then
    raise exception 'Du får bara reklamera dina egna köp'; end if;
  if v_order.status <> 'held' or v_order.review_deadline <= now() then
    raise exception 'Reklamationsperioden har löpt ut eller ordern är avslutad'; end if;
  if p_reason is null or p_reason not in
    ('invalid_code','wrong_balance','expired','not_received','other') then
    raise exception 'Välj anledning'; end if;
  if char_length(trim(coalesce(p_details,''))) not between 15 and 2000 then
    raise exception 'Beskriv problemet med 15–2000 tecken'; end if;
  insert into public.demo_disputes(order_id,buyer_id,seller_id,reason)
    values(p_order_id,v_order.buyer_id,v_order.seller_id,p_reason)
    returning id into v_id;
  insert into public.demo_dispute_messages(dispute_id,author_id,body)
    values(v_id,auth.uid(),trim(p_details));
  return v_id;
end;
$$;
revoke all on function public.demo_open_dispute(uuid,text,text) from public,anon;
grant execute on function public.demo_open_dispute(uuid,text,text) to authenticated;

create or replace function public.demo_post_dispute_message(
  p_dispute_id uuid,p_body text,p_evidence_path text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_case public.demo_disputes%rowtype;
  v_user uuid := auth.uid();
  v_message uuid;
  v_body text := trim(coalesce(p_body,''));
begin
  select * into v_case from public.demo_disputes where id=p_dispute_id for update;
  if not found or v_user is null then raise exception 'Dispyt saknas'; end if;
  if v_user <> v_case.buyer_id and v_user <> v_case.seller_id
    and not (v_case.status='escalated' and public.is_passiton_admin())
  then raise exception 'Ingen åtkomst till konversationen'; end if;
  if v_case.status='resolved' then raise exception 'Ärendet är avslutat'; end if;
  if char_length(v_body) > 2000 then raise exception 'Meddelandet är för långt'; end if;
  if v_body='' and p_evidence_path is null then raise exception 'Meddelandet är tomt'; end if;
  if (select count(*) from public.demo_dispute_messages
    where dispute_id=p_dispute_id) >= 200 then raise exception 'Maximalt antal meddelanden'; end if;
  if exists(select 1 from public.demo_dispute_messages
    where dispute_id=p_dispute_id and author_id=v_user
      and created_at>now()-interval '2 seconds')
  then raise exception 'Vänta innan nästa meddelande'; end if;
  if p_evidence_path is not null then
    if not public.can_access_demo_evidence(p_evidence_path,false)
       or pg_catalog.split_part(p_evidence_path,'/',1)<>p_dispute_id::text
       or pg_catalog.split_part(p_evidence_path,'/',2)<>v_user::text
       or not exists(select 1 from storage.objects
         where bucket_id='passiton-dispute-evidence'
           and name=p_evidence_path and created_at>=v_case.opened_at)
    then raise exception 'Ogiltigt bevis'; end if;
  end if;
  insert into public.demo_dispute_messages(dispute_id,author_id,body,evidence_path)
    values(p_dispute_id,v_user,case when v_body='' then 'Bildbevis bifogat' else v_body end,p_evidence_path)
    returning id into v_message;
  return v_message;
end;
$$;
revoke all on function public.demo_post_dispute_message(uuid,text,text) from public,anon;
grant execute on function public.demo_post_dispute_message(uuid,text,text) to authenticated;

-- Either party can escalate after a seller reply or after 24h without progress.
create or replace function public.demo_escalate_dispute(p_dispute_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_case public.demo_disputes%rowtype;
begin
  select * into v_case from public.demo_disputes where id=p_dispute_id for update;
  if not found or auth.uid() is null or
    (auth.uid()<>v_case.buyer_id and auth.uid()<>v_case.seller_id)
  then raise exception 'Ingen behörighet'; end if;
  if v_case.status<>'open' then raise exception 'Dispyt kan inte eskaleras'; end if;
  if v_case.opened_at + interval '24 hours'>now() and
    not exists(select 1 from public.demo_dispute_messages
      where dispute_id=p_dispute_id and author_id=v_case.seller_id)
  then raise exception 'Invänta säljarens svar eller 24 timmar'; end if;
  update public.demo_disputes set status='escalated',escalated_at=now()
    where id=p_dispute_id;
  insert into public.demo_dispute_messages(dispute_id,kind,body)
    values(p_dispute_id,'system','Ärendet eskalerades till PassitOn för manuell granskning.');
end;
$$;
revoke all on function public.demo_escalate_dispute(uuid) from public,anon;
grant execute on function public.demo_escalate_dispute(uuid) to authenticated;

-- Buyer can withdraw a claim. Only admins can decide a disputed refund/release.
create or replace function public.demo_close_dispute(p_dispute_id uuid,p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_case public.demo_disputes%rowtype;
  v_outcome text;
begin
  select * into v_case from public.demo_disputes where id=p_dispute_id for update;
  if not found then raise exception 'Ärendet saknas'; end if;
  if v_case.status='resolved' then raise exception 'Ärendet är redan avslutat'; end if;
  if p_action='withdraw' and auth.uid()=v_case.buyer_id then
    v_outcome:='withdrawn';
  elsif p_action in ('release','refund')
    and v_case.status='escalated' and public.is_passiton_admin()
  then
    v_outcome:=case when p_action='release' then 'release_simulated'
       else 'refund_simulated' end;
  else raise exception 'Åtgärden är inte tillåten'; end if;

  update public.demo_disputes set status='resolved',outcome=v_outcome,resolved_at=now()
    where id=p_dispute_id;
  update public.demo_orders set
    status=case when v_outcome='refund_simulated' then 'refunded' else 'released' end,
    settled_at=now()
    where id=v_case.order_id and status='held';
  insert into public.demo_dispute_messages(dispute_id,author_id,kind,body)
    values(p_dispute_id,auth.uid(),'system',
      case v_outcome
        when 'withdrawn' then 'Köparen avslutade ärendet. Simulerad utbetalning frigjord.'
        when 'release_simulated' then 'PassitOn beslutade: simulerad utbetalning till säljaren.'
        else 'PassitOn beslutade: simulerad återbetalning till köparen.'
      end);
end;
$$;
revoke all on function public.demo_close_dispute(uuid,text) from public,anon;
grant execute on function public.demo_close_dispute(uuid,text) to authenticated;

-- Private fraud-review queue. Flagging does NOT imply guilt or contact police.
create table if not exists private.demo_fraud_reviews (
  dispute_id uuid primary key references public.demo_disputes(id) on delete cascade,
  flagged_by uuid not null references auth.users(id) on delete restrict,
  suspicion_note text not null check (char_length(suspicion_note) between 15 and 2000),
  flagged_at timestamptz not null default now(),
  police_reported_at timestamptz,
  police_case_reference text
);
revoke all on private.demo_fraud_reviews from public,anon,authenticated;

create or replace function public.demo_flag_suspected_fraud(
  p_dispute_id uuid,p_note text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_case public.demo_disputes%rowtype;
begin
  if not public.is_passiton_admin() then raise exception 'Adminbehörighet krävs'; end if;
  select * into v_case from public.demo_disputes where id=p_dispute_id;
  if not found or v_case.escalated_at is null then
    raise exception 'Endast eskalerade ärenden kan flaggas'; end if;
  if char_length(trim(coalesce(p_note,''))) not between 15 and 2000 then
    raise exception 'Beskriv misstanken med 15–2000 tecken'; end if;
  insert into private.demo_fraud_reviews(dispute_id,flagged_by,suspicion_note)
  values(p_dispute_id,auth.uid(),trim(p_note))
  on conflict (dispute_id) do update set
    suspicion_note=excluded.suspicion_note,flagged_at=now(),flagged_by=excluded.flagged_by;
end;
$$;
revoke all on function public.demo_flag_suspected_fraud(uuid,text) from public,anon;
grant execute on function public.demo_flag_suspected_fraud(uuid,text) to authenticated;

create or replace function public.demo_get_fraud_reviews()
returns table(dispute_id uuid,suspicion_note text,flagged_at timestamptz,police_reported_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_passiton_admin() then raise exception 'Adminbehörighet krävs'; end if;
  return query
    select f.dispute_id,f.suspicion_note,f.flagged_at,f.police_reported_at
    from private.demo_fraud_reviews f order by f.flagged_at desc;
end;
$$;
revoke all on function public.demo_get_fraud_reviews() from public,anon;
grant execute on function public.demo_get_fraud_reviews() to authenticated;

-- Only mark as reported AFTER making an actual report yourself.
create or replace function public.demo_record_manual_police_report(
  p_dispute_id uuid,p_reference text
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_passiton_admin() then raise exception 'Adminbehörighet krävs'; end if;
  if char_length(trim(coalesce(p_reference,''))) not between 3 and 100 then
    raise exception 'Ange ett verkligt diarienummer eller en referens'; end if;
  update private.demo_fraud_reviews
    set police_reported_at=now(),police_case_reference=trim(p_reference)
    where dispute_id=p_dispute_id;
  if not found then raise exception 'Ärendet måste först flaggas för granskning'; end if;
end;
$$;
revoke all on function public.demo_record_manual_police_report(uuid,text) from public,anon;
grant execute on function public.demo_record_manual_police_report(uuid,text) to authenticated;

comment on table public.demo_orders is 'Only simulated orders. Never represents actual funds or gift card delivery.';
comment on table public.demo_disputes is 'Demo dispute workflow, no real payment hold or chargeback handling.';
commit;
