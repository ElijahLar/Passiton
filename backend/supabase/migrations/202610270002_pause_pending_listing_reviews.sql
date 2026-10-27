-- PassItOn IP-01B: pause unreviewed listings without consuming admin time.
-- Apply only AFTER 202610270001_listing_management.sql (already installed).
-- This is an incremental, idempotent update. No payment integration is enabled.
begin;

-- A seller may resume an unexpired unreviewed listing, which enters the
-- existing admin queue again. A rejected, removed or sold listing cannot resume.
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
    if v_listing.status <> 'paused' or v_listing.photo_review_status not in ('pending', 'approved')
       or v_listing.expires_on < current_date then
      raise exception 'Listing must be pending review or approved and unexpired to resume' using errcode='23514';
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

-- Only active pending listings belong in the manual-review queue.
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
    and l.status = 'active'
  order by p.submitted_at asc, l.id asc
  limit p_limit offset p_offset;
end;
$$;

-- Race-safe check on the locked listing: admin cannot approve/reject paused items.
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
     or v_listing.status <> 'active' then
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

commit;
