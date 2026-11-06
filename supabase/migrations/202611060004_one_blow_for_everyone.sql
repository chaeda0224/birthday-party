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
  
  if (r.audio_id is not null and (r.audio_ack_kind is distinct from 'stopped' or r.audio_ack_epoch is distinct from r.role_epoch or r.audio_ack_member is distinct from r.audio_id or r.audio_ack_round is distinct from r.round_id or r.audio_ack_control is distinct from r.control_revision))
   or (r.audio_id is null and r.last_audio_lease_until is not null and clock_timestamp()<=r.last_audio_lease_until+interval '2 seconds') then raise exception using errcode='P0001',message='AUDIO_STOP_UNCONFIRMED';end if;
  r.wind:=100;
 elsif p_kind='button' and r.phase='blowing' then r.wind:=least(100,r.wind+10);
 else raise exception using errcode='P0001',message='INVALID_CONTRIBUTION';end if;
 if r.wind>=100 then r.phase:='celebrating';r.candle_count:=0;r.start_at:=clock_timestamp()+interval '1 second';end if;
 r.revision:=r.revision+1;r.last_contribution_at:=clock_timestamp();
 update public.bp_rooms set charge=r.charge,wind=r.wind,phase=r.phase,candle_count=r.candle_count,start_at=r.start_at,revision=r.revision,last_contribution_at=r.last_contribution_at where id=r.id returning * into r;
 result:=private.bp_snap(r);insert into public.bp_requests(room_id,round_id,user_id,operation,request_id,result) values(r.id,p_round_id,u,op,p_request_id,result);perform private.bp_emit(r);return result;
end $$;
notify pgrst,'reload schema';
