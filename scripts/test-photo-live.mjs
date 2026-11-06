import {createClient} from '@supabase/supabase-js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').trim().split(/\r?\n/).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const db=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let room;let heartbeat;const checks=[];
const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw Object.assign(new Error('RPC failed'),{stage:name,code:error.code});return data;};
try{
 const {error:auth}=await db.auth.signInAnonymously();if(auth)throw new Error('AUTH');
 const p={name:'[PHOTO_TEST]',month:1,day:1,gender:'common',honorific:'주인공',message:'축하',theme:'strawberry',decoration:'none'};
 const made=await rpc('bp_create_room',{p_profile:p});room=made.snapshot.roomId;
 heartbeat=setInterval(async()=>{await db.rpc('bp_heartbeat',{p_room_id:room});},1500);
 const blob=new Blob([Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'))],{type:'image/png'});
 const form=new FormData();form.set('action','upload');form.set('roomId',room);form.set('expectedRevision',String(made.profile.profileRevision));form.set('file',blob,'shape.png');
 const upload=await db.functions.invoke('photo',{body:form});if(upload.error){const response=upload.error.context;let payload;try{payload=await response.json();}catch{}throw Object.assign(new Error('PHOTO_UPLOAD'),{stage:'upload',code:payload?.code??payload?.message??response?.status});}
 assert.ok(upload.data.profile.photoId);checks.push('wasm-validated-upload');
 const read=await db.functions.invoke('photo',{body:{action:'read',roomId:room}});if(read.error)throw Object.assign(new Error('READ'),{stage:'read'});assert.ok(read.data.url);
 const response=await fetch(read.data.url);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/webp/);checks.push('private-signed-read');
 const removed=await db.functions.invoke('photo',{body:{action:'delete',roomId:room,expectedRevision:upload.data.profile.profileRevision}});if(removed.error)throw Object.assign(new Error('DELETE'),{stage:'delete'});assert.equal(removed.data.profile.photoId,null);checks.push('photo-reference-deleted');
 await rpc('bp_end_room',{p_room_id:room});room=null;
 console.log(JSON.stringify({status:'PASS',checks,limits:'One synthetic PNG only; physical device and all format boundaries untested'}));
}catch(e){console.log(JSON.stringify({status:'FAIL',checks,stage:e.stage??'setup',code:typeof e.code==='string'?e.code.slice(0,100):e.code}));process.exitCode=1;}
finally{clearInterval(heartbeat);if(room)await db.rpc('bp_end_room',{p_room_id:room});await db.auth.signOut();}
