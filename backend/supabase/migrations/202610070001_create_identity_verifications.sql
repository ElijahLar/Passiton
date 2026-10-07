begin;

create table if not exists public.identity_verifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_verification_session_id text unique,
  status text not null default 'requires_input'
    check (status in ('requires_input', 'processing', 'verified', 'canceled', 'redacted')),
  last_error_code text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.identity_verifications enable row level security;

alter table public.gift_card_listings
  add column if not exists seller_identity_verified boolean not null default false;
revoke all on table public.identity_verifications from anon, authenticated;
grant select on table public.identity_verifications to authenticated;

drop policy if exists "Users can read their own identity status" on public.identity_verifications;
create policy "Users can read their own identity status"
  on public.identity_verifications
  for select
  to authenticated
  using (user_id = (select auth.uid()));

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

  if not exists (
    select 1
    from public.identity_verifications
    where user_id = v_seller_id
      and status = 'verified'
  ) then
    raise exception 'Identity verification required';
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
    expires_on,
    seller_identity_verified
  )
  values (
    v_seller_id,
    'Privat säljare',
    p_brand,
    p_category,
    p_value,
    p_price,
    p_expires_on,
    true
  )
  returning id into v_listing_id;

  insert into private.gift_card_secrets (listing_id, seller_id, gift_card_code)
  values (v_listing_id, v_seller_id, pg_catalog.btrim(p_gift_card_code));

  return v_listing_id;
end;
$$;

revoke execute on function public.create_gift_card_listing(text, text, numeric, numeric, date, text)
  from public, anon, authenticated;
grant execute on function public.create_gift_card_listing(text, text, numeric, numeric, date, text)
  to authenticated;

comment on table public.identity_verifications is
  'Stripe Identity status for each Supabase user. No identity document data is stored in Passiton.';
comment on column public.gift_card_listings.seller_identity_verified is
  'Snapshot showing whether the seller had passed Passiton identity verification when this listing was created.';
comment on function public.create_gift_card_listing(text, text, numeric, numeric, date, text) is
  'Creates a listing only for authenticated users whose Stripe Identity status is verified.';

commit;
