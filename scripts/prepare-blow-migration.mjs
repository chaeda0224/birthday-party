import fs from 'node:fs';
const source=fs.readFileSync('supabase/migrations/202611060002_review_hardening.sql','utf8');
const start=source.indexOf('create or replace function public.bp_contribute(');
const end=source.indexOf('end $$;',start)+7;
let sql=source.slice(start,end);
sql=sql.replace("if r.mic_id is null or m.member_id<>r.mic_id then raise exception using errcode='P0001',message='NOT_MIC';end if;",'');
sql=sql.replace('r.wind:=least(100,r.wind+20);','r.wind:=100;');
fs.writeFileSync('supabase/migrations/202611060004_one_blow_for_everyone.sql',sql+"\nnotify pgrst,'reload schema';\n");
console.log('One accepted blow extinguishes every candle for the room');
