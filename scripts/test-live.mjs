import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').trim().split(/\r?\n/).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const host=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,options);
const guest=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,options);
const outcomes=[];let room, timer;
const rpc=async(client,name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw Object.assign(new Error(name+' failed'),{safeCode:error.code,safeMessage:/^[A-Z_]+$/.test(error.message)?error.message:'DATABASE_ERROR',stage:name});return data;};
try{
 for(const c of [host,guest]){const {error}=await c.auth.signInAnonymously();if(error)throw Object.assign(new Error('Anonymous sign-in failed'),{safeCode:error.code});}
 outcomes.push('anonymous-auth');
 const profile={name:'[NAME_SAMPLE]',month:2,day:29,gender:'common',honorific:'오늘의 주인공',message:'축하합니다',theme:'strawberry',decoration:'crown',photoId:null,profileRevision:0};
 const created=await rpc(host,'bp_create_room',{p_profile:profile});room=created.snapshot.roomId;let s=created.snapshot;
 timer=setInterval(async()=>{await host.rpc('bp_heartbeat',{p_room_id:room});},1500);
 const joined=await rpc(guest,'bp_join_room',{p_token:created.inviteToken});assert.equal(joined.snapshot.roomId,room);outcomes.push('create-join');
 const outsider=await guest.rpc('bp_snapshot',{p_room_id:crypto.randomUUID()});assert.ok(outsider.error);outcomes.push('unknown-room-denied');
 const write=await guest.from('bp_profiles').update({name:'[UNAUTHORIZED]'}).eq('room_id',room);assert.ok(write.error);outcomes.push('direct-write-denied');
 const change=await rpc(host,'bp_update_profile',{p_room_id:room,p_profile:{...profile,name:'[NAME_UPDATED]'},p_expected_revision:created.profile.profileRevision});
 assert.equal((await rpc(guest,'bp_snapshot',{p_room_id:room})).profile.name,'[NAME_UPDATED]');outcomes.push('profile-shared');s=change.snapshot;
 const command=async(action)=>{s=await rpc(host,'bp_command',{p_room_id:room,p_action:action,p_request_id:crypto.randomUUID(),p_round_id:s.roundId,p_control_revision:s.controlRevision});};
 await command('start');const shake=await rpc(guest,'bp_contribute',{p_room_id:room,p_kind:'button',p_request_id:crypto.randomUUID(),p_round_id:s.roundId,p_control_revision:s.controlRevision});assert.ok(shake.charge>0);outcomes.push('guest-shake-button');
 await command('light');await command('blow');
 for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,300));s=await rpc(guest,'bp_contribute',{p_room_id:room,p_kind:'button',p_request_id:crypto.randomUUID(),p_round_id:s.roundId,p_control_revision:s.controlRevision});if(s.phase==='celebrating')break;}
 assert.equal(s.phase,'celebrating');outcomes.push('shared-extinguish');
 await command('celebrate_again');assert.equal(s.candleCount,5);outcomes.push('replay');
 await command('pause');await command('resume');outcomes.push('pause-resume');
 await rpc(host,'bp_end_room',{p_room_id:room});room=null;
 const ended=await guest.rpc('bp_snapshot',{p_room_id:created.snapshot.roomId});assert.ok(ended.error);outcomes.push('ended-access-denied');
 console.log(JSON.stringify({status:'PASS',checks:outcomes,limitations:['Not physical devices','No microphone hardware test','Photo endpoint tested separately']}));
}catch(error){console.log(JSON.stringify({status:'FAIL',checks:outcomes,stage:error.stage??'assertion-or-auth',code:error.safeCode??error.code??'FAILED',reason:error.safeMessage}));process.exitCode=1;}
finally{clearInterval(timer);if(room)await host.rpc('bp_end_room',{p_room_id:room});await Promise.all([host.auth.signOut(),guest.auth.signOut()]);}
