create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.bp_rooms (
  id uuid primary key default extensions.gen_random_uuid(), host_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '2 hours', ended_at timestamptz,
  round_id uuid not null default extensions.gen_random_uuid(), revision bigint not null default 1,
  control_revision bigint not null default 1,
  phase text not null default 'waiting' check (phase in ('waiting','preparing','lit','blowing','celebrating','ended')),
  paused boolean not null default false, charge integer not null default 0 check(charge between 0 and 100),
  wind integer not null default 0 check(wind between 0 and 100), candle_count integer not null default 5 check(candle_count between 0 and 100),
  start_at timestamptz, host_lease_until timestamptz not null default clock_timestamp()+interval '6 seconds',
  lease_seq bigint not null default 1, role_epoch bigint not null default 1,
  mic_id uuid, audio_id uuid, audio_lease_until timestamptz, last_audio_lease_until timestamptz,
  audio_ack_kind text, audio_ack_member uuid, audio_ack_round uuid, audio_ack_control bigint, audio_ack_epoch bigint,
  last_contribution_at timestamptz, terminal_snapshot jsonb,
  check(expires_at>created_at)
);
create table public.bp_profiles (
  room_id uuid primary key references public.bp_rooms on delete cascade,
  name text not null check(char_length(name) between 1 and 20), month smallint not null check(month between 1 and 12),
  day smallint not null check(day between 1 and case month when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end),
  gender text not null check(gender in ('common','male','female')),
  honorific text not null default '' check(char_length(honorific)<=20), message text not null default '' check(char_length(message)<=80),
  theme text not null default 'strawberry' check(theme in ('strawberry','mint','chocolate')),
  decoration text not null default 'none' check(decoration in ('crown','ribbon','none')),
  photo_id uuid, profile_revision bigint not null default 1
);
create table public.bp_members (
  room_id uuid not null references public.bp_rooms on delete cascade, user_id uuid not null,
  member_id uuid not null default extensions.gen_random_uuid(), role text not null check(role in ('host','guest','stage')),
  joined_at timestamptz not null default clock_timestamp(), primary key(room_id,user_id), unique(room_id,member_id)
);
create table public.bp_invites(token_hash bytea primary key, room_id uuid not null references public.bp_rooms on delete cascade, expires_at timestamptz not null);
create table public.bp_requests(
  room_id uuid not null references public.bp_rooms on delete cascade, round_id uuid not null, user_id uuid not null,
  operation text not null, request_id uuid not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
  primary key(room_id,round_id,user_id,operation,request_id)
);
create table public.bp_photos(
  id uuid primary key default extensions.gen_random_uuid(), room_id uuid not null references public.bp_rooms on delete cascade,
  object_path text not null unique, state text not null check(state in ('pending','active','deleting')),
  expected_profile_revision bigint not null, operation_id uuid not null, created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '10 minutes', delete_after timestamptz,
  unique(room_id,operation_id)
);
create table public.bp_cleanup_queue(
  object_path text primary key, attempts integer not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(), created_at timestamptz not null default clock_timestamp()
);

do $$ declare t text; begin
  foreach t in array array['bp_rooms','bp_profiles','bp_members','bp_invites','bp_requests','bp_photos','bp_cleanup_queue'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end $$;

create function private.bp_user() returns uuid language plpgsql stable security invoker set search_path='' as $$
declare u uuid:=auth.uid(); begin if u is null then raise exception using errcode='28000',message='AUTH_REQUIRED';end if;return u;end $$;
create function private.bp_snap(r public.bp_rooms) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('roomId',r.id,'roundId',r.round_id,'revision',r.revision,'controlRevision',r.control_revision,
 'phase',r.phase,'paused',r.paused,'charge',r.charge,'wind',r.wind,'candleCount',r.candle_count,'startAt',r.start_at,
 'expiresAt',r.expires_at,'hostLeaseUntil',r.host_lease_until,'leaseSeq',r.lease_seq,'roleEpoch',r.role_epoch,
 'hostId',r.host_id,'micId',r.mic_id,'audioId',r.audio_id,'audioLeaseUntil',r.audio_lease_until,'serverNow',clock_timestamp(),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',m.member_id,'role',m.role) order by m.joined_at),'[]'::jsonb) from public.bp_members m where m.room_id=r.id)) $$;
create function private.bp_prof(i uuid) returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object('name',name,'month',month,'day',day,'gender',gender,'honorific',honorific,'message',message,
 'theme',theme,'decoration',decoration,'photoId',photo_id,'profileRevision',profile_revision) from public.bp_profiles where room_id=i $$;
create function private.bp_live(r public.bp_rooms) returns void language plpgsql stable set search_path='' as $$
begin if r.ended_at is not null or r.phase='ended' then raise exception using errcode='P0001',message='ROOM_ENDED';end if;
 if r.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='ROOM_EXPIRED';end if;end $$;
create function private.bp_can_read_topic() returns boolean language plpgsql stable security definer set search_path='' as $$
declare t text:=realtime.topic();rid uuid;
begin if t !~ '^room:[0-9a-fA-F-]{36}$' then return false;end if;rid:=substring(t from 6)::uuid;
 return exists(select 1 from public.bp_rooms r join public.bp_members m on m.room_id=r.id where r.id=rid and m.user_id=auth.uid() and r.ended_at is null and r.phase<>'ended' and r.expires_at>clock_timestamp());
exception when others then return false;end $$;
create function private.bp_emit(r public.bp_rooms) returns void language plpgsql security definer set search_path='' as $$
begin perform realtime.send(jsonb_build_object('roomId',r.id,'roundId',r.round_id,'revision',r.revision,
 'controlRevision',r.control_revision,'phase',r.phase,'paused',r.paused,'charge',r.charge,'wind',r.wind,
 'candleCount',r.candle_count,'startAt',r.start_at,'leaseSeq',r.lease_seq,'hostLeaseUntil',r.host_lease_until,
 'roleEpoch',r.role_epoch,'micId',r.mic_id,'audioId',r.audio_id,'audioLeaseUntil',r.audio_lease_until,'serverNow',clock_timestamp()),
 'state','room:'||r.id::text,true);end $$;

revoke all on function private.bp_user(),private.bp_snap(public.bp_rooms),private.bp_prof(uuid),private.bp_live(public.bp_rooms),private.bp_emit(public.bp_rooms) from public,anon,authenticated;
revoke all on function private.bp_can_read_topic() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.bp_can_read_topic() to authenticated;
drop policy if exists bp_room_broadcast_member_read on realtime.messages;
create policy bp_room_broadcast_member_read on realtime.messages for select to authenticated using(extension='broadcast' and (select private.bp_can_read_topic()));

create function public.bp_create_room(p_profile jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;m public.bp_members;token text:=encode(extensions.gen_random_bytes(32),'hex');p jsonb:=p_profile;
begin
 if (select count(*) from public.bp_rooms where host_id=u and ended_at is null and expires_at>clock_timestamp())>=3 then raise exception using errcode='P0001',message='RATE_LIMITED';end if;
 if jsonb_typeof(p)<>'object' or char_length(btrim(p->>'name')) not between 1 and 20 or coalesce((p->>'month')::int,0) not between 1 and 12 or coalesce((p->>'day')::int,0) not between 1 and 31 then raise exception using errcode='22023',message='INVALID_PROFILE';end if;
 insert into public.bp_rooms(host_id) values(u) returning * into r;
 insert into public.bp_members(room_id,user_id,role) values(r.id,u,'host') returning * into m;
 insert into public.bp_profiles(room_id,name,month,day,gender,honorific,message,theme,decoration)
 values(r.id,btrim(p->>'name'),(p->>'month')::int,(p->>'day')::int,coalesce(p->>'gender','common'),coalesce(btrim(p->>'honorific'),''),coalesce(btrim(p->>'message'),''),coalesce(p->>'theme','strawberry'),coalesce(p->>'decoration','none'));
 insert into public.bp_invites values(extensions.digest(token,'sha256'),r.id,r.expires_at);
 return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id),'memberId',m.member_id,'isHost',true,'inviteToken',token);
end $$;
create function public.bp_join_room(p_token text,p_role text default 'guest') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;i public.bp_invites;m public.bp_members;
begin if p_role not in ('guest','stage') then raise exception using errcode='22023',message='INVALID_ROLE';end if;
 select * into i from public.bp_invites where token_hash=extensions.digest(coalesce(p_token,''),'sha256');
 if not found or i.expires_at<=clock_timestamp() then raise exception using errcode='P0001',message='INVITE_INVALID';end if;
 select * into r from public.bp_rooms where id=i.room_id for update;perform private.bp_live(r);
 if not exists(select 1 from public.bp_members where room_id=r.id and user_id=u) and (select count(*) from public.bp_members where room_id=r.id)>=20 then raise exception using errcode='P0001',message='ROOM_FULL';end if;
 insert into public.bp_members(room_id,user_id,role) values(r.id,u,p_role) on conflict(room_id,user_id) do update set role=excluded.role returning * into m;
 return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id),'memberId',m.member_id,'isHost',r.host_id=u);
end $$;
create function public.bp_snapshot(p_room_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;m public.bp_members;
begin select * into r from public.bp_rooms where id=p_room_id;if not found then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 perform private.bp_live(r);select * into m from public.bp_members where room_id=r.id and user_id=u;
 if not found then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id),'memberId',m.member_id,'isHost',r.host_id=u);
end $$;

create function public.bp_command(p_room_id uuid,p_action text,p_request_id uuid,p_round_id uuid,p_control_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;cached jsonb;result jsonb;op text:='command:'||p_action;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);
 if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select q.result into cached from public.bp_requests q where q.room_id=r.id and q.round_id=p_round_id and q.user_id=u and q.operation=op and q.request_id=p_request_id;
 if found then return cached;end if;
 if r.round_id<>p_round_id then raise exception using errcode='P0001',message='STALE_ROUND';end if;
 if r.control_revision<>p_control_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.host_lease_until<clock_timestamp() and p_action<>'recover' then raise exception using errcode='P0001',message='HOST_LEASE_EXPIRED';end if;
 if r.paused and p_action not in ('resume','recover','end') then raise exception using errcode='P0001',message='HOST_PAUSED';end if;
 if p_action='recover' and r.host_lease_until<clock_timestamp() then r.paused:=false;r.host_lease_until:=clock_timestamp()+interval '6 seconds';r.lease_seq:=r.lease_seq+1;
 elsif p_action='start' and r.phase='waiting' then r.phase:='preparing';
 elsif p_action='light' and r.phase='preparing' then r.phase:='lit';r.candle_count:=5;
 elsif p_action='blow' and r.phase='lit' and ((r.audio_id is not null and r.audio_ack_kind='stopped' and r.audio_ack_epoch=r.role_epoch and r.audio_ack_member=r.audio_id and r.audio_ack_round=r.round_id and r.audio_ack_control=r.control_revision) or (r.audio_id is null and (r.last_audio_lease_until is null or clock_timestamp()>r.last_audio_lease_until+interval '2 seconds'))) then r.phase:='blowing';r.wind:=0;
 elsif p_action='pause' and r.phase<>'ended' then r.paused:=true;
 elsif p_action='resume' and r.phase<>'ended' and r.host_lease_until>=clock_timestamp() then r.paused:=false;
 elsif p_action='force_extinguish' and r.phase in ('preparing','lit','blowing') then r.phase:='celebrating';r.candle_count:=0;r.start_at:=clock_timestamp()+interval '1 second';
 elsif p_action='force_preparing' and r.phase in ('lit','blowing','celebrating') then r.phase:='preparing';r.candle_count:=5;r.wind:=0;r.start_at:=null;
 elsif p_action='celebrate_again' and r.phase='celebrating' then r.round_id:=extensions.gen_random_uuid();r.phase:='preparing';r.charge:=0;r.wind:=0;r.candle_count:=5;r.start_at:=null;r.paused:=false;r.audio_ack_kind:=null;
 else raise exception using errcode='P0001',message='INVALID_TRANSITION';end if;
 r.revision:=r.revision+1;r.control_revision:=r.control_revision+1;
 update public.bp_rooms set host_lease_until=r.host_lease_until,lease_seq=r.lease_seq,phase=r.phase,paused=r.paused,charge=r.charge,wind=r.wind,
 candle_count=r.candle_count,round_id=r.round_id,start_at=r.start_at,revision=r.revision,control_revision=r.control_revision,
 audio_ack_kind=case when p_action='blow' then r.audio_ack_kind else null end,
 audio_ack_control=case when p_action='blow' then r.control_revision else null end,
 audio_ack_epoch=case when p_action='blow' then r.audio_ack_epoch else null end,
 audio_ack_member=case when p_action='blow' then r.audio_ack_member else null end,
 audio_ack_round=case when p_action='blow' then r.audio_ack_round else null end
 where id=r.id returning * into r;
 perform private.bp_emit(r);result:=private.bp_snap(r);
 insert into public.bp_requests(room_id,round_id,user_id,operation,request_id,result) values(r.id,p_round_id,u,op,p_request_id,result);
 return result;
end $$;

create function public.bp_contribute(p_room_id uuid,p_kind text,p_request_id uuid,p_round_id uuid,p_control_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;m public.bp_members;cached jsonb;result jsonb;op text:='contribute:'||p_kind;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);
 select * into m from public.bp_members where room_id=r.id and user_id=u;if not found then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 if m.role='stage' then raise exception using errcode='P0001',message='ROLE_CANNOT_CONTRIBUTE';end if;
 select q.result into cached from public.bp_requests q where q.room_id=r.id and q.round_id=p_round_id and q.user_id=u and q.operation=op and q.request_id=p_request_id;if found then return cached;end if;
 if p_round_id<>r.round_id then raise exception using errcode='P0001',message='STALE_ROUND';end if;if p_control_revision<>r.control_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.paused then raise exception using errcode='P0001',message='HOST_PAUSED';end if;if r.host_lease_until<clock_timestamp() then raise exception using errcode='P0001',message='HOST_LEASE_EXPIRED';end if;
 if r.last_contribution_at>clock_timestamp()-interval '250 milliseconds' then raise exception using errcode='P0001',message='RATE_LIMITED';end if;
 if p_kind in ('shake','button') and r.phase='preparing' then r.charge:=least(100,r.charge+12);
 elsif p_kind='blow' and r.phase='blowing' then
  if r.mic_id is null or m.member_id<>r.mic_id then raise exception using errcode='P0001',message='NOT_MIC';end if;
  if (r.audio_id is not null and (r.audio_ack_kind is distinct from 'stopped' or r.audio_ack_epoch is distinct from r.role_epoch or r.audio_ack_member is distinct from r.audio_id or r.audio_ack_round is distinct from r.round_id or r.audio_ack_control is distinct from r.control_revision))
   or (r.audio_id is null and r.last_audio_lease_until is not null and clock_timestamp()<=r.last_audio_lease_until+interval '2 seconds') then raise exception using errcode='P0001',message='AUDIO_STOP_UNCONFIRMED';end if;
  r.wind:=least(100,r.wind+20);
 elsif p_kind='button' and r.phase='blowing' then r.wind:=least(100,r.wind+10);
 else raise exception using errcode='P0001',message='INVALID_CONTRIBUTION';end if;
 if r.wind>=100 then r.phase:='celebrating';r.candle_count:=0;r.start_at:=clock_timestamp()+interval '1 second';end if;
 r.revision:=r.revision+1;r.last_contribution_at:=clock_timestamp();
 update public.bp_rooms set charge=r.charge,wind=r.wind,phase=r.phase,candle_count=r.candle_count,start_at=r.start_at,revision=r.revision,last_contribution_at=r.last_contribution_at where id=r.id returning * into r;
 result:=private.bp_snap(r);insert into public.bp_requests(room_id,round_id,user_id,operation,request_id,result) values(r.id,p_round_id,u,op,p_request_id,result);perform private.bp_emit(r);return result;
end $$;

create function public.bp_update_profile(p_room_id uuid,p_profile jsonb,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;if p.profile_revision<>p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.phase not in ('waiting','preparing','lit','blowing','celebrating') or (r.phase in ('lit','blowing') and not r.paused) then raise exception using errcode='P0001',message='HOST_PAUSED';end if;
 update public.bp_profiles set name=btrim(p_profile->>'name'),month=(p_profile->>'month')::int,day=(p_profile->>'day')::int,gender=p_profile->>'gender',
 honorific=btrim(coalesce(p_profile->>'honorific','')),message=btrim(coalesce(p_profile->>'message','')),theme=p_profile->>'theme',decoration=p_profile->>'decoration',profile_revision=profile_revision+1
 where room_id=r.id returning * into p;
 update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);
 return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id));
end $$;
create function public.bp_heartbeat(p_room_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 if r.host_lease_until<clock_timestamp() then update public.bp_rooms set paused=true,control_revision=control_revision+case when paused then 0 else 1 end,revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);return jsonb_build_object('error','HOST_LEASE_EXPIRED','snapshot',private.bp_snap(r));end if;
 update public.bp_rooms set host_lease_until=clock_timestamp()+interval '6 seconds',lease_seq=lease_seq+1,revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);return private.bp_snap(r);
end $$;
create function public.bp_set_roles(p_room_id uuid,p_mic_id uuid,p_audio_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 if (p_mic_id is not null and not exists(select 1 from public.bp_members where room_id=r.id and member_id=p_mic_id)) or (p_audio_id is not null and not exists(select 1 from public.bp_members where room_id=r.id and member_id=p_audio_id)) then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 update public.bp_rooms set mic_id=p_mic_id,audio_id=p_audio_id,role_epoch=role_epoch+1,control_revision=control_revision+1,
 last_audio_lease_until=case when audio_id is distinct from p_audio_id then coalesce(audio_lease_until,last_audio_lease_until) else last_audio_lease_until end,
 audio_lease_until=case when p_audio_id is not null then clock_timestamp()+interval '30 seconds' else null end,
 audio_ack_kind=null,audio_ack_member=null,audio_ack_round=null,audio_ack_control=null,audio_ack_epoch=null,revision=revision+1
 where id=r.id returning * into r;perform private.bp_emit(r);return private.bp_snap(r);
end $$;
create function public.bp_role_ack(p_room_id uuid,p_member_id uuid,p_role text,p_kind text,p_round_id uuid,p_control_revision bigint,p_role_epoch bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);
 if not exists(select 1 from public.bp_members where room_id=r.id and user_id=u and member_id=p_member_id) then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 if p_round_id<>r.round_id or p_control_revision<>r.control_revision or p_role_epoch<>r.role_epoch then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if p_role='audio' and r.audio_id=p_member_id and p_kind='ready' then update public.bp_rooms set audio_lease_until=clock_timestamp()+interval '30 seconds',last_audio_lease_until=clock_timestamp()+interval '30 seconds',revision=revision+1 where id=r.id returning * into r;
 elsif p_role='audio' and r.audio_id=p_member_id and p_kind='stopped' then update public.bp_rooms set audio_lease_until=clock_timestamp(),last_audio_lease_until=clock_timestamp(),audio_ack_epoch=r.role_epoch,audio_ack_kind='stopped',audio_ack_member=p_member_id,audio_ack_round=r.round_id,audio_ack_control=r.control_revision,revision=revision+1 where id=r.id returning * into r;
 elsif p_role='mic' and r.mic_id=p_member_id and p_kind in ('ready','stopped') then update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;
 else raise exception using errcode='P0001',message='ROLE_NOT_ASSIGNED';end if;perform private.bp_emit(r);return private.bp_snap(r);
end $$;
create function public.bp_request_audio_stop(p_room_id uuid,p_round_id uuid,p_control_revision bigint,p_role_epoch bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 if r.round_id<>p_round_id or r.control_revision<>p_control_revision or r.role_epoch<>p_role_epoch then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.audio_id is null then return private.bp_snap(r);end if;
 perform realtime.send(jsonb_build_object('roomId',r.id,'roundId',r.round_id,'controlRevision',r.control_revision,'roleEpoch',r.role_epoch,'targetMemberId',r.audio_id,'request','stop'), 'audio_stop_request','room:'||r.id::text,true);
 return private.bp_snap(r);
end $$;

create function public.bp_photo_begin(p_room_id uuid,p_operation_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;f public.bp_photos;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;if p.profile_revision<>p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 insert into public.bp_photos(room_id,object_path,state,expected_profile_revision,operation_id) values(r.id,r.id::text||'/'||extensions.gen_random_uuid()::text||'.webp','pending',p_expected_revision,p_operation_id) returning * into f;
 return jsonb_build_object('photoId',f.id,'objectPath',f.object_path,'expiresAt',f.expires_at);
end $$;
create function public.bp_photo_commit(p_room_id uuid,p_photo_id uuid,p_operation_id uuid,p_expected_revision bigint,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.bp_rooms;p public.bp_profiles;f public.bp_photos;old_path text;
begin if auth.role()<>'service_role' or p_actor_id is null then raise exception using errcode='42501',message='FORBIDDEN';end if;
 select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>p_actor_id then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;select * into f from public.bp_photos where id=p_photo_id and room_id=r.id and operation_id=p_operation_id for update;
 if not found or f.state<>'pending' or f.expires_at<=clock_timestamp() or p.profile_revision<>p_expected_revision or f.expected_profile_revision<>p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if p.photo_id is not null then select object_path into old_path from public.bp_photos where id=p.photo_id; if old_path is not null then update public.bp_photos set state='deleting',delete_after=clock_timestamp()+interval '5 minutes' where object_path=old_path;insert into public.bp_cleanup_queue(object_path,next_attempt_at) values(old_path,clock_timestamp()+interval '5 minutes') on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);end if;end if;
 update public.bp_photos set state='active',expires_at=clock_timestamp()+interval '2 hours' where id=f.id;update public.bp_profiles set photo_id=f.id,profile_revision=profile_revision+1 where room_id=r.id;
 update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id));
end $$;
create function public.bp_photo_delete(p_room_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;path text;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;if p.profile_revision<>p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 select f.object_path into path from public.bp_photos f where f.id=p.photo_id;update public.bp_profiles set photo_id=null,profile_revision=profile_revision+1 where room_id=r.id;
 if path is not null then update public.bp_photos set state='deleting',delete_after=clock_timestamp()+interval '5 minutes' where object_path=path;insert into public.bp_cleanup_queue(object_path,next_attempt_at) values(path,clock_timestamp()+interval '5 minutes') on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);end if;
 update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id));
end $$;
create function public.bp_photo_read(p_room_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;f public.bp_photos;
begin select * into r from public.bp_rooms where id=p_room_id;perform private.bp_live(r);if not exists(select 1 from public.bp_members where room_id=r.id and user_id=u) then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 select * into p from public.bp_profiles where room_id=r.id;if p.photo_id is null then raise exception using errcode='P0001',message='PHOTO_NOT_FOUND';end if;
 select * into f from public.bp_photos where id=p.photo_id and room_id=r.id and state='active';if not found then raise exception using errcode='P0001',message='PHOTO_NOT_FOUND';end if;
 return jsonb_build_object('objectPath',f.object_path,'profile',private.bp_prof(r.id));end $$;
create function public.bp_end_room(p_room_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;m public.bp_members;
begin select * into r from public.bp_rooms where id=p_room_id for update;if not found then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;if r.terminal_snapshot is not null then return r.terminal_snapshot;end if;perform private.bp_live(r);
 update public.bp_rooms set phase='ended',ended_at=clock_timestamp(),paused=true,revision=revision+1,control_revision=control_revision+1 where id=r.id returning * into r;
 delete from public.bp_profiles where room_id=r.id;delete from public.bp_invites where room_id=r.id;
 update public.bp_photos set state='deleting',delete_after=greatest(expires_at,clock_timestamp())+interval '5 minutes' where room_id=r.id;
 insert into public.bp_cleanup_queue(object_path,next_attempt_at) select object_path,delete_after from public.bp_photos where room_id=r.id on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);
 perform private.bp_emit(r);r.terminal_snapshot:=private.bp_snap(r);update public.bp_rooms set terminal_snapshot=r.terminal_snapshot where id=r.id;return r.terminal_snapshot;
end $$;

create function public.bp_cleanup_claim(p_limit integer default 50) returns setof text language plpgsql security definer set search_path='' as $$
begin if auth.role()<>'service_role' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 return query with q as(select object_path from public.bp_cleanup_queue where next_attempt_at<=clock_timestamp() order by next_attempt_at for update skip locked limit least(greatest(p_limit,1),100)) update public.bp_cleanup_queue c set attempts=c.attempts+1,next_attempt_at=clock_timestamp()+interval '1 minute' from q where c.object_path=q.object_path returning c.object_path;
end $$;
create function public.bp_cleanup_ack(p_object_path text) returns void language plpgsql security definer set search_path='' as $$
declare f public.bp_photos;photo_found boolean;
begin if auth.role()<>'service_role' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 select * into f from public.bp_photos where object_path=p_object_path for update;photo_found:=found;
 if photo_found and f.state='deleting' and f.delete_after>clock_timestamp() then update public.bp_cleanup_queue set next_attempt_at=f.delete_after where object_path=p_object_path;return;end if;
 -- Keep the opaque path as a tombstone and retry deletion periodically. A slow in-flight
 -- object write can complete after the first successful delete.
 update public.bp_cleanup_queue set attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '1 day' where object_path=p_object_path;
 if photo_found and f.state='deleting' then delete from public.bp_photos where id=f.id;end if;
end $$;
create function public.bp_cleanup_enqueue(p_object_path text) returns void language plpgsql security definer set search_path='' as $$
begin if auth.role()<>'service_role' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 update public.bp_photos set state='deleting',delete_after=greatest(expires_at,clock_timestamp())+interval '5 minutes' where object_path=p_object_path;
 insert into public.bp_cleanup_queue(object_path,next_attempt_at) values(p_object_path,clock_timestamp()+interval '5 minutes') on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);
end $$;
create function public.bp_prune_expired() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin if auth.role()<>'service_role' then raise exception using errcode='42501',message='FORBIDDEN';end if;
 update public.bp_rooms set phase='ended',ended_at=coalesce(ended_at,clock_timestamp()),paused=true where expires_at<=clock_timestamp() and ended_at is null;
 delete from public.bp_profiles p using public.bp_rooms r where p.room_id=r.id and (r.ended_at is not null or r.expires_at<=clock_timestamp());
 delete from public.bp_invites i using public.bp_rooms r where i.room_id=r.id and (r.ended_at is not null or r.expires_at<=clock_timestamp());
 update public.bp_photos f set state='deleting',delete_after=greatest(f.expires_at,clock_timestamp())+interval '5 minutes' from public.bp_rooms r where r.id=f.room_id and (r.ended_at is not null or r.expires_at<=clock_timestamp()) and f.state<>'deleting';
 insert into public.bp_cleanup_queue(object_path,next_attempt_at) select f.object_path,f.delete_after from public.bp_photos f where f.state='deleting' on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);
 delete from public.bp_rooms r where (r.ended_at is not null or r.expires_at<=clock_timestamp()) and not exists(select 1 from public.bp_photos f where f.room_id=r.id);
 get diagnostics n=row_count;return n;
end $$;

do $$ declare f text;begin foreach f in array array[
 'bp_create_room(jsonb)','bp_join_room(text,text)','bp_snapshot(uuid)','bp_command(uuid,text,uuid,uuid,bigint)',
 'bp_contribute(uuid,text,uuid,uuid,bigint)','bp_update_profile(uuid,jsonb,bigint)','bp_heartbeat(uuid)',
 'bp_set_roles(uuid,uuid,uuid)','bp_role_ack(uuid,uuid,text,text,uuid,bigint,bigint)','bp_request_audio_stop(uuid,uuid,bigint,bigint)',
 'bp_photo_begin(uuid,uuid,bigint)','bp_photo_delete(uuid,bigint)','bp_photo_read(uuid)','bp_end_room(uuid)'
] loop execute format('revoke all on function public.%s from public,anon,authenticated',f);execute format('grant execute on function public.%s to authenticated',f);end loop;end $$;
revoke all on function public.bp_photo_commit(uuid,uuid,uuid,bigint,uuid),public.bp_cleanup_claim(integer),public.bp_cleanup_ack(text),public.bp_cleanup_enqueue(text),public.bp_prune_expired() from public,anon,authenticated;
grant execute on function public.bp_photo_commit(uuid,uuid,uuid,bigint,uuid),public.bp_cleanup_claim(integer),public.bp_cleanup_ack(text),public.bp_cleanup_enqueue(text),public.bp_prune_expired() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('bp-private','bp-private',false,1048576,array['image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists bp_storage_no_client_access on storage.objects;
create policy bp_storage_no_client_access on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'bp-private') with check(bucket_id<>'bp-private');
