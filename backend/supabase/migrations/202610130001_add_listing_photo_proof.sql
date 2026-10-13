-- Free 30-minute photo proof for Passiton listings.
-- Apply after 202610060001_create_gift_card_listings.sql.
begin;

create table if not exists private.listing_photo_challenges (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  proof_code text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  check (expires_at > created_at)
);

create index if not exists listing_photo_challenges_seller_idx
  on private.listing_photo_challenges(seller_id, created_at desc);
alter table private.listing_photo_challenges enable row level security;
revoke all on private.listing_photo_challenges from public, anon, authenticated;

alter table public.gift_card_listings
  add column if not exists photo_review_status text not null default 'pending'
  check (photo_review_status in ('pending', 'approved', 'rejected'));

create table if not exists private.listing_photo_submissions (
  listing_id uuid primary key references public.gift_card_listings(id) on delete cascade,
  challenge_id uuid not null unique references private.listing_photo_challenges(id),
  seller_id uuid not null references auth.users(id) on delete cascade,
  photo_path text not null unique,
  submitted_at timestamptz not null default now()
);
alter table private.listing_photo_submissions enable row level security;
revoke all on private.listing_photo_submissions from public, anon, authenticated;

-- Photos must never be served from a public bucket: they may show balances,
-- receipts, partial card numbers or other sensitive information.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'passiton-photo-proofs', 'passiton-photo-proofs', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Only the authenticated owner may upload into an unused, unexpired challenge.
create or replace function public.can_upload_listing_photo_proof(p_path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and pg_catalog.split_part(p_path, '/', 1) = (select auth.uid())::text
    and pg_catalog.split_part(p_path, '/', 4) = ''
    and pg_catalog.split_part(p_path, '/', 3) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    and exists (
      select 1
      from private.listing_photo_challenges c
      where c.seller_id = (select auth.uid())
        and c.id::text = pg_catalog.split_part(p_path, '/', 2)
        and c.consumed_at is null
        and c.expires_at > now()
    );
$$;
revoke all on function public.can_upload_listing_photo_proof(text) from public, anon;
grant execute on function public.can_upload_listing_photo_proof(text) to authenticated;

drop policy if exists "Passiton: upload own active proof" on storage.objects;
create policy "Passiton: upload own active proof"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'passiton-photo-proofs'
    and public.can_upload_listing_photo_proof(name)
  );

drop policy if exists "Passiton: read own proof photos" on storage.objects;
create policy "Passiton: read own proof photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'passiton-photo-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- On regeneration, earlier codes become unusable.
create or replace function public.begin_listing_photo_proof()
returns table(challenge_id uuid, proof_code text, expires_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := auth.uid();
begin
  if v_seller_id is null then
    raise exception 'Authentication required';
  end if;

  -- Serialize concurrent requests from the same seller.
  perform 1 from auth.users where id = v_seller_id for update;
  update private.listing_photo_challenges
    set consumed_at = now()
    where seller_id = v_seller_id and consumed_at is null;

  return query
    insert into private.listing_photo_challenges(seller_id, proof_code)
    values (
      v_seller_id,
      'PASS-' || pg_catalog.upper(
        pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12)
      )
    )
    returning id, listing_photo_challenges.proof_code, listing_photo_challenges.expires_at;
end;
$$;
revoke all on function public.begin_listing_photo_proof() from public, anon;
grant execute on function public.begin_listing_photo_proof() to authenticated;

-- The old six-argument RPC must not be callable; it bypasses the proof step.
drop function if exists public.create_gift_card_listing(text, text, numeric, numeric, date, text);

create function public.create_gift_card_listing(
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
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
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
revoke all on function public.create_gift_card_listing(text,text,numeric,numeric,date,text,uuid,text)
  from public, anon;
grant execute on function public.create_gift_card_listing(text,text,numeric,numeric,date,text,uuid,text)
  to authenticated;

-- Do not expose new or legacy listings until a person reviews the proof photo.
drop policy if exists "Active listings are public; sellers can see their own" on public.gift_card_listings;
create policy "Approved listings are public; sellers can see their own"
  on public.gift_card_listings for select to anon, authenticated
  using (
    (status = 'active' and photo_review_status = 'approved')
    or seller_id = (select auth.uid())
  );

comment on column public.gift_card_listings.photo_review_status is
  'Manual review of freshness/possession photo only; does not prove card balance or validity.';
comment on function public.begin_listing_photo_proof() is
  'Issues a single-use 30-minute code for a new proof photo.';
comment on function public.create_gift_card_listing(text,text,numeric,numeric,date,text,uuid,text) is
  'Requires a nonexpired challenge and private uploaded photo; listing awaits manual review.';

commit;
