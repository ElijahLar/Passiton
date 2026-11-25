-- Run against a disposable migrated Supabase project as postgres. All fixtures roll back.
begin;
do $$
declare
 seller uuid:=gen_random_uuid(); buyer uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid();
 challenge uuid; path text; listing uuid; duplicate uuid; sale uuid; sample text:='1048227777';
 checks boolean[]:=array[true,true,true,true,true,true]; bid uuid;
begin
 insert into auth.users(id,raw_user_meta_data) select id,'{"passiton_email_preferences":{"offers":false,"purchases":false,"verification":true,"cases":false}}'::jsonb from unnest(array[seller,buyer,reviewer]) id;
 insert into private.passiton_admins(user_id) values(reviewer);
 insert into public.gift_card_brands(name,category,status,digital,balance_url,method,code_pattern,pin_required,pin_pattern,reviewed_at,ignore_spaces)
 values('Patchtest','Sport','active',true,'https://example.invalid/check','Manuell','[0-9]{10}',true,'[0-9]{4}',now(),true);
 perform set_config('request.jwt.claim.sub',seller::text,true);
 select challenge_id into challenge from public.begin_listing_photo_proof();
 path:=seller||'/'||challenge||'/'||gen_random_uuid()||'.jpg';
 insert into storage.objects(bucket_id,name) values('passiton-photo-proofs',path);
 listing:=public.create_gift_card_listing('Patchtest','Sport',100,85,current_date+60,'10482 27777',challenge,path,'1234');
 assert listing is not null;
 begin
  perform public.review_credentials(listing);
  raise exception 'Unexpected access';
 exception when raise_exception then if sqlerrm='Unexpected access' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 select challenge_id into challenge from public.begin_listing_photo_proof();
 path:=buyer||'/'||challenge||'/'||gen_random_uuid()||'.jpg';
 insert into storage.objects(bucket_id,name) values('passiton-photo-proofs',path);
 duplicate:=public.create_gift_card_listing('Patchtest','Sport',100,80,current_date+60,sample,challenge,path,'1234');
 assert duplicate is null;
 assert exists(select 1 from private.card_events where actor=buyer and event='duplicate_attempt');
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 assert exists(select 1 from public.admin_listing_review_queue() where listing_id=listing);
 assert public.review_credentials(listing)->>'code'=sample;
 begin
  perform public.review_card(listing,'approved','passed',50,null,checks,null,null);
  raise exception 'Wrong amount accepted';
 exception when raise_exception then if sqlerrm='Wrong amount accepted' then raise; end if; end;
 perform public.review_card(listing,'approved','passed',100,current_date+60,checks,null,null);
 assert public.card_balance_current(listing);
 assert exists(select 1 from private.gift_card_balance_checks as c where c.listing_id=listing and c.reviewer=auth.uid());
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 perform public.price_offer_create(listing,70);
 select id into bid from public.price_offers where listing_id=listing;
 perform set_config('request.jwt.claim.sub',seller::text,true);
 perform public.price_offer_seller_action(bid,'accept',null);
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 update public.gift_card_listings set balance_checked_at=now()-interval '400 days' where id=listing;
 assert not public.card_balance_current(listing);
 begin
  perform public.demo_buy_accepted_offer(bid);
  raise exception 'Stale checkout accepted';
 exception when raise_exception then if sqlerrm='Stale checkout accepted' then raise; end if; end;
 -- A payment timeout racing the maintenance job must not penalize the buyer.
 update public.gift_card_listings set balance_checked_at=now() where id=listing;
 update public.price_offers set payment_due_at=now()-interval '1 second' where id=bid;
 update public.gift_card_listings set balance_checked_at=now()-interval '400 days' where id=listing;
 perform private.expire_buyer_price_offers(buyer);
 assert not exists(select 1 from private.offer_payment_misses where offer_id=bid);
 perform private.refresh_card_reviews();
 assert exists(select 1 from public.price_offers where listing_id=listing and status='cancelled');
 perform set_config('request.jwt.claim.sub',reviewer::text,true);
 perform public.review_credentials(listing);
 perform public.review_card(listing,'approved','passed',100,null,checks,null,null);
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 sale:=public.demo_create_order(listing);
 assert exists(select 1 from public.demo_orders where id=sale);
 assert not has_table_privilege('authenticated','private.gift_card_secrets','select');
 assert not has_function_privilege('anon','public.review_credentials(uuid)','execute');
 assert not has_function_privilege('authenticated','private.admin_review_listing(uuid,text,text)','execute');
end $$;
set local role anon;
select count(*) from public.gift_card_brands;
select count(*) from public.gift_card_listings;
rollback;
