-- PassItOn IP-01: server-enforced seller controls and manual review.
-- Apply only AFTER 202610130002_add_demo_disputes.sql.
-- This migration does NOT enable real payments, code delivery or verification.
begin;

-- Soft-delete/pausing must not invalidate existing order/dispute references.
alter table public.gift_card_listings
  drop constraint if exists gift_card_listings_status_check;
alter table public.gift_card_listings
  add constraint gift_card_listings_status_check
  check (status in ('active', 'paused', 'sold', 'removed'));

alter table public.gift_card_listings
  add column if not exists photo_review_reason text;

create index if not exists gift_card_listings_seller_created_idx
  on public.gift_card_listings (seller_id, created_at desc);
create index if not exists gift_card_listings_review_idx
  on public.gift_card_listings (created_at, id)
  where photo_review_status = 'pending' and status in ('active', 'paused');

-- Privileged audit trail, not writable or readable by app clients.
create table if not exists private.listing_management_audit (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.gift_card_listings(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('price', 'pause', 'resume', 'remove', 'approve', 'reject')),
  old_status text,
  new_status text,
  old_price numeric(12,2),
  new_price numeric(12,2),
  reason text,
  created_at timestamptz not null default now()
);
alter table private.listing_management_audit enable row level security;
revoke all on private.listing_management_audit from public, anon, authenticated;

-- Only owner may mutate their listing; no client can directly UPDATE rows.
-- Updates cannot affect a listing while a demo order is unsettled.
create or replace function public.manage_own_listing(
  p_listing_id uuid,
  p_action text,
  p_price numeric default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_listing public.gift_card_listings%rowtype;
  v_next_status text;
  v_next_price numeric;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='28000'; end if;
  if p_action is null or p_action not in ('price', 'pause', 'resume', 'remove') then
    raise exception 'Invalid listing action' using errcode='22023';
  end if;

  select * into v_listing
  from public.gift_card_listings
  where id = p_listing_id and seller_id = v_user
  for update;
  if not found then raise exception 'Listing not found or access denied' using errcode='42501'; end if;

  if exists (
    select 1 from public.demo_orders
    where listing_id = p_listing_id and status = 'held'
  ) then
    raise exception 'Listing has an unsettled order' using errcode='23514';
  end if;

  if (select count(*) from private.listing_management_audit
      where actor_id = v_user and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many listing changes; try again later' using errcode='23514';
  end if;

  v_next_status := v_listing.status;
  v_next_price := v_listing.price;

  if p_action = 'price' then
    if v_listing.status not in ('active', 'paused') or v_listing.expires_on < current_date
       or v_listing.photo_review_status = 'rejected' then
      raise exception 'This listing cannot be edited' using errcode='23514';
    end if;
    if p_price is null or p_price <= 0 or p_price >= v_listing.value
       or p_price <> pg_catalog.round(p_price, 2) then
      raise exception 'Price must be positive, have at most 2 decimals and be below face value'
        using errcode='22023';
    end if;
    v_next_price := p_price;
    if v_next_price = v_listing.price then return; end if;
  elsif p_action = 'pause' then
    if v_listing.status <> 'active' then
      raise exception 'Only active listings can be paused' using errcode='23514';
    end if;
    v_next_status := 'paused';
  elsif p_action = 'resume' then
    if v_listing.status <> 'paused' or v_listing.photo_review_status <> 'approved'
       or v_listing.expires_on < current_date then
      raise exception 'Listing must be approved and unexpired to resume' using errcode='23514';
    end if;
    v_next_status := 'active';
  elsif p_action = 'remove' then
    if v_listing.status not in ('active', 'paused') then
      raise exception 'This listing cannot be removed' using errcode='23514';
    end if;
    v_next_status := 'removed';
  end if;

  update public.gift_card_listings
  set status = v_next_status, price = v_next_price
  where id = p_listing_id;

  insert into private.listing_management_audit (
    listing_id, actor_id, action, old_status, new_status, old_price, new_price
  ) values (
    p_listing_id, v_user, p_action, v_listing.status, v_next_status,
    v_listing.price, v_next_price
  );
end;
$$;
revoke all on function public.manage_own_listing(uuid,text,numeric) from public, anon, authenticated;
grant execute on function public.manage_own_listing(uuid,text,numeric) to authenticated;

-- Admin queue includes ONLY submitted proof metadata, never present card codes.
create or replace function public.admin_listing_review_queue(
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
  proof_code text
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
         p.submitted_at, p.photo_path, c.proof_code
  from public.gift_card_listings l
  join private.listing_photo_submissions p on p.listing_id = l.id
  join private.listing_photo_challenges c on c.id = p.challenge_id
  where l.photo_review_status = 'pending'
    and l.status in ('active', 'paused')
  order by p.submitted_at asc, l.id asc
  limit p_limit offset p_offset;
end;
$$;
revoke all on function public.admin_listing_review_queue(integer,integer)
  from public, anon, authenticated;
grant execute on function public.admin_listing_review_queue(integer,integer) to authenticated;

create or replace function public.admin_review_listing(
  p_listing_id uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_listing public.gift_card_listings%rowtype;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if not public.is_passiton_admin() then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid review decision' using errcode='22023';
  end if;
  if pg_catalog.char_length(v_reason) > 500
     or (p_decision = 'rejected' and pg_catalog.char_length(v_reason) < 10) then
    raise exception 'Rejection requires a reason of 10 to 500 characters' using errcode='22023';
  end if;

  select * into v_listing from public.gift_card_listings
  where id = p_listing_id for update;
  if not found or v_listing.photo_review_status <> 'pending'
     or v_listing.status not in ('active', 'paused') then
    raise exception 'Listing is not awaiting review' using errcode='23514';
  end if;
  if p_decision = 'approved' and v_listing.expires_on < current_date then
    raise exception 'Cannot approve an expired gift card' using errcode='23514';
  end if;
  if not exists (
    select 1
    from private.listing_photo_submissions p
    join private.listing_photo_challenges c on c.id = p.challenge_id
    join storage.objects o
      on o.bucket_id = 'passiton-photo-proofs' and o.name = p.photo_path
    where p.listing_id = p_listing_id
      and p.seller_id = v_listing.seller_id
      and c.seller_id = p.seller_id
      and c.consumed_at is not null
      and o.created_at >= c.created_at
      and o.created_at <= c.expires_at
  ) then
    raise exception 'No valid submitted proof available' using errcode='23514';
  end if;

  update public.gift_card_listings
  set photo_review_status = p_decision,
      photo_review_reason = case when p_decision = 'rejected' then v_reason else null end
  where id = p_listing_id;

  insert into private.listing_management_audit (
    listing_id, actor_id, action, old_status, new_status,
    old_price, new_price, reason
  ) values (
    p_listing_id, v_admin,
    case when p_decision = 'approved' then 'approve' else 'reject' end,
    v_listing.status, v_listing.status, v_listing.price, v_listing.price,
    nullif(v_reason, '')
  );
end;
$$;
revoke all on function public.admin_review_listing(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_review_listing(uuid,text,text) to authenticated;

-- Admin may sign short-lived URLs ONLY for submitted private review photos.
-- Raw client access to private tables remains denied.
create or replace function public.admin_can_view_listing_proof(p_path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_passiton_admin()
    and exists (
      select 1 from private.listing_photo_submissions p
      where p.photo_path = p_path
    );
$$;
revoke all on function public.admin_can_view_listing_proof(text)
  from public, anon, authenticated;
grant execute on function public.admin_can_view_listing_proof(text) to authenticated;

drop policy if exists "Passiton: admin reads submitted proofs" on storage.objects;
create policy "Passiton: admin reads submitted proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'passiton-photo-proofs'
    and public.admin_can_view_listing_proof(name)
  );

comment on function public.manage_own_listing(uuid,text,numeric) is
  'Owner-only soft actions and price updates, guarded against unsettled demo orders.';
comment on function public.admin_review_listing(uuid,text,text) is
  'Administrator manual photo review with validation and immutable audit events.';

commit;
