import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { Button } from '@astryxdesign/core/Button';
import QRCode from 'qrcode';
import type { Profile, Session } from '../domain/types';
import { ProfileForm } from './App';
import Cake from '../features/party/Cake';
import Confetti from '../features/effects/Confetti';
import { createMotionSensor } from '../features/devices/motion';
import { createBlowSensor } from '../features/devices/blow';
import { createSoundPlayer } from '../features/devices/sound';
import { createOrientationSensor } from '../features/devices/orientation';

export default function PartySession({session,onLeave,invite}:{session:Session;onLeave:()=>void;invite:string|null}) {
  const view=useSyncExternalStore(session.subscribe,session.getView,session.getView), s=view.snapshot, p=view.profile;
  const [editing,setEditing]=useState(false),[pauseOwned,setPauseOwned]=useState(false),[message,setMessage]=useState('');
  const [micOn,setMicOn]=useState(false),[motionOn,setMotionOn]=useState(false),[soundOn,setSoundOn]=useState(false);
  const [micLevel,setMicLevel]=useState(0);
  const [stage,setStage]=useState(false),[jolt,setJolt]=useState(false),[now,setNow]=useState(Date.now()),[qr,setQr]=useState('');
  const [reduce,setReduce]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [tilt,setTilt]=useState({x:0,y:0}),[gyroOn,setGyroOn]=useState(false);
  const gyro=useRef<ReturnType<typeof createOrientationSensor>|null>(null);
  const motion=useRef<ReturnType<typeof createMotionSensor>|null>(null),mic=useRef<ReturnType<typeof createBlowSensor>|null>(null),sound=useRef<ReturnType<typeof createSoundPlayer>|null>(null);
  const handled=useRef(new Set<string>()), initialRound=useRef(s.roundId), joinedAt=useRef(Date.now());
  const action=async(fn:()=>Promise<void>)=>{try{await fn();setMessage('');}catch(e){setMessage(e instanceof Error?e.message:'잠시 후 다시 눌러 주세요.');}};
  const stop=()=>{motion.current?.stop();mic.current?.stop();sound.current?.stop();gyro.current?.stop();setMicOn(false);setMotionOn(false);setGyroOn(false);};
  const ready=view.connected&&!s.paused&&s.phase!=='ended';
  const celebrating=s.phase==='celebrating'&&now>=(s.startAt??0)&&ready;
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant'});},[editing]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),150);return()=>clearInterval(timer);},[]);
  useEffect(()=>{let active=true;if(invite)void QRCode.toDataURL(invite,{margin:1,width:180,errorCorrectionLevel:'M'}).then(v=>{if(active)setQr(v);});return()=>{active=false;};},[invite]);
  useEffect(()=>{
    motion.current=createMotionSensor(()=>{void session.contribute('shake').catch(()=>undefined);setJolt(true);});
    mic.current=createBlowSensor(()=>{void session.contribute('blow').catch((e)=>setMessage(e instanceof Error?e.message:'입김 전달을 다시 시도해 주세요.'));},setMicLevel);sound.current=createSoundPlayer();gyro.current=createOrientationSensor(setTilt);
    const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);
    return()=>{document.removeEventListener('visibilitychange',hidden);motion.current?.stop();mic.current?.stop();sound.current?.dispose();gyro.current?.stop();};
  },[session]);
  useEffect(()=>{if(!jolt)return;const t=setTimeout(()=>setJolt(false),450);return()=>clearTimeout(t);},[jolt]);
  useEffect(()=>{
    if(!ready){gyro.current?.stop();setGyroOn(false);}
    if(!ready||s.phase!=='preparing'){motion.current?.stop();setMotionOn(false);}
    if(!ready||s.phase!=='blowing'){mic.current?.stop();setMicOn(false);setMicLevel(0);}
    if(!ready||s.phase==='blowing'||s.audioId!==view.memberId||!soundOn)sound.current?.stop();
  },[ready,s.phase,s.micId,s.audioId,view.memberId,soundOn]);
  useEffect(()=>{
    if(!soundOn||!ready||s.audioId!==view.memberId||s.phase==='blowing')return;
    void session.acknowledgeAudio('ready').catch(()=>undefined);
    const t=setInterval(()=>void session.acknowledgeAudio('ready').catch(()=>undefined),20000);return()=>clearInterval(t);
  },[soundOn,ready,s.audioId,s.phase,s.controlRevision,session,view.memberId]);
  useEffect(()=>{if(ready&&s.phase==='blowing'&&s.audioId===view.memberId){sound.current?.stop();void session.acknowledgeAudio('stopped').catch(()=>undefined);}},[ready,s.phase,s.audioId,s.controlRevision,view.memberId,session]);
  useEffect(()=>{
    const key=s.roundId+':'+s.startAt;
    if(!celebrating||!soundOn||s.audioId!==view.memberId||handled.current.has(key))return;
    if(s.roundId===initialRound.current&&(s.startAt??0)<joinedAt.current-1000){handled.current.add(key);return;}
    handled.current.add(key);sound.current?.play('party');const t=setTimeout(()=>sound.current?.play('fart'),2200);return()=>clearTimeout(t);
  },[celebrating,soundOn,s.audioId,s.roundId,s.startAt,view.memberId]);
  if(!p||s.phase==='ended')return <VStack className="party-panel finish-panel" gap={4}><Heading level={1}>생일 업무 종료</Heading><Text>이 화면의 이름과 사진을 지웠습니다.{session.mode==='remote'?' 서버의 사진 삭제는 정리 작업에서 이어집니다.':''}</Text><Button variant="primary" className="party-primary" label="처음으로" onClick={onLeave}/></VStack>;
  const edit=()=>action(async()=>{const pause=!s.paused&&s.phase!=='waiting';if(pause)await session.command('pause');setPauseOwned(pause);setEditing(true);});
  const closeEdit=async()=>{setEditing(false);if(pauseOwned)await session.command('resume');setPauseOwned(false);};
  const save=async(profile:Profile,photo:Blob|null,remove:boolean)=>{await session.updateProfile(profile);if(photo)await session.setPhoto(photo);else if(remove)await session.setPhoto(null);await closeEdit();};
  if(editing)return <ProfileForm initial={p} title="설정 수정" submitLabel="설정 저장" photoUrl={view.photoUrl} onSubmit={save} onCancel={()=>void action(closeEdit)}/>;
  const enableMotion=()=>action(async()=>{const result=await motion.current!.start();const current=session.getView();if(current.snapshot.phase!=='preparing'||current.snapshot.paused||document.hidden){motion.current?.stop();return;}setMotionOn(result.supported);setMessage(result.supported?'가볍게 흔들어 주세요. 제과 부문이 긴장합니다.':'이 기기는 버튼으로 흔들어 주세요.');});
  const enableMic=()=>action(async()=>{await mic.current!.start();const current=session.getView();if(current.snapshot.phase!=='blowing'||current.snapshot.paused||document.hidden||!current.connected){mic.current?.stop();return;}setMicOn(true);setMessage('잠깐 조용히 기다린 뒤 불어 주세요. 원음은 전송하지 않습니다.');});
  const toggleSound=()=>action(async()=>{if(soundOn){sound.current?.stop();setSoundOn(false);await session.acknowledgeAudio('stopped');return;}await sound.current!.unlock();await session.setRoles(s.micId,view.memberId);await session.acknowledgeAudio('ready');setSoundOn(true);sound.current?.play('ignite');});
  const primary=()=>action(async()=>{
    if(s.phase==='waiting')await session.command('prepare');
    else if(s.phase==='preparing'){if(view.isHost)await session.command('ignite');else{await session.contribute('button');setJolt(true);}}
    else if(s.phase==='lit'){sound.current?.stop();if(s.audioId===view.memberId)await session.acknowledgeAudio('stopped');await session.command('blow');}
    else if(s.phase==='blowing')await session.contribute('button');
    else if(s.phase==='celebrating')await session.command('replay');
  });
  const labels={waiting:'축하 준비 시작',preparing:view.isHost?'촛불 켜기':'대충 흔들기',lit:'다 같이 불기',blowing:'바람 보태기',celebrating:'한 번 더 축하하기',ended:'끝'};
  const jokes={waiting:'케이크 마음 준비 중입니다.',preparing:jolt?'제과 부문 지각변동 발생.':'흔들어 주세요. 케이크가 출근했습니다.',lit:'소원을 빌어 주세요. 접수만 받겠습니다.',blowing:'의지는 접수했습니다. 바람도 제출 바랍니다.',celebrating:celebrating?'금일 생일 업무 정상 처리.':'저는 쉽게 꺼지는 사람이 아닙니다.',ended:''};
  const totalCandles=p.longCandles+p.shortCandles;
  const candles=s.phase==='blowing'?Math.max(1,Math.ceil(totalCandles*(1-s.wind/100))):s.phase==='lit'?totalCandles:0;
  const visibleAction=view.isHost||['preparing','blowing'].includes(s.phase);
  return <VStack as="section" className={`party-screen${stage?' stage-only':''}${jolt&&!reduce?' cake-jolt':''}${view.photoUrl&&p.photoPlacement!=='topper'?' has-photo-backdrop':''}`} gap={3}>
    {view.photoUrl&&p.photoPlacement!=='topper'&&<figure className="party-photo-backdrop" aria-label="생일자 배경 사진"><img src={view.photoUrl} alt=""/></figure>}
    <Confetti active={celebrating&&!(s.roundId===initialRound.current&&(s.startAt??0)<joinedAt.current-1000)} seed={s.roundId} reducedMotion={reduce}/>
    <header className="party-topline"><Text className="eyebrow">생일 정상처리 · {session.mode==='local'?'단독 행사':'공동 행사'}</Text><HStack gap={2} wrap="wrap"><Button className="quiet-action" variant="secondary" label={stage?'조작 화면으로':'무대 크게 보기'} onClick={()=>setStage(!stage)}/>{view.isHost&&!stage&&<Button className="quiet-action" variant="secondary" label="설정 수정" onClick={()=>void edit()}/>}<Button className="quiet-action" variant="secondary" label={soundOn?'소리 끄기':'소리 켜기'} isDisabled={!view.isHost||!ready||s.phase==='blowing'} onClick={()=>void toggleSound()}/></HStack></header>
    {invite&&<aside className="invite-strip">{qr&&<img src={qr} alt="파티 입장 QR 코드"/>}<VStack gap={1}><Text>함께 불어줄 사람을 부르세요.</Text><Button className="quiet-action" variant="secondary" label="초대 링크 복사" onClick={()=>void action(async()=>{await navigator.clipboard.writeText(invite);setMessage('초대 링크를 복사했습니다.');})}/></VStack></aside>}
    <Cake name={p.name} photoUrl={p.photoPlacement==='background'?null:view.photoUrl} theme={p.theme} decoration={p.decoration} phase={s.phase} candleCount={candles} wind={s.wind} startAt={s.startAt} reducedMotion={reduce} jolt={jolt} longCandles={p.longCandles} shortCandles={p.shortCandles} tilt={tilt}/>
    <VStack className="party-captions" gap={1}><Heading level={1}>{p.honorific} · {p.name}</Heading><Text className="birthday-line">{p.month}월 {p.day}일 · {p.message}</Text><Text className="office-line" aria-live="polite">{s.paused?'잠시 멈췄습니다. 축하 의지는 보존됩니다.':jokes[s.phase]}</Text>{s.phase==='preparing'&&<Text className="meter-line">준비 기여 {s.charge}%</Text>}{s.phase==='blowing'&&<Text className="meter-line">소등 기여 {s.wind}%</Text>}{!view.connected&&<Text role="status">연결을 확인하고 있습니다.</Text>}{view.error&&<Text role="alert" className="form-error">{view.error}</Text>}</VStack>
    {!stage&&<VStack className="party-controls" gap={3}>
      {visibleAction&&<Button className="party-primary" variant="primary" size="lg" label={labels[s.phase]} isDisabled={!ready} onClick={()=>void primary()}/>}
      {s.phase==='preparing'&&view.isHost&&<Button className="contribute-action" variant="secondary" label="대충 흔들기" isDisabled={!ready} onClick={()=>void action(async()=>{await session.contribute('button');setJolt(true);})}/>}
      {s.phase==='preparing'&&<Button className="quiet-action" variant="secondary" label={motionOn?'흔들기 감지 끄기':'흔들기 센서 켜기'} isDisabled={!ready} onClick={()=>{if(motionOn){motion.current?.stop();setMotionOn(false);}else void enableMotion();}}/>}
      {s.phase==='blowing'&&<Button className="quiet-action" variant="secondary" label={micOn?'마이크 끄기':'입김으로 촛불 끄기 · 마이크 켜기'} isDisabled={!ready} onClick={()=>{if(micOn){mic.current?.stop();setMicOn(false);}else void enableMic();}}/>}
      {micOn&&<VStack gap={1} className="mic-meter"><progress aria-label="마이크 입력 크기" max={0.08} value={micLevel}/><Text>휴대폰 아래쪽 마이크에 가볍게 후. 한 번이면 모두 꺼집니다.</Text></VStack>}
      {view.isHost&&<HStack gap={2} wrap="wrap">{['preparing','lit','blowing'].includes(s.phase)&&<Button className="quiet-action" variant="secondary" label="강제 소등" isDisabled={!ready} onClick={()=>void action(async()=>{stop();await session.command('force');})}/>}<Button className="quiet-action" variant="secondary" label={s.paused||!view.connected?'파티 이어가기':'잠시 멈춤'} onClick={()=>void action(async()=>{stop();await session.command(s.paused||!view.connected?'resume':'pause');})}/></HStack>}
      <Button className="quiet-action" variant="secondary" label={gyroOn?'기울기 반응 끄기':'기울여 둘러보기'} isDisabled={!ready||reduce} onClick={()=>void action(async()=>{if(gyroOn){gyro.current?.stop();setGyroOn(false);}else{const result=await gyro.current!.start();setGyroOn(result.supported);setMessage(result.supported?'기기를 천천히 기울여 보세요.':'이 기기에서는 기울기 감지를 사용할 수 없어 고정 구도로 보여드립니다.');}})}/>
      <details className="device-options"><summary>기기와 움직임 설정</summary><label className="motion-switch"><input type="checkbox" checked={reduce} onChange={e=>{setReduce(e.target.checked);if(e.target.checked){gyro.current?.stop();setGyroOn(false);}}}/>움직임 줄이기</label>{view.isHost&&<label>불기 담당 기기<select value={s.micId??''} onChange={e=>void action(()=>session.setRoles(e.target.value||null,s.audioId))}><option value="">버튼으로만 진행</option>{view.members.map((member,index)=><option key={member.id} value={member.id}>{member.id===view.memberId?'이 기기':`참여 기기 ${index+1}`}</option>)}</select></label>}</details>
      {message&&<Text className="status-note" role="status">{message}</Text>}
      {view.isHost?<Button className="end-action" variant="secondary" label="파티 종료하고 정보 지우기" onClick={()=>void action(async()=>{stop();await session.end();})}/>:<Button className="end-action" variant="secondary" label="파티 나가기" onClick={onLeave}/>}
    </VStack>}
  </VStack>;
}
