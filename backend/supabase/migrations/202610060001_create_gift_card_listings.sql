begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.gift_card_listings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  seller_id uuid not null references auth.users (id) on delete cascade,
  seller_name text not null,
  brand text not null check (brand in ('IKEA', 'Zalando', 'H&M', 'Elgiganten', 'Stadium', 'ICA', 'Åhléns', 'SJ')),
  category text not null check (category in ('Hem', 'Mode', 'Elektronik', 'Mat', 'Sport', 'Resor')),
  value numeric(12, 2) not null check (value > 0),
  price numeric(12, 2) not null check (price > 0 and price < value),
  expires_on date not null,
  status text not null default 'active' check (status in ('active', 'sold', 'removed')),
  created_at timestamptz not null default now()
);

create index if not exists gift_card_listings_active_newest_idx
  on public.gift_card_listings (created_at desc)
  where status = 'active';

create index if not exists gift_card_listings_seller_idx
  on public.gift_card_listings (seller_id, created_at desc);

alter table public.gift_card_listings enable row level security;
revoke all on table public.gift_card_listings from anon, authenticated;
grant select on table public.gift_card_listings to anon, authenticated;

drop policy if exists "Active listings are public; sellers can see their own" on public.gift_card_listings;
create policy "Active listings are public; sellers can see their own"
  on public.gift_card_listings
  for select
  to anon, authenticated
  using (status = 'active' or seller_id = (select auth.uid()));

create table if not exists private.gift_card_secrets (
  listing_id uuid primary key references public.gift_card_listings (id) on delete cascade,
  seller_id uuid not null references auth.users (id) on delete cascade,
  gift_card_code text not null,
  created_at timestamptz not null default now()
);

alter table private.gift_card_secrets enable row level security;
revoke all on table private.gift_card_secrets from public, anon, authenticated;

create or replace function public.create_gift_card_listing(
  p_brand text,
  p_category text,
  p_value numeric,
  p_price numeric,
  p_expires_on date,
  p_gift_card_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_id uuid := auth.uid();
  v_listing_id uuid;
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

  insert into public.gift_card_listings (
    seller_id,
    seller_name,
    brand,
    category,
    value,
    price,
    expires_on
  )
  values (
    v_seller_id,
    'Privat säljare',
    p_brand,
    p_category,
    p_value,
    p_price,
    p_expires_on
  )
  returning id into v_listing_id;

  insert into private.gift_card_secrets (listing_id, seller_id, gift_card_code)
  values (v_listing_id, v_seller_id, pg_catalog.btrim(p_gift_card_code));

  return v_listing_id;
end;
$$;

revoke execute on function public.create_gift_card_listing(text, text, numeric, numeric, date, text) from public, anon, authenticated;
grant execute on function public.create_gift_card_listing(text, text, numeric, numeric, date, text) to authenticated;

comment on table public.gift_card_listings is 'Public marketplace details for gift card listings; gift card codes are stored separately in the private schema.';
comment on table private.gift_card_secrets is 'Gift card codes; no direct API access is granted to anon or authenticated clients.';
comment on function public.create_gift_card_listing(text, text, numeric, numeric, date, text) is 'Creates a public listing and its private gift card code atomically for the authenticated seller.';

commit;
