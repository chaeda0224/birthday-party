import test from 'node:test';
import assert from 'node:assert/strict';
import { contribute, emptyProfile, initialSnapshot, transition, validateProfile } from '../src/domain/state.ts';
import { LocalSession } from '../src/session/local.ts';
test('profile validates real calendar and unicode lengths', () => {
  assert.equal(validateProfile({ ...emptyProfile(), name: '[NAME_SAMPLE]', month: 2, day: 29 }).day, 29);
  for (const p of [{name:'   '}, {name:'가'.repeat(21)}, {month:2,day:30}, {month:0}]) assert.throws(() => validateProfile({...emptyProfile(),name:'[NAME_SAMPLE]',...p}));
});
test('finite party transitions, stubborn candle scheduling and replay identity', () => {
  let s = initialSnapshot(); const oldRound = s.roundId;
  assert.throws(() => transition(s, 'ignite'));
  s = transition(s, 'prepare'); s = contribute(s, 'shake'); assert.equal(s.charge,12);
  s = transition(s,'ignite'); s = transition(s,'blow');
  for (let i=0;i<5;i++) s=contribute(s,'blow',1000);
  assert.equal(s.phase,'celebrating'); assert.equal(s.startAt,2800);
  s=transition(s,'replay'); assert.notEqual(s.roundId,oldRound); assert.equal(s.wind,0);
});
test('pause rejects actions and preserves contribution',()=>{let s=transition(initialSnapshot(),'prepare');s=contribute(s,'shake');s=transition(s,'pause');assert.equal(contribute(s,'shake'),s);assert.throws(()=>transition(s,'ignite'));assert.equal(transition(s,'resume').charge,12);});
test('single session cleanup removes private profile and image',async()=>{const session=new LocalSession({...emptyProfile(),name:'[NAME_SAMPLE]'});await session.setPhoto(new Blob(['shape']));assert.ok(session.getView().photoUrl);await session.end();assert.equal(session.getView().profile,null);assert.equal(session.getView().photoUrl,null);assert.equal(session.getView().snapshot.phase,'ended');});
test('one breath extinguishes every local candle and age counts validate',()=>{let s=initialSnapshot();s=transition(s,'prepare');s=transition(s,'ignite');s=transition(s,'blow');s=contribute(s,'blow');assert.equal(s.wind,100);assert.equal(s.phase,'celebrating');assert.throws(()=>validateProfile({...emptyProfile(),name:'[NAME_SAMPLE]',longCandles:0,shortCandles:0}));assert.equal(validateProfile({...emptyProfile(),name:'[NAME_SAMPLE]',longCandles:3,shortCandles:2,photoPlacement:'both'}).longCandles,3);});
