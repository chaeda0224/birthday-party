alter table public.bp_profiles add column long_candles integer not null default 0 check(long_candles between 0 and 12),add column short_candles integer not null default 5 check(short_candles between 0 and 9),add column photo_placement text not null default 'topper' check(photo_placement in ('topper','background','both')),add check(long_candles+short_candles>0);
create or replace function private.bp_prof(i uuid) returns jsonb language sql stable set search_path='' as $$ select jsonb_build_object('name',name,'month',month,'day',day,'gender',gender,'honorific',honorific,'message',message,'theme',theme,'decoration',decoration,'photoId',photo_id,'profileRevision',profile_revision,'longCandles',long_candles,'shortCandles',short_candles,'photoPlacement',photo_placement) from public.bp_profiles where room_id=i $$;
create or replace function public.bp_create_room(p_profile jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;m public.bp_members;token text:=encode(extensions.gen_random_bytes(32),'hex');p jsonb:=p_profile;
begin
 if (select count(*) from public.bp_rooms where host_id=u and ended_at is null and expires_at>clock_timestamp())>=3 then raise exception using errcode='P0001',message='RATE_LIMITED';end if;
 if jsonb_typeof(p)<>'object' or char_length(btrim(p->>'name')) not between 1 and 20 or coalesce((p->>'month')::int,0) not between 1 and 12 or coalesce((p->>'day')::int,0) not between 1 and 31 then raise exception using errcode='22023',message='INVALID_PROFILE';end if;
 insert into public.bp_rooms(host_id) values(u) returning * into r;
 insert into public.bp_members(room_id,user_id,role) values(r.id,u,'host') returning * into m;
 insert into public.bp_profiles(room_id,name,month,day,gender,honorific,message,theme,decoration)
 values(r.id,btrim(p->>'name'),(p->>'month')::int,(p->>'day')::int,coalesce(p->>'gender','common'),coalesce(btrim(p->>'honorific'),''),coalesce(btrim(p->>'message'),''),coalesce(p->>'theme','strawberry'),coalesce(p->>'decoration','none'));
 update public.bp_profiles set long_candles=coalesce((p->>'longCandles')::int,0),short_candles=coalesce((p->>'shortCandles')::int,5),photo_placement=coalesce(p->>'photoPlacement','topper') where room_id=r.id;
 insert into public.bp_invites values(extensions.digest(token,'sha256'),r.id,r.expires_at);
 return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id),'memberId',m.member_id,'isHost',true,'inviteToken',token);
end $$;
create or replace function public.bp_update_profile(p_room_id uuid,p_profile jsonb,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;if p.profile_revision is distinct from p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.phase not in ('waiting','preparing','lit','blowing','celebrating') or (r.phase in ('lit','blowing') and not r.paused) then raise exception using errcode='P0001',message='HOST_PAUSED';end if;
 update public.bp_profiles set name=btrim(p_profile->>'name'),month=(p_profile->>'month')::int,day=(p_profile->>'day')::int,gender=p_profile->>'gender',
 honorific=btrim(coalesce(p_profile->>'honorific','')),message=btrim(coalesce(p_profile->>'message','')),theme=p_profile->>'theme',decoration=p_profile->>'decoration',long_candles=coalesce((p_profile->>'longCandles')::int,0),short_candles=coalesce((p_profile->>'shortCandles')::int,5),photo_placement=coalesce(p_profile->>'photoPlacement','topper'),profile_revision=profile_revision+1
 where room_id=r.id returning * into p;
 update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);
 return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id));
end $$;
create or replace function public.bp_role_ack(p_room_id uuid,p_member_id uuid,p_role text,p_kind text,p_round_id uuid,p_control_revision bigint,p_role_epoch bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);
 if not exists(select 1 from public.bp_members where room_id=r.id and user_id=u and member_id=p_member_id) then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 if p_round_id is distinct from r.round_id or p_control_revision is distinct from r.control_revision or p_role_epoch is distinct from r.role_epoch then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if p_role='audio' and r.audio_id=p_member_id and p_kind='ready' then
  if r.phase='blowing' then raise exception 'AUDIO_STOP_UNCONFIRMED';end if; update public.bp_rooms set audio_ack_kind=null,audio_ack_epoch=null,audio_ack_round=null,audio_ack_control=null,audio_ack_member=null,audio_lease_until=clock_timestamp()+interval '30 seconds',last_audio_lease_until=clock_timestamp()+interval '30 seconds',revision=revision+1 where id=r.id returning * into r;
 elsif p_role='audio' and r.audio_id=p_member_id and p_kind='stopped' then update public.bp_rooms set audio_lease_until=clock_timestamp(),last_audio_lease_until=clock_timestamp(),audio_ack_epoch=r.role_epoch,audio_ack_kind='stopped',audio_ack_member=p_member_id,audio_ack_round=r.round_id,audio_ack_control=r.control_revision,revision=revision+1 where id=r.id returning * into r;
 elsif p_role='mic' and r.mic_id=p_member_id and p_kind in ('ready','stopped') then update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;
 else raise exception using errcode='P0001',message='ROLE_NOT_ASSIGNED';end if;perform private.bp_emit(r);return private.bp_snap(r);
end $$;
notify pgrst,'reload schema';
