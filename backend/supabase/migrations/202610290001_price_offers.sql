-- PassItOn IP-02: structured offers (Alternative B). Apply after all 20261027 migrations.
-- DEMO ONLY: no money is captured/held and no gift-card secrets are delivered.
begin;

create table if not exists public.price_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.gift_card_listings(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  listing_price_snapshot numeric(12,2) not null check (listing_price_snapshot > 0),
  offered_price integer not null check (offered_price > 0),
  counter_price integer,
  accepted_price integer,
  status text not null default 'pending_seller' check (status in (
    'pending_seller','countered','accepted_awaiting_payment',
    'declined','cancelled','expired','payment_expired','purchased'
  )),
  offer_expires_at timestamptz not null default (now() + interval '24 hours'),
  accepted_at timestamptz,
  payment_due_at timestamptz,
  order_id uuid references public.demo_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_offers_distinct_participants check (buyer_id <> seller_id),
  constraint price_offers_counter_valid check (counter_price is null or counter_price > offered_price),
  constraint price_offers_accepted_valid check (accepted_price is null or accepted_price > 0)
);
create index if not exists price_offers_buyer_idx on public.price_offers(buyer_id,created_at desc);
create index if not exists price_offers_seller_idx on public.price_offers(seller_id,created_at desc);
create index if not exists price_offers_reserved_idx on public.price_offers(listing_id,payment_due_at)
  where status='accepted_awaiting_payment';
create unique index if not exists price_offers_one_active_per_buyer_listing
  on public.price_offers(buyer_id,listing_id)
  where status in ('pending_seller','countered','accepted_awaiting_payment');

alter table public.price_offers enable row level security;
revoke all on public.price_offers from public,anon,authenticated;
-- Deliberately no direct SELECT/INSERT/UPDATE for clients. All reads are sanitized RPCs.

create table if not exists private.offer_aliases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alias text not null unique default ('#' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)))
);
create table if not exists private.offer_payment_misses (
  offer_id uuid primary key references public.price_offers(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  missed_at timestamptz not null default now(),
  reversed_at timestamptz
);
create index if not exists offer_misses_recent on private.offer_payment_misses(buyer_id,missed_at desc)
  where reversed_at is null;
create table if not exists private.offer_bid_blocks (
  buyer_id uuid primary key references auth.users(id) on delete cascade,
  blocked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table private.offer_aliases enable row level security;
alter table private.offer_payment_misses enable row level security;
alter table private.offer_bid_blocks enable row level security;
revoke all on private.offer_aliases, private.offer_payment_misses, private.offer_bid_blocks from public,anon,authenticated;

-- A transactional buyer-level mutex prevents simultaneous requests from exceeding 5 active offers.
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
    returning id,buyer_id
  ), misses as (
    insert into private.offer_payment_misses(offer_id,buyer_id)
    select id,buyer_id from overdue
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

create or replace function public.price_offer_create(p_listing_id uuid,p_price integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_listing public.gift_card_listings%rowtype;
  v_id uuid;
  v_blocked timestamptz;
begin
  if v_user is null then raise exception 'Logga in för att lämna ett prisförslag' using errcode='28000'; end if;
  perform private.expire_buyer_price_offers(v_user);
  select blocked_until into v_blocked from private.offer_bid_blocks where buyer_id=v_user;
  if v_blocked>now() then raise exception 'Ditt konto är tillfälligt spärrat från nya prisförslag' using errcode='23514'; end if;

  select * into v_listing from public.gift_card_listings where id=p_listing_id for update;
  if not found or v_listing.status<>'active' or v_listing.photo_review_status<>'approved'
       or v_listing.expires_on<current_date then
    raise exception 'Annonsen kan inte ta emot prisförslag' using errcode='23514';
  end if;
  if v_listing.seller_id=v_user then raise exception 'Du kan inte pruta på din egen annons' using errcode='23514'; end if;
  if p_price is null or p_price<pg_catalog.ceil(v_listing.price/2) or p_price>=v_listing.price then
    raise exception 'Prisförslaget måste vara minst halva annonspriset och lägre än annonspriset' using errcode='22023';
  end if;
  if exists (select 1 from public.price_offers where listing_id=p_listing_id
      and status='accepted_awaiting_payment' and payment_due_at>now()) then
    raise exception 'Annonsen är tillfälligt reserverad' using errcode='23514';
  end if;
  if exists (select 1 from public.price_offers where buyer_id=v_user and listing_id=p_listing_id
      and status in ('pending_seller','countered','accepted_awaiting_payment')) then
    raise exception 'Du har redan ett aktivt prisförslag på annonsen' using errcode='23505';
  end if;
  if (select count(*) from public.price_offers where buyer_id=v_user
      and status in ('pending_seller','countered','accepted_awaiting_payment'))>=5 then
    raise exception 'Du har redan fem aktiva prisförslag' using errcode='23514';
  end if;
  if (select count(*) from public.price_offers where buyer_id=v_user
      and created_at>now()-interval '24 hours')>=20 then
    raise exception 'För många prisförslag senaste dygnet' using errcode='23514';
  end if;

  insert into private.offer_aliases(user_id) values(v_user) on conflict do nothing;
  insert into private.offer_aliases(user_id) values(v_listing.seller_id) on conflict do nothing;
  insert into public.price_offers(listing_id,buyer_id,seller_id,listing_price_snapshot,offered_price)
  values(v_listing.id,v_user,v_listing.seller_id,v_listing.price,p_price)
  returning id into v_id;
  return v_id;
end;
$$;

-- Reads are reduced to non-identifying aliases and listing facts; no auth UUIDs or emails.
create or replace function public.price_offer_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_other uuid;
  v_sent jsonb;
  v_received jsonb;
  v_active integer;
  v_misses integer;
  v_blocked timestamptz;
begin
  if v_user is null then raise exception 'Logga in för att se prisförslag' using errcode='28000'; end if;
  perform private.expire_buyer_price_offers(v_user);
  -- Also settle the offers this user has received, so their inbox is current.
  for v_other in select distinct buyer_id from public.price_offers where seller_id=v_user
  loop
    perform private.expire_buyer_price_offers(v_other);
  end loop;

  select coalesce(jsonb_agg(t.payload order by t.created_at desc),'[]'::jsonb) into v_sent
  from (
    select o.created_at, jsonb_build_object(
      'id',o.id,'listing_id',o.listing_id,'brand',l.brand,'listing_price',o.listing_price_snapshot,
      'offered_price',o.offered_price,'counter_price',o.counter_price,'accepted_price',o.accepted_price,
      'status',o.status,'offer_expires_at',o.offer_expires_at,'payment_due_at',o.payment_due_at,
      'created_at',o.created_at,'alias',a.alias
    ) payload
    from public.price_offers o join public.gift_card_listings l on l.id=o.listing_id
    join private.offer_aliases a on a.user_id=o.seller_id
    where o.buyer_id=v_user order by o.created_at desc limit 100
  ) t;
  select coalesce(jsonb_agg(t.payload order by t.created_at desc),'[]'::jsonb) into v_received
  from (
    select o.created_at, jsonb_build_object(
      'id',o.id,'listing_id',o.listing_id,'brand',l.brand,'listing_price',o.listing_price_snapshot,
      'offered_price',o.offered_price,'counter_price',o.counter_price,'accepted_price',o.accepted_price,
      'status',o.status,'offer_expires_at',o.offer_expires_at,'payment_due_at',o.payment_due_at,
      'created_at',o.created_at,'alias',a.alias
    ) payload
    from public.price_offers o join public.gift_card_listings l on l.id=o.listing_id
    join private.offer_aliases a on a.user_id=o.buyer_id
    where o.seller_id=v_user order by o.created_at desc limit 100
  ) t;
  select count(*) into v_active from public.price_offers where buyer_id=v_user
    and status in ('pending_seller','countered','accepted_awaiting_payment');
  select count(*) into v_misses from private.offer_payment_misses
    where buyer_id=v_user and reversed_at is null and missed_at>now()-interval '30 days';
  select blocked_until into v_blocked from private.offer_bid_blocks where buyer_id=v_user;
  return jsonb_build_object('sent',v_sent,'received',v_received,'active_count',v_active,
    'misses_30d',v_misses,'blocked_until',v_blocked);
end;
$$;

-- Accept / decline / counter: seller only. Locks listing before the offer row.
create or replace function public.price_offer_seller_action(p_offer_id uuid,p_action text,p_counter_price integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_buyer uuid;
  v_listing_id uuid;
  v_listing public.gift_card_listings%rowtype;
  v_offer public.price_offers%rowtype;
begin
  if v_user is null then raise exception 'Logga in' using errcode='28000'; end if;
  select buyer_id,listing_id into v_buyer,v_listing_id from public.price_offers
  where id=p_offer_id and seller_id=v_user;
  if not found then raise exception 'Prisförslaget finns inte' using errcode='42501'; end if;
  perform private.expire_buyer_price_offers(v_buyer);
  select * into v_listing from public.gift_card_listings where id=v_listing_id for update;
  select * into v_offer from public.price_offers where id=p_offer_id and seller_id=v_user for update;
  if v_offer.status<>'pending_seller' or v_offer.offer_expires_at<=now() then
    raise exception 'Prisförslaget är inte längre öppet' using errcode='23514';
  end if;
  if v_listing.status<>'active' or v_listing.photo_review_status<>'approved'
     or v_listing.expires_on<current_date or v_listing.price<>v_offer.listing_price_snapshot then
    raise exception 'Annonsen är inte längre tillgänglig med samma pris' using errcode='23514';
  end if;
  if p_action='decline' then
    update public.price_offers set status='declined',updated_at=now() where id=p_offer_id;
  elsif p_action='counter' then
    if p_counter_price is null or p_counter_price<=v_offer.offered_price
       or p_counter_price>=v_listing.price then
      raise exception 'Motbudet måste vara högre än köparens bud och lägre än annonspriset' using errcode='22023';
    end if;
    update public.price_offers set status='countered',counter_price=p_counter_price,updated_at=now()
    where id=p_offer_id;
  elsif p_action='accept' then
    if exists(select 1 from public.price_offers where listing_id=v_listing_id and id<>p_offer_id
       and status='accepted_awaiting_payment' and payment_due_at>now()) then
      raise exception 'Annonsen är redan reserverad' using errcode='23514';
    end if;
    update public.price_offers set status='accepted_awaiting_payment',accepted_price=offered_price,
      accepted_at=now(),payment_due_at=now()+interval '24 hours',updated_at=now()
      where id=p_offer_id;
  else
    raise exception 'Okänd åtgärd' using errcode='22023';
  end if;
end;
$$;

create or replace function public.price_offer_buyer_action(p_offer_id uuid,p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_listing_id uuid;
  v_listing public.gift_card_listings%rowtype;
  v_offer public.price_offers%rowtype;
begin
  if v_user is null then raise exception 'Logga in' using errcode='28000'; end if;
  perform private.expire_buyer_price_offers(v_user);
  select listing_id into v_listing_id from public.price_offers where id=p_offer_id and buyer_id=v_user;
  if not found then raise exception 'Prisförslaget finns inte' using errcode='42501'; end if;
  select * into v_listing from public.gift_card_listings where id=v_listing_id for update;
  select * into v_offer from public.price_offers where id=p_offer_id and buyer_id=v_user for update;
  if p_action='cancel' and v_offer.status in ('pending_seller','countered') then
    update public.price_offers set status='cancelled',updated_at=now() where id=p_offer_id;
    return;
  end if;
  if v_offer.status<>'countered' or v_offer.offer_expires_at<=now() then
    raise exception 'Motbudet är inte längre öppet' using errcode='23514';
  end if;
  if p_action='decline_counter' then
    update public.price_offers set status='declined',updated_at=now() where id=p_offer_id;
  elsif p_action='accept_counter' then
    if v_listing.status<>'active' or v_listing.photo_review_status<>'approved'
       or v_listing.expires_on<current_date or v_listing.price<>v_offer.listing_price_snapshot then
      raise exception 'Annonsen är inte längre tillgänglig' using errcode='23514';
    end if;
    if exists(select 1 from public.price_offers where listing_id=v_listing_id and id<>p_offer_id
       and status='accepted_awaiting_payment' and payment_due_at>now()) then
      raise exception 'Annonsen är redan reserverad' using errcode='23514';
    end if;
    update public.price_offers set status='accepted_awaiting_payment',accepted_price=counter_price,
      accepted_at=now(),payment_due_at=now()+interval '24 hours',updated_at=now() where id=p_offer_id;
  else
    raise exception 'Okänd åtgärd' using errcode='22023';
  end if;
end;
$$;

-- Public boolean only; never exposes offer participants.
create or replace function public.price_offer_is_reserved(p_listing_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists(select 1 from public.price_offers where listing_id=p_listing_id
    and status='accepted_awaiting_payment' and payment_due_at>now());
$$;

-- Guard every normal demo purchase from a reserved offer and prevent double orders.
create or replace function public.demo_create_order(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_listing public.gift_card_listings%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'Logga in för att skapa en demoorder' using errcode='28000'; end if;
  select * into v_listing from public.gift_card_listings where id=p_listing_id for update;
  if not found or v_listing.status<>'active' or v_listing.photo_review_status<>'approved'
     or v_listing.expires_on<current_date then
    raise exception 'Annonsen är inte längre tillgänglig' using errcode='23514';
  end if;
  if v_listing.seller_id=v_user then raise exception 'Du kan inte köpa din egen annons' using errcode='23514'; end if;
  if exists(select 1 from public.price_offers where listing_id=p_listing_id
    and status='accepted_awaiting_payment' and payment_due_at>now()) then
    raise exception 'Annonsen är reserverad för ett accepterat bud' using errcode='23514';
  end if;
  if (select count(*) from public.demo_orders where buyer_id=v_user
    and created_at>now()-interval '1 hour')>=20 then
    raise exception 'För många demoorder på kort tid' using errcode='23514';
  end if;
  insert into public.demo_orders(listing_id,buyer_id,seller_id,brand,card_value,price)
  values(v_listing.id,v_user,v_listing.seller_id,v_listing.brand,v_listing.value,v_listing.price)
  returning id into v_id;
  update public.gift_card_listings set status='sold' where id=p_listing_id;
  return v_id;
end;
$$;

-- Atomic demo checkout of a negotiated offer. Not a real payment capture!
create or replace function public.demo_buy_accepted_offer(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid:=auth.uid();
  v_listing_id uuid;
  v_listing public.gift_card_listings%rowtype;
  v_offer public.price_offers%rowtype;
  v_order uuid;
begin
  if v_user is null then raise exception 'Logga in för att köpa' using errcode='28000'; end if;
  perform private.expire_buyer_price_offers(v_user);
  select listing_id into v_listing_id from public.price_offers where id=p_offer_id and buyer_id=v_user;
  if not found then raise exception 'Erbjudandet finns inte' using errcode='42501'; end if;
  select * into v_listing from public.gift_card_listings where id=v_listing_id for update;
  select * into v_offer from public.price_offers where id=p_offer_id and buyer_id=v_user for update;
  if v_offer.status='purchased' and v_offer.order_id is not null then
    return jsonb_build_object('order_id',v_offer.order_id,'price',v_offer.accepted_price,'already_purchased',true);
  end if;
  if v_offer.status<>'accepted_awaiting_payment' or v_offer.payment_due_at<=now() then
    raise exception 'Den accepterade betalningsfristen har gått ut' using errcode='23514';
  end if;
  if v_listing.status<>'active' or v_listing.photo_review_status<>'approved'
     or v_listing.expires_on<current_date then
    raise exception 'Annonsen är inte längre tillgänglig' using errcode='23514';
  end if;
  insert into public.demo_orders(listing_id,buyer_id,seller_id,brand,card_value,price)
  values(v_listing.id,v_user,v_listing.seller_id,v_listing.brand,v_listing.value,v_offer.accepted_price)
  returning id into v_order;
  update public.price_offers set status='purchased',order_id=v_order,updated_at=now()
    where id=p_offer_id;
  update public.gift_card_listings set status='sold' where id=v_listing.id;
  return jsonb_build_object('order_id',v_order,'price',v_offer.accepted_price,'already_purchased',false);
end;
$$;

-- Price changes and pauses must not break an accepted buyer's 24h checkout.
create or replace function private.guard_offer_listing_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.price is distinct from old.price or new.status is distinct from old.status)
    and new.status<>'sold'
    and exists(select 1 from public.price_offers where listing_id=old.id
      and status='accepted_awaiting_payment' and payment_due_at>now()) then
    raise exception 'Annonsen har ett accepterat, ej betalt prisförslag' using errcode='23514';
  end if;
  return new;
end;
$$;
create or replace function private.close_offers_on_listing_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.price is distinct from old.price or new.status is distinct from old.status then
    update public.price_offers set status='cancelled',updated_at=now()
    where listing_id=new.id and status in ('pending_seller','countered');
  end if;
  return null;
end;
$$;
drop trigger if exists price_offer_listing_guard on public.gift_card_listings;
create trigger price_offer_listing_guard before update of price,status on public.gift_card_listings
  for each row execute function private.guard_offer_listing_update();
drop trigger if exists price_offer_listing_cleanup on public.gift_card_listings;
create trigger price_offer_listing_cleanup after update of price,status on public.gift_card_listings
  for each row execute function private.close_offers_on_listing_update();

-- Restrict EXECUTE (functions grant PUBLIC by default unless explicitly revoked).
revoke all on function private.expire_buyer_price_offers(uuid) from public,anon,authenticated;
revoke all on function private.guard_offer_listing_update() from public,anon,authenticated;
revoke all on function private.close_offers_on_listing_update() from public,anon,authenticated;
revoke all on function public.price_offer_create(uuid,integer) from public,anon,authenticated;
revoke all on function public.price_offer_overview() from public,anon,authenticated;
revoke all on function public.price_offer_seller_action(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.price_offer_buyer_action(uuid,text) from public,anon,authenticated;
revoke all on function public.price_offer_is_reserved(uuid) from public,anon,authenticated;
revoke all on function public.demo_buy_accepted_offer(uuid) from public,anon,authenticated;
revoke all on function public.demo_create_order(uuid) from public,anon,authenticated;
grant execute on function public.price_offer_create(uuid,integer) to authenticated;
grant execute on function public.price_offer_overview() to authenticated;
grant execute on function public.price_offer_seller_action(uuid,text,integer) to authenticated;
grant execute on function public.price_offer_buyer_action(uuid,text) to authenticated;
grant execute on function public.price_offer_is_reserved(uuid) to anon,authenticated;
grant execute on function public.demo_buy_accepted_offer(uuid) to authenticated;
grant execute on function public.demo_create_order(uuid) to authenticated;

commit;
