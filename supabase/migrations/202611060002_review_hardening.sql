alter table public.bp_rooms add column retired_audio_until timestamptz;
create or replace function public.bp_command(p_room_id uuid,p_action text,p_request_id uuid,p_round_id uuid,p_control_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;cached jsonb;result jsonb;op text:='command:'||p_action;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);
 if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select q.result into cached from public.bp_requests q where q.room_id=r.id and q.round_id=p_round_id and q.user_id=u and q.operation=op and q.request_id=p_request_id;
 if found then return cached;end if;
 if r.round_id is distinct from p_round_id then raise exception using errcode='P0001',message='STALE_ROUND';end if;
 if r.control_revision is distinct from p_control_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.host_lease_until<clock_timestamp() and p_action<>'recover' then raise exception using errcode='P0001',message='HOST_LEASE_EXPIRED';end if;
 if r.paused and p_action not in ('resume','recover','end') then raise exception using errcode='P0001',message='HOST_PAUSED';end if;
 if p_action='recover' and r.host_lease_until<clock_timestamp() then r.paused:=false;r.host_lease_until:=clock_timestamp()+interval '6 seconds';r.lease_seq:=r.lease_seq+1;
 elsif p_action='start' and r.phase='waiting' then r.phase:='preparing';
 elsif p_action='light' and r.phase='preparing' then r.phase:='lit';r.candle_count:=5;
 elsif p_action='blow' and r.phase='lit' and (r.retired_audio_until is null or clock_timestamp()>r.retired_audio_until+interval '2 seconds') and ((r.audio_id is not null and r.audio_ack_kind='stopped' and r.audio_ack_epoch=r.role_epoch and r.audio_ack_member=r.audio_id and r.audio_ack_round=r.round_id and r.audio_ack_control=r.control_revision) or (r.audio_id is null and (r.last_audio_lease_until is null or clock_timestamp()>r.last_audio_lease_until+interval '2 seconds'))) then r.phase:='blowing';r.wind:=0;
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

create or replace function public.bp_contribute(p_room_id uuid,p_kind text,p_request_id uuid,p_round_id uuid,p_control_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;m public.bp_members;cached jsonb;result jsonb;op text:='contribute:'||p_kind;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);
 select * into m from public.bp_members where room_id=r.id and user_id=u;if not found then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 if m.role='stage' then raise exception using errcode='P0001',message='ROLE_CANNOT_CONTRIBUTE';end if;
 select q.result into cached from public.bp_requests q where q.room_id=r.id and q.round_id=p_round_id and q.user_id=u and q.operation=op and q.request_id=p_request_id;if found then return cached;end if;
 if p_round_id is distinct from r.round_id then raise exception using errcode='P0001',message='STALE_ROUND';end if;if p_control_revision is distinct from r.control_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.paused then raise exception using errcode='P0001',message='HOST_PAUSED';end if;if r.host_lease_until<clock_timestamp() then raise exception using errcode='P0001',message='HOST_LEASE_EXPIRED';end if;
 if r.last_contribution_at>clock_timestamp()-interval '250 milliseconds' then raise exception using errcode='P0001',message='RATE_LIMITED';end if;
 if p_kind in ('shake','button') and r.phase='preparing' then r.charge:=least(100,r.charge+12);
 elsif p_kind='blow' and r.phase='blowing' then
  if r.retired_audio_until is not null and clock_timestamp()<=r.retired_audio_until+interval '2 seconds' then raise exception 'AUDIO_STOP_UNCONFIRMED';end if;
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

create or replace function public.bp_update_profile(p_room_id uuid,p_profile jsonb,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;if p.profile_revision is distinct from p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.phase not in ('waiting','preparing','lit','blowing','celebrating') or (r.phase in ('lit','blowing') and not r.paused) then raise exception using errcode='P0001',message='HOST_PAUSED';end if;
 update public.bp_profiles set name=btrim(p_profile->>'name'),month=(p_profile->>'month')::int,day=(p_profile->>'day')::int,gender=p_profile->>'gender',
 honorific=btrim(coalesce(p_profile->>'honorific','')),message=btrim(coalesce(p_profile->>'message','')),theme=p_profile->>'theme',decoration=p_profile->>'decoration',profile_revision=profile_revision+1
 where room_id=r.id returning * into p;
 update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);
 return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id));
end $$;

create or replace function public.bp_set_roles(p_room_id uuid,p_mic_id uuid,p_audio_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 if (p_mic_id is not null and not exists(select 1 from public.bp_members where room_id=r.id and member_id=p_mic_id)) or (p_audio_id is not null and not exists(select 1 from public.bp_members where room_id=r.id and member_id=p_audio_id)) then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 update public.bp_rooms set retired_audio_until=case when audio_id is distinct from p_audio_id then greatest(retired_audio_until,audio_lease_until) else retired_audio_until end,mic_id=p_mic_id,audio_id=p_audio_id,role_epoch=role_epoch+1,control_revision=control_revision+1,
 last_audio_lease_until=case when audio_id is distinct from p_audio_id then coalesce(audio_lease_until,last_audio_lease_until) else last_audio_lease_until end,
 audio_lease_until=case when p_audio_id is not null then clock_timestamp()+interval '30 seconds' else null end,
 audio_ack_kind=null,audio_ack_member=null,audio_ack_round=null,audio_ack_control=null,audio_ack_epoch=null,revision=revision+1
 where id=r.id returning * into r;perform private.bp_emit(r);return private.bp_snap(r);
end $$;

create or replace function public.bp_role_ack(p_room_id uuid,p_member_id uuid,p_role text,p_kind text,p_round_id uuid,p_control_revision bigint,p_role_epoch bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);
 if not exists(select 1 from public.bp_members where room_id=r.id and user_id=u and member_id=p_member_id) then raise exception using errcode='P0001',message='NOT_MEMBER';end if;
 if p_round_id is distinct from r.round_id or p_control_revision is distinct from r.control_revision or p_role_epoch is distinct from r.role_epoch then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if p_role='audio' and r.audio_id=p_member_id and p_kind='ready' then update public.bp_rooms set audio_lease_until=clock_timestamp()+interval '30 seconds',last_audio_lease_until=clock_timestamp()+interval '30 seconds',revision=revision+1 where id=r.id returning * into r;
 elsif p_role='audio' and r.audio_id=p_member_id and p_kind='stopped' then update public.bp_rooms set audio_lease_until=clock_timestamp(),last_audio_lease_until=clock_timestamp(),audio_ack_epoch=r.role_epoch,audio_ack_kind='stopped',audio_ack_member=p_member_id,audio_ack_round=r.round_id,audio_ack_control=r.control_revision,revision=revision+1 where id=r.id returning * into r;
 elsif p_role='mic' and r.mic_id=p_member_id and p_kind in ('ready','stopped') then update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;
 else raise exception using errcode='P0001',message='ROLE_NOT_ASSIGNED';end if;perform private.bp_emit(r);return private.bp_snap(r);
end $$;

create or replace function public.bp_request_audio_stop(p_room_id uuid,p_round_id uuid,p_control_revision bigint,p_role_epoch bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 if r.round_id is distinct from p_round_id or r.control_revision is distinct from p_control_revision or r.role_epoch is distinct from p_role_epoch then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if r.audio_id is null then return private.bp_snap(r);end if;
 perform realtime.send(jsonb_build_object('roomId',r.id,'roundId',r.round_id,'controlRevision',r.control_revision,'roleEpoch',r.role_epoch,'targetMemberId',r.audio_id,'request','stop'), 'audio_stop_request','room:'||r.id::text,true);
 return private.bp_snap(r);
end $$;

create or replace function public.bp_photo_begin(p_room_id uuid,p_operation_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;f public.bp_photos;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;if p.profile_revision is distinct from p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 insert into public.bp_photos(room_id,object_path,state,expected_profile_revision,operation_id) values(r.id,r.id::text||'/'||extensions.gen_random_uuid()::text||'.webp','pending',p_expected_revision,p_operation_id) returning * into f;
 return jsonb_build_object('photoId',f.id,'objectPath',f.object_path,'expiresAt',f.expires_at);
end $$;

create or replace function public.bp_photo_delete(p_room_id uuid,p_expected_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.bp_user();r public.bp_rooms;p public.bp_profiles;path text;
begin select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id<>u then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;if p.profile_revision is distinct from p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 select f.object_path into path from public.bp_photos f where f.id=p.photo_id;update public.bp_profiles set photo_id=null,profile_revision=profile_revision+1 where room_id=r.id;
 if path is not null then update public.bp_photos set state='deleting',delete_after=clock_timestamp()+interval '5 minutes' where object_path=path;insert into public.bp_cleanup_queue(object_path,next_attempt_at) values(path,clock_timestamp()+interval '5 minutes') on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);end if;
 update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id));
end $$;

create or replace function public.bp_photo_commit(p_room_id uuid,p_photo_id uuid,p_operation_id uuid,p_expected_revision bigint,p_actor_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.bp_rooms;p public.bp_profiles;f public.bp_photos;old_path text;
begin if auth.role()<>'service_role' or p_actor_id is null then raise exception using errcode='42501',message='FORBIDDEN';end if;
 select * into r from public.bp_rooms where id=p_room_id for update;perform private.bp_live(r);if r.host_id is distinct from p_actor_id then raise exception using errcode='P0001',message='NOT_HOST';end if;
 select * into p from public.bp_profiles where room_id=r.id for update;select * into f from public.bp_photos where id=p_photo_id and room_id=r.id and operation_id=p_operation_id for update;
 if not found or f.state<>'pending' or f.expires_at<=clock_timestamp() or p.profile_revision is distinct from p_expected_revision or f.expected_profile_revision is distinct from p_expected_revision then raise exception using errcode='P0001',message='STALE_REVISION';end if;
 if p.photo_id is not null then select object_path into old_path from public.bp_photos where id=p.photo_id; if old_path is not null then update public.bp_photos set state='deleting',delete_after=clock_timestamp()+interval '5 minutes' where object_path=old_path;insert into public.bp_cleanup_queue(object_path,next_attempt_at) values(old_path,clock_timestamp()+interval '5 minutes') on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);end if;end if;
 update public.bp_photos set state='active',expires_at=clock_timestamp()+interval '2 hours' where id=f.id;update public.bp_profiles set photo_id=f.id,profile_revision=profile_revision+1 where room_id=r.id;
 update public.bp_rooms set revision=revision+1 where id=r.id returning * into r;perform private.bp_emit(r);return jsonb_build_object('snapshot',private.bp_snap(r),'profile',private.bp_prof(r.id));
end $$;

create or replace function public.bp_cleanup_enqueue(p_object_path text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN';end if;
 perform 1 from public.bp_photos where object_path=p_object_path for update;
 if exists(select 1 from public.bp_profiles p join public.bp_photos f on f.id=p.photo_id where f.object_path=p_object_path) then return;end if;
 update public.bp_photos set state='deleting',delete_after=greatest(expires_at,clock_timestamp())+interval '5 minutes' where object_path=p_object_path;
 insert into public.bp_cleanup_queue(object_path,next_attempt_at) values(p_object_path,clock_timestamp()+interval '15 minutes') on conflict(object_path) do update set next_attempt_at=greatest(public.bp_cleanup_queue.next_attempt_at,excluded.next_attempt_at);
end $$;
create or replace function public.bp_cleanup_claim(p_limit integer default 20) returns setof text language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN';end if;
 return query with q as(select c.object_path from public.bp_cleanup_queue c where c.next_attempt_at<=clock_timestamp()
 and not exists(select 1 from public.bp_profiles p join public.bp_photos f on f.id=p.photo_id where f.object_path=c.object_path)
 and not exists(select 1 from public.bp_photos f where f.object_path=c.object_path and (f.state='active' or (f.state='pending' and f.expires_at>clock_timestamp())))
 order by c.next_attempt_at for update skip locked limit least(greatest(p_limit,1),100))
 update public.bp_cleanup_queue c set attempts=c.attempts+1,next_attempt_at=clock_timestamp()+interval '1 minute' from q where c.object_path=q.object_path returning c.object_path;
end $$;
create or replace function public.bp_cleanup_ack(p_object_path text) returns void language plpgsql security definer set search_path='' as $$
declare f public.bp_photos;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN';end if;
 select * into f from public.bp_photos where object_path=p_object_path for update;
 if exists(select 1 from public.bp_profiles where photo_id=f.id) then return;end if;
 if f.delete_after>clock_timestamp() then update public.bp_cleanup_queue set next_attempt_at=f.delete_after where object_path=p_object_path;return;end if;
 delete from public.bp_photos where object_path=p_object_path and state='deleting';
 update public.bp_cleanup_queue set next_attempt_at=clock_timestamp()+interval '1 day' where object_path=p_object_path;
 delete from public.bp_cleanup_queue where object_path=p_object_path and created_at<clock_timestamp()-interval '2 days';
end $$;
create table private.bp_maintenance(last_run timestamptz not null);
insert into private.bp_maintenance values('epoch');
create function public.bp_maintenance_claim() returns boolean language plpgsql security definer set search_path='' as $$
declare previous timestamptz;
begin
 if auth.role()<>'service_role' then raise exception 'FORBIDDEN';end if;
 select last_run into previous from private.bp_maintenance for update;
 if previous>clock_timestamp()-interval '1 minute' then return false;end if;
 update private.bp_maintenance set last_run=clock_timestamp();return true;
end $$;
revoke all on function public.bp_maintenance_claim() from public,anon,authenticated;
grant execute on function public.bp_maintenance_claim() to service_role;
