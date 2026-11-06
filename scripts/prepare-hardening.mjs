import fs from 'node:fs';
const source=fs.readFileSync('supabase/migrations/202611060001_birthday_party_backend.sql','utf8');
const names=['bp_command','bp_contribute','bp_update_profile','bp_set_roles','bp_role_ack','bp_request_audio_stop','bp_photo_begin','bp_photo_delete','bp_photo_commit'];
const functions=names.map(name=>{
 const start=source.indexOf(`create function public.${name}(`);if(start<0)throw new Error(name);
 const end=source.indexOf('end $$;',start)+7;
 let text=source.slice(start,end).replace('create function','create or replace function');
 text=text.replace(/([\w.]+)\s*<>\s*(p_\w+)/g,'$1 is distinct from $2').replace(/(p_\w+)\s*<>\s*([\w.]+)/g,'$1 is distinct from $2');
 if(name==='bp_set_roles')text=text.replace('set mic_id=p_mic_id,','set retired_audio_until=case when audio_id is distinct from p_audio_id then greatest(retired_audio_until,audio_lease_until) else retired_audio_until end,mic_id=p_mic_id,');
 if(name==='bp_command')text=text.replace("p_action='blow' and r.phase='lit' and", "p_action='blow' and r.phase='lit' and (r.retired_audio_until is null or clock_timestamp()>r.retired_audio_until+interval '2 seconds') and");
 if(name==='bp_contribute')text=text.replace("if r.mic_id is null", "if r.retired_audio_until is not null and clock_timestamp()<=r.retired_audio_until+interval '2 seconds' then raise exception 'AUDIO_STOP_UNCONFIRMED';end if;\n  if r.mic_id is null");
 return text;
});
const suffix=`
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
`;
fs.writeFileSync('supabase/migrations/202611060002_review_hardening.sql','alter table public.bp_rooms add column retired_audio_until timestamptz;\n'+functions.join('\n\n')+'\n'+suffix);
console.log('Review migration generated');
