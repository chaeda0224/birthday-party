import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('Postgres migration and authorized room lifecycle (Supabase service stubs)', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create schema extensions; create schema auth; create schema storage; create schema realtime;
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      create table realtime.messages(id bigint generated always as identity,topic text,extension text,payload jsonb); alter table realtime.messages enable row level security;
      create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
      create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void language sql as $$ select $$;
    `);
    const sql = await readFile(new URL('../supabase/migrations/202611060001_birthday_party_backend.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(await readFile(new URL('../supabase/migrations/202611060002_review_hardening.sql', import.meta.url), 'utf8'));
    const host = crypto.randomUUID(); const guest = crypto.randomUUID(); const outsider = crypto.randomUUID();
    const identify = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    await identify(host);
    const profile = { name:'[NAME_SAMPLE]',month:3,day:12,gender:'common',honorific:'오늘의 주인공',message:'축하합니다',theme:'strawberry',decoration:'crown',photoId:null,profileRevision:0 };
    const {rows} = await db.query<{result:any}>('select bp_create_room($1::jsonb) result',[JSON.stringify(profile)]);
    const created = rows[0].result;
    assert.equal(created.profile.name, profile.name); assert.equal(created.profile.day,12);
    const room = created.snapshot.roomId;
    await identify(guest);
    const joined = (await db.query<{result:any}>('select bp_join_room($1) result',[created.inviteToken])).rows[0].result;
    assert.equal(joined.snapshot.roomId,room); assert.equal(joined.isHost,false);
    await identify(outsider);
    await assert.rejects(db.query('select bp_snapshot($1)',[room]),/NOT_MEMBER/);
    await identify(host);
    let s=created.snapshot;
    const command=async(action:string)=>{
      const result=await db.query<{result:any}>('select bp_command($1,$2,$3,$4,$5) result',[room,action,crypto.randomUUID(),s.roundId,s.controlRevision]);
      s=result.rows[0].result;
    };
    await command('start'); assert.equal(s.phase,'preparing');
    await command('light'); assert.equal(s.phase,'lit');
    await command('blow'); assert.equal(s.phase,'blowing');
    const request = crypto.randomUUID();
    const args=[room,'button',request,s.roundId,s.controlRevision];
    const first=(await db.query<{result:any}>('select bp_contribute($1,$2,$3,$4,$5) result',args)).rows[0].result;
    const repeated=(await db.query<{result:any}>('select bp_contribute($1,$2,$3,$4,$5) result',args)).rows[0].result;
    assert.equal(first.wind,repeated.wind);
    await db.query('select bp_end_room($1)',[room]);
    await assert.rejects(db.query('select bp_snapshot($1)',[room]),/ROOM_ENDED|NOT_MEMBER/);
    assert.equal((await db.query<{n:number}>('select count(*)::int n from bp_profiles where room_id=$1',[room])).rows[0].n,0);
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    assert.equal((await db.query<{allowed:boolean}>('select bp_maintenance_claim() allowed')).rows[0].allowed,true);
    await db.query('select bp_prune_expired()');
    await db.query('select bp_cleanup_claim(20)');
  } finally { await db.close(); }
});
