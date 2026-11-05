-- PassItOn: persistent favorites for authenticated accounts.
-- Run after the gift_card_listings and photo-review migrations.
-- Demo cards are not stored here (they have no listing UUID).
begin;

create table if not exists public.saved_listings (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.gift_card_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint saved_listings_pkey primary key (user_id, listing_id)
);

create index if not exists saved_listings_user_recent_idx
  on public.saved_listings(user_id, created_at desc);

alter table public.saved_listings enable row level security;

revoke all on table public.saved_listings from public, anon, authenticated;
grant select, insert, delete on table public.saved_listings to authenticated;

drop policy if exists "Users can read their saved listings" on public.saved_listings;
create policy "Users can read their saved listings"
  on public.saved_listings for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can save approved active listings" on public.saved_listings;
create policy "Users can save approved active listings"
  on public.saved_listings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.gift_card_listings l
      where l.id = listing_id
        and l.status = 'active'
        and l.photo_review_status = 'approved'
        and l.expires_on >= current_date
    )
  );

drop policy if exists "Users can remove their saved listings" on public.saved_listings;
create policy "Users can remove their saved listings"
  on public.saved_listings for delete to authenticated
  using (user_id = (select auth.uid()));

comment on table public.saved_listings is
  'Per-user private favorites. Rows are readable and mutable only by their owner; no gift-card codes are exposed.';

commit;
