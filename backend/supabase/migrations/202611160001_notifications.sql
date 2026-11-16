-- NS-01: Event-driven, opt-in notifications for the PassItOn DEMO.
-- Run after 202611050001_saved_listings.sql. No payments are captured.
begin;

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_offers boolean not null default false,
  email_purchases boolean not null default false,
  email_verification boolean not null default false,
  email_cases boolean not null default false,
  email_saved_price_drop boolean not null default false,
  email_saved_sold boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
drop policy if exists "notification_preferences_select_own" on public.notification_preferences;
create policy "notification_preferences_select_own" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notification_preferences_insert_own" on public.notification_preferences;
create policy "notification_preferences_insert_own" on public.notification_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "notification_preferences_update_own" on public.notification_preferences;
create policy "notification_preferences_update_own" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function private.notification_preferences_timestamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists notification_preferences_timestamp on public.notification_preferences;
create trigger notification_preferences_timestamp before update
on public.notification_preferences for each row
execute function private.notification_preferences_timestamp();

-- Auth metadata is submitted as part of signUp so it also works when email
-- confirmation is required (and there is no client session yet).
create or replace function private.create_notification_preferences_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_opt jsonb := coalesce(new.raw_user_meta_data -> 'passiton_email_preferences', '{}'::jsonb);
begin
  insert into public.notification_preferences (
    user_id, email_offers, email_purchases, email_verification, email_cases
  ) values (
    new.id,
    (v_opt ->> 'offers') = 'true',
    (v_opt ->> 'purchases') = 'true',
    (v_opt ->> 'verification') = 'true',
    (v_opt ->> 'cases') = 'true'
  ) on conflict (user_id) do nothing;
  return new;
end; $$;
drop trigger if exists passiton_create_notification_preferences on auth.users;
create trigger passiton_create_notification_preferences after insert on auth.users
for each row execute function private.create_notification_preferences_for_user();
-- Existing accounts are opted OUT until they make their own choices.
insert into public.notification_preferences(user_id)
select id from auth.users on conflict (user_id) do nothing;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null check (char_length(title) between 1 and 180),
  message text not null check (char_length(message) between 1 and 800),
  related_entity_type text check (related_entity_type in ('listing','offer','order','dispute')),
  related_entity_id uuid,
  event_key text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_deduplicate unique(user_id,event_key),
  constraint notifications_read_time check (is_read or read_at is null)
);
create index if not exists notifications_user_created_idx
  on public.notifications(user_id,created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications(user_id,created_at desc) where is_read = false;
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications for select
  to authenticated using (user_id = (select auth.uid()));
drop policy if exists "notifications_mark_own_read" on public.notifications;
create policy "notifications_mark_own_read" on public.notifications for update
  to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Only trusted DB triggers can create notifications; the web client has no INSERT grant.
create or replace function private.emit_passiton_notification(
  p_user uuid, p_type text, p_title text, p_message text,
  p_target_type text, p_target_id uuid, p_event_key text
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications
    (user_id,type,title,message,related_entity_type,related_entity_id,event_key)
  values
    (p_user,p_type,p_title,p_message,p_target_type,p_target_id,p_event_key)
  on conflict (user_id,event_key) do nothing;
end; $$;
revoke all on function private.emit_passiton_notification(uuid,text,text,text,text,uuid,text)
  from public, anon, authenticated;

-- Private outbox; email addresses are NEVER exposed through notifications.
create table if not exists private.notification_email_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('offers','purchases','verification','cases','saved_price_drop','saved_sold')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  sent_at timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists notification_outbox_dispatch_idx
  on private.notification_email_outbox(status,available_at,created_at);
alter table private.notification_email_outbox enable row level security;
revoke all on private.notification_email_outbox from public, anon, authenticated;

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
    when new.type in ('verification_approved','verification_rejected') then 'verification'
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
drop trigger if exists queue_passiton_email on public.notifications;
create trigger queue_passiton_email after insert on public.notifications
for each row execute function private.queue_passiton_email();

-- Manual review and saved-listing price/sale watches.
create or replace function private.notify_listing_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_saved record;
  v_event text;
begin
  if old.photo_review_status is distinct from new.photo_review_status then
    if new.photo_review_status='approved' then
      perform private.emit_passiton_notification(new.seller_id,'verification_approved',
        'Ditt fotobevis har godkänts',
        'Fotogranskningen av ditt ' || new.brand || '-presentkort är klar. Granskningen garanterar inte kortets saldo.',
        'listing',new.id,'review:' || new.id::text || ':approved');
    elsif new.photo_review_status='rejected' then
      perform private.emit_passiton_notification(new.seller_id,'verification_rejected',
        'Ditt fotobevis har nekats',
        'Fotobeviset för ditt ' || new.brand || '-presentkort godkändes inte. Läs beslutet under dina annonser.',
        'listing',new.id,'review:' || new.id::text || ':rejected');
    end if;
  end if;
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
drop trigger if exists notify_listing_changes on public.gift_card_listings;
create trigger notify_listing_changes after update of photo_review_status,price,status
on public.gift_card_listings for each row
execute function private.notify_listing_changes();

create or replace function private.notify_offer_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_brand text;
begin
  select brand into v_brand from public.gift_card_listings where id=new.listing_id;
  if tg_op='INSERT' then
    perform private.emit_passiton_notification(new.seller_id,'offer_received',
      'Du har fått ett prisförslag', 'Du har fått ett nytt prisförslag på ditt ' || v_brand || '-presentkort.',
      'offer',new.id,'offer:' || new.id::text || ':received');
    return new;
  end if;
  if old.status is not distinct from new.status then return new; end if;
  if new.status='accepted_awaiting_payment' then
    perform private.emit_passiton_notification(new.buyer_id,'offer_accepted',
      'Ditt prisförslag har accepterats',
      'Ditt prisförslag på ' || v_brand || '-presentkortet har accepterats. Du har 24 timmar att slutföra demoköpet.',
      'offer',new.id,'offer:' || new.id::text || ':accepted');
  elsif new.status='countered' then
    perform private.emit_passiton_notification(new.buyer_id,'offer_countered',
      'Du har fått ett motbud', 'Säljaren har lämnat ett motbud på ' || v_brand || '-presentkortet.',
      'offer',new.id,'offer:' || new.id::text || ':countered');
  elsif new.status='declined' and auth.uid() is distinct from new.buyer_id then
    perform private.emit_passiton_notification(new.buyer_id,'offer_declined',
      'Ditt prisförslag har nekats', 'Säljaren har nekat ditt prisförslag på ' || v_brand || '-presentkortet.',
      'offer',new.id,'offer:' || new.id::text || ':declined');
  elsif new.status='expired' then
    perform private.emit_passiton_notification(new.buyer_id,'offer_expired',
      'Ditt prisförslag har löpt ut', 'Tidsfristen för ditt prisförslag har passerat.',
      'offer',new.id,'offer:' || new.id::text || ':expired');
  elsif new.status='payment_expired' then
    perform private.emit_passiton_notification(new.buyer_id,'offer_payment_expired',
      'Tiden för demoköpet har gått ut', 'Betalningsfristen för ditt accepterade prisförslag har passerat. Inga pengar drogs.',
      'offer',new.id,'offer:' || new.id::text || ':payment-expired');
  end if;
  return new;
end; $$;
drop trigger if exists notify_offer_changes on public.price_offers;
create trigger notify_offer_changes after insert or update of status
on public.price_offers for each row
execute function private.notify_offer_changes();

-- All orders are demo-only. Never say money was charged, paid out or refunded.
create or replace function private.notify_demo_order_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_passiton_notification(new.buyer_id,'demo_purchase',
    'Din demoorder är registrerad',
    'Ett testköp har registrerats. Ingen riktig betalning har genomförts.',
    'order',new.id,'demo-order:' || new.id::text || ':buyer');
  perform private.emit_passiton_notification(new.seller_id,'demo_sale',
    'Din annons ingår i en demoorder',
    'Ditt presentkort har använts i ett testköp. Inga pengar har betalats ut.',
    'order',new.id,'demo-order:' || new.id::text || ':seller');
  return new;
end; $$;
drop trigger if exists notify_demo_order_created on public.demo_orders;
create trigger notify_demo_order_created after insert on public.demo_orders
for each row execute function private.notify_demo_order_created();

create or replace function private.notify_dispute_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_title text;
  v_text text;
begin
  if tg_op='INSERT' then
    v_kind:='dispute_opened';
    v_title:='Ett nytt demoärende har öppnats';
    v_text:='Ett ärende har öppnats för en demoorder. Se uppgifterna under Order och dispyter.';
  elsif old.status is distinct from new.status then
    v_kind:=case when new.status='resolved' then 'dispute_resolved' else 'dispute_updated' end;
    v_title:=case when new.status='resolved' then 'Demoärendet har avslutats' else 'Demoärendet har uppdaterats' end;
    v_text:='Statusen för ett demoärende har ändrats. Öppna ärendet för mer information.';
  else
    return new;
  end if;
  perform private.emit_passiton_notification(new.buyer_id,v_kind,v_title,v_text,
    'dispute',new.id,'dispute:' || new.id::text || ':' || v_kind);
  perform private.emit_passiton_notification(new.seller_id,v_kind,v_title,v_text,
    'dispute',new.id,'dispute:' || new.id::text || ':' || v_kind);
  return new;
end; $$;
drop trigger if exists notify_dispute_changes on public.demo_disputes;
create trigger notify_dispute_changes after insert or update of status
on public.demo_disputes for each row execute function private.notify_dispute_changes();

create or replace function private.notify_dispute_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_case public.demo_disputes%rowtype;
begin
  if new.kind='system' or new.author_id is null then return new; end if;
  select * into v_case from public.demo_disputes where id=new.dispute_id;
  if not found then return new; end if;
  if new.author_id<>v_case.buyer_id then
    perform private.emit_passiton_notification(v_case.buyer_id,'dispute_message',
      'Nytt svar i ditt demoärende', 'Du har fått ett nytt svar i ett pågående demoärende.',
      'dispute',new.dispute_id,'dispute-message:' || new.id::text || ':buyer');
  end if;
  if new.author_id<>v_case.seller_id then
    perform private.emit_passiton_notification(v_case.seller_id,'dispute_message',
      'Nytt svar i ditt demoärende', 'Du har fått ett nytt svar i ett pågående demoärende.',
      'dispute',new.dispute_id,'dispute-message:' || new.id::text || ':seller');
  end if;
  return new;
end; $$;
drop trigger if exists notify_dispute_message on public.demo_dispute_messages;
create trigger notify_dispute_message after insert on public.demo_dispute_messages
for each row execute function private.notify_dispute_message();

-- Run this with pg_cron every five minutes. A unique event key makes it repeat-safe.
create or replace function private.notify_offer_payment_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_offer record; v_count integer := 0;
begin
  -- Expire overdue offers even if nobody has visited the offer dashboard.
  for v_offer in select distinct buyer_id from public.price_offers
    where (status in ('pending_seller','countered') and offer_expires_at <= now())
       or (status='accepted_awaiting_payment' and payment_due_at <= now()) loop
    perform private.expire_buyer_price_offers(v_offer.buyer_id);
  end loop;

  -- Warn about ordinary offers shortly before the seller's deadline.
  for v_offer in select id,buyer_id,seller_id from public.price_offers
    where status='pending_seller'
      and offer_expires_at > now()
      and offer_expires_at <= now() + interval '1 hour' loop
    perform private.emit_passiton_notification(v_offer.seller_id,'offer_expiring',
      'Prisförslag löper snart ut',
      'Du har mindre än en timme på dig att besvara ett mottaget prisförslag.',
      'offer',v_offer.id,'offer:' || v_offer.id::text || ':1h');
  end loop;

  for v_offer in select id,buyer_id from public.price_offers
    where status='accepted_awaiting_payment'
      and payment_due_at > now()
      and payment_due_at <= now() + interval '6 hours' loop
    perform private.emit_passiton_notification(v_offer.buyer_id,'offer_payment_due',
      '6 timmar kvar att slutföra demoköpet',
      'Ditt accepterade prisförslag löper snart ut. Slutför testköpet innan tidsfristen.',
      'offer',v_offer.id,'offer:' || v_offer.id::text || ':6h');
    v_count := v_count+1;
  end loop;
  return v_count;
end; $$;
revoke all on function private.notify_offer_payment_reminders() from public,anon,authenticated;

-- Service-role-only RPCs for the Edge Function. Never expose raw auth.users emails to clients.
create or replace function public.notification_claim_email_batch(p_limit integer default 20)
returns table (
  queue_id uuid, notification_id uuid, attempt integer, recipient_email text,
  notification_type text, email_title text, email_message text,
  target_type text, target_id uuid
)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  -- Cancel queued opt-in mail if the user opted out in the meantime.
  update private.notification_email_outbox q
  set status='skipped', locked_until=null
  where q.status in ('pending','processing')
    and (q.status='pending' or q.locked_until < now())
    and not exists (
      select 1 from public.notification_preferences p
      where p.user_id=q.user_id and case q.category
        when 'offers' then p.email_offers
        when 'purchases' then p.email_purchases
        when 'verification' then p.email_verification
        when 'cases' then p.email_cases
        when 'saved_price_drop' then p.email_saved_price_drop
        when 'saved_sold' then p.email_saved_sold
        else false end
    );
  return query
    with picked as (
      select q.id from private.notification_email_outbox q
      where (q.status='pending' or (q.status='processing' and q.locked_until < now()))
        and q.available_at <= now() and q.attempts < 5
      order by q.created_at
      limit greatest(1,least(coalesce(p_limit,20),50))
      for update skip locked
    ), claimed as (
      update private.notification_email_outbox q
      set status='processing',attempts=q.attempts+1,
          locked_until=now()+interval '3 minutes'
      from picked where picked.id=q.id
      returning q.id,q.notification_id,q.attempts,q.user_id
    )
    select c.id,c.notification_id,c.attempts,u.email::text,n.type,n.title,
      n.message,n.related_entity_type,n.related_entity_id
    from claimed c
    join auth.users u on u.id=c.user_id
    join public.notifications n on n.id=c.notification_id
    where u.email is not null and u.email_confirmed_at is not null;
end; $$;
revoke all on function public.notification_claim_email_batch(integer) from public,anon,authenticated;
grant execute on function public.notification_claim_email_batch(integer) to service_role;

create or replace function public.notification_finish_email(
  p_queue_id uuid, p_attempt integer, p_success boolean,
  p_provider_id text default null, p_error text default null
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  update private.notification_email_outbox q
  set status=case when p_success then 'sent'
                  when q.attempts>=5 then 'failed' else 'pending' end,
      sent_at=case when p_success then now() else null end,
      provider_id=case when p_success then left(p_provider_id,200) else null end,
      last_error=case when p_success then null else left(coalesce(p_error,'Mail error'),500) end,
      available_at=case when p_success then q.available_at
        else now()+make_interval(mins => (2 ^ least(q.attempts,6))::integer) end,
      locked_until=null
  where q.id=p_queue_id and q.attempts=p_attempt and q.status='processing';
end; $$;
revoke all on function public.notification_finish_email(uuid,integer,boolean,text,text) from public,anon,authenticated;
grant execute on function public.notification_finish_email(uuid,integer,boolean,text,text) to service_role;

-- Supabase Realtime streams only rows visible to the signed-in account.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

commit;
