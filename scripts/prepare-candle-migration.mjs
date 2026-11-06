import fs from 'node:fs';
const source=fs.readFileSync('supabase/migrations/202611060001_birthday_party_backend.sql','utf8');
function get(name,from=source){const a=from.indexOf(`create function ${name}(`);const b=from.indexOf('end $$;',a)+7;if(a<0)throw Error(name);return from.slice(a,b).replace('create function','create or replace function');}
let create=get('public.bp_create_room');
create=create.replace('insert into public.bp_invites',`update public.bp_profiles set long_candles=coalesce((p->>'longCandles')::int,0),short_candles=coalesce((p->>'shortCandles')::int,5),photo_placement=coalesce(p->>'photoPlacement','topper') where room_id=r.id;
 insert into public.bp_invites`);
let update=get('public.bp_update_profile');
update=update.replace('profile_revision=profile_revision+1',`long_candles=coalesce((p_profile->>'longCandles')::int,0),short_candles=coalesce((p_profile->>'shortCandles')::int,5),photo_placement=coalesce(p_profile->>'photoPlacement','topper'),profile_revision=profile_revision+1`)
.replace('p.profile_revision<>p_expected_revision','p.profile_revision is distinct from p_expected_revision');
let ack=get('public.bp_role_ack');
ack=ack.replace(/([\w.]+)\s*<>\s*(p_\w+)/g,'$1 is distinct from $2').replace(/(p_\w+)\s*<>\s*([\w.]+)/g,'$1 is distinct from $2');
ack=ack.replace("if p_role='audio' and r.audio_id=p_member_id and p_kind='ready' then",`if p_role='audio' and r.audio_id=p_member_id and p_kind='ready' then
  if r.phase='blowing' then raise exception 'AUDIO_STOP_UNCONFIRMED';end if;`);
ack=ack.replace("set audio_lease_until=clock_timestamp()+interval '30 seconds'", "set audio_ack_kind=null,audio_ack_epoch=null,audio_ack_round=null,audio_ack_control=null,audio_ack_member=null,audio_lease_until=clock_timestamp()+interval '30 seconds'");
const migration=`alter table public.bp_profiles add column long_candles integer not null default 0 check(long_candles between 0 and 12),add column short_candles integer not null default 5 check(short_candles between 0 and 9),add column photo_placement text not null default 'topper' check(photo_placement in ('topper','background','both')),add check(long_candles+short_candles>0);
create or replace function private.bp_prof(i uuid) returns jsonb language sql stable set search_path='' as $$ select jsonb_build_object('name',name,'month',month,'day',day,'gender',gender,'honorific',honorific,'message',message,'theme',theme,'decoration',decoration,'photoId',photo_id,'profileRevision',profile_revision,'longCandles',long_candles,'shortCandles',short_candles,'photoPlacement',photo_placement) from public.bp_profiles where room_id=i $$;
${create}
${update}
${ack}
notify pgrst,'reload schema';
`;
fs.writeFileSync('supabase/migrations/202611060003_candles_and_photos.sql',migration);console.log('Candle selection migration prepared');
