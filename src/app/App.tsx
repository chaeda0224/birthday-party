import PartySession from './PartySession';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { VStack } from '@astryxdesign/core/VStack';
import { Theme, defineTheme } from '@astryxdesign/core/theme';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { emptyProfile, presets, validateProfile } from '../domain/state';
import { RELEASE } from '../domain/types';
import type { Contribution, Decoration, Gender, Profile, Session, Theme as CakeTheme } from '../domain/types';
import Cake from '../features/party/Cake';
import Confetti from '../features/effects/Confetti';
import { createMotionSensor } from '../features/devices/motion';
import { createBlowSensor } from '../features/devices/blow';
import { createSoundPlayer } from '../features/devices/sound';
import { preparePhoto, releasePhoto } from '../features/profile/photo';

type AppProps = {
  createLocal: (profile: Profile) => Session;
  createRemote: (profile: Profile) => Promise<{ session: Session; invite: string }>;
  joinRemote: (token: string) => Promise<Session>;
  remoteConfigured: boolean;
};
type Route = 'home' | 'profile-local' | 'profile-remote' | 'join' | 'party';
type SaveProfile = (profile: Profile, photo: Blob | null, removePhoto: boolean) => Promise<void>;
const birthdayTheme = defineTheme({
  name: 'birthday-midnight',
  tokens: {
    '--color-accent': '#D1B37F', '--color-on-accent': '#10100E',
    '--color-background-body': '#070707', '--color-background-surface': '#11110F',
    '--color-background-card': '#151412', '--color-text-primary': '#F0E8DC',
    '--color-text-secondary': '#ADA497', '--color-border': '#36312A',
    '--color-border-emphasized': '#675C49', '--color-warning': '#D1B37F',
    '--color-on-warning': '#10100E', '--color-error': '#F3A6A6',
  },
});

function limitText(value: string, length: number) { return [...value].slice(0, length).join(''); }

export function ProfileForm({
  initial,
  title,
  submitLabel,
  photoUrl,
  onSubmit,
  onCancel,
}: {
  initial: Profile;
  title: string;
  submitLabel: string;
  photoUrl: string | null;
  onSubmit: (profile: Profile, photo: Blob | null, removePhoto: boolean) => Promise<void>;
  onCancel?: () => void;
}) {
  const [profile, setProfile] = useState<Profile>(() => ({ ...initial }));
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{ blob: Blob; url: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) { setFileUrl(null); return; }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => { if (prepared?.url) releasePhoto(prepared.url); }, [prepared]);

  const patchProfile = (patch: Partial<Profile>) => setProfile(current => ({ ...current, ...patch }));
  const chooseGender = (gender: Gender) => patchProfile({ gender });
  const applyGenderPreset = () => patchProfile({ ...presets[profile.gender] });
  const chooseFile = (selected: File | null) => {
    if (prepared?.url) releasePhoto(prepared.url);
    setPrepared(null); setFile(selected); setZoom(1); setOffsetX(0); setOffsetY(0); setRemovePhoto(false); setError('');
  };
  const previewCrop = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const result = await preparePhoto(file, { zoom, offsetX, offsetY });
      setPrepared(previous => { if (previous?.url) releasePhoto(previous.url); return result; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '사진 미리보기를 만들지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const submit = async (event: FormEvent<HTMLElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (file && !prepared) throw new Error('사진 자르기 미리보기를 만든 뒤 저장해 주세요.');
      const ready = validateProfile(profile);
      await onSubmit(ready, prepared?.blob ?? null, removePhoto);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다. 입력을 확인해 주세요.'); }
    finally { setBusy(false); }
  };

  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][profile.month - 1] ?? 31;
  const cropSource = prepared?.url ?? fileUrl;

  return <VStack as="section" className="party-panel profile-panel" gap={5}>
    <header className="panel-heading"><Text className="eyebrow" type="label">축하 준비 서류</Text><Heading level={1}>{title}</Heading><Text type="supporting">표시 이름과 생일만 받습니다. 나이와 출생연도는 묻지 않습니다.</Text></header>
    <VStack as="form" className="profile-form" gap={4} onSubmit={submit}>
      <TextInput label="축하할 이름" value={profile.name} onChange={name => patchProfile({ name: limitText(name, 20) })} placeholder="축하할 이름" isRequired description="별칭도 괜찮습니다. 1~20자로 적어 주세요." />
      <fieldset className="field-group"><legend>생일 월과 일</legend><HStack className="date-fields" gap={3}>
        <label className="party-field"><Text as="span" type="label">월</Text><select aria-label="생일 월" value={profile.month} onChange={event => { const month = Number(event.target.value); patchProfile({ month, day: Math.min(profile.day, [31,29,31,30,31,30,31,31,30,31,30,31][month - 1] ?? 31) }); }}>
          {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}월</option>)}
        </select></label>
        <label className="party-field"><Text as="span" type="label">일</Text><select aria-label="생일 일" value={profile.day} onChange={event => patchProfile({ day: Number(event.target.value) })}>
          {Array.from({ length: daysInMonth }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}일</option>)}
        </select></label>
      </HStack></fieldset>
      <fieldset className="field-group"><legend>호칭 연출</legend><HStack className="choice-row" gap={2} wrap="wrap">
        {(['common', 'male', 'female'] as Gender[]).map(gender => <Button key={gender} type="button" className="choice-button" variant={profile.gender === gender ? 'primary' : 'secondary'} aria-pressed={profile.gender === gender} label={gender === 'common' ? '공통 · 오늘의 주인공' : gender === 'male' ? '남성 · 생일왕' : '여성 · 생일여왕'} onClick={() => chooseGender(gender)} />)}
      </HStack>
        <Button type="button" className="quiet-action preset-action" variant="secondary" label="선택한 연출 기본 문구 적용" onClick={applyGenderPreset} />
        <TextInput label="화면에 표시할 호칭" value={profile.honorific} onChange={honorific => patchProfile({ honorific: limitText(honorific, 20) })} description="성별과 무관하게 직접 고칠 수 있습니다." />
        <label className="party-field"><Text as="span" type="label">축하 대사</Text><textarea value={profile.message} maxLength={80} rows={2} onChange={event => patchProfile({ message: event.target.value })} /></label>
      </fieldset>
      <fieldset className="field-group"><legend>색상과 장식</legend>
        <Text type="label">케이크 색</Text><HStack className="choice-row" gap={2} wrap="wrap">
          {(['strawberry', 'mint', 'chocolate'] as CakeTheme[]).map(theme => <Button key={theme} className="choice-button" type="button" variant={profile.theme === theme ? 'primary' : 'secondary'} aria-pressed={profile.theme === theme} label={theme === 'strawberry' ? '딸기 크림' : theme === 'mint' ? '민트 크림' : '초콜릿 크림'} onClick={() => patchProfile({ theme })} />)}
        </HStack>
        <Text type="label">토퍼 장식</Text><HStack className="choice-row" gap={2} wrap="wrap">
          {(['crown', 'ribbon', 'none'] as Decoration[]).map(decoration => <Button key={decoration} className="choice-button" type="button" variant={profile.decoration === decoration ? 'primary' : 'secondary'} aria-pressed={profile.decoration === decoration} label={decoration === 'crown' ? '왕관' : decoration === 'ribbon' ? '리본' : '장식 없음'} onClick={() => patchProfile({ decoration })} />)}
        </HStack>
      </fieldset>
      <fieldset className="field-group photo-group"><legend>사진 토퍼 <span className="optional-note">선택</span></legend>
        <Text type="supporting">사진은 이 기기에서 원형으로 자릅니다. 함께 축하하는 방에서는 저장을 누를 때 참여자에게 공유됩니다.</Text>
        <label className="file-picker">사진 선택<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => chooseFile(event.target.files?.[0] ?? null)} /></label>
        {cropSource && <section className="crop-workbench" aria-label="사진 자르기 미리보기">
          <figure className="crop-frame"><img src={cropSource} alt="사진 토퍼 자르기 미리보기" style={prepared ? undefined : { objectPosition: `${50 + offsetX * 45}% ${50 + offsetY * 45}%`, transform: `scale(${zoom})` }} /></figure>
          <label className="range-field">확대 <output>{zoom.toFixed(1)}배</output><input type="range" min="1" max="3" step="0.1" value={zoom} onChange={event => { setZoom(Number(event.target.value)); setPrepared(current => { if (current?.url) releasePhoto(current.url); return null; }); }} /></label>
          <label className="range-field">가로 위치 <output>{Math.round(offsetX * 100)}%</output><input type="range" min="-1" max="1" step="0.05" value={offsetX} onChange={event => { setOffsetX(Number(event.target.value)); setPrepared(current => { if (current?.url) releasePhoto(current.url); return null; }); }} /></label>
          <label className="range-field">세로 위치 <output>{Math.round(offsetY * 100)}%</output><input type="range" min="-1" max="1" step="0.05" value={offsetY} onChange={event => { setOffsetY(Number(event.target.value)); setPrepared(current => { if (current?.url) releasePhoto(current.url); return null; }); }} /></label>
          {file && <Button type="button" className="quiet-action" variant="secondary" label={prepared ? '자른 사진 미리보기 갱신' : '자른 사진 미리보기'} isLoading={busy} onClick={previewCrop} />}
        </section>}
        <HStack className="photo-actions" gap={2} wrap="wrap">
          {(file || photoUrl) && <Button type="button" className="quiet-action" variant="secondary" label="사진 교체" onClick={() => document.getElementById('party-photo-input')?.click()} />}
          {(file || photoUrl) && <Button type="button" className="quiet-action" variant="secondary" label="사진 삭제" onClick={() => { chooseFile(null); setRemovePhoto(true); }} />}
          <input id="party-photo-input" className="visually-hidden-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => chooseFile(event.target.files?.[0] ?? null)} />
        </HStack>
        {removePhoto && <Text type="supporting">저장하면 현재 사진 토퍼를 삭제합니다.</Text>}
      </fieldset>
      {error && <Text className="form-error" role="alert">{error}</Text>}
      <HStack className="form-actions" gap={3} wrap="wrap">
        <Button type="submit" className="party-primary" variant="primary" size="lg" label={submitLabel} isLoading={busy} />
        {onCancel && <Button type="button" variant="secondary" label="취소" onClick={onCancel} />}
      </HStack>
    </VStack>
  </VStack>;
}

export default function App({ createLocal, createRemote, joinRemote, remoteConfigured }: AppProps) {
  const [route, setRoute] = useState<Route>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const match = location.hash.match(/(?:^#|&)invite=([^&]+)/);
    if (!match?.[1]) return;
    try { setInviteToken(decodeURIComponent(match[1])); setRoute('join'); history.replaceState(null, '', `${location.pathname}${location.search}`); }
    catch { setError('초대 링크를 읽지 못했습니다. 링크를 다시 확인해 주세요.'); }
  }, []);

  const startParty = async (profile: Profile, photo: Blob | null, remote: boolean) => {
    setBusy(true); setError('');
    let pending: Session | null = null;
    try {
      const result = remote ? await createRemote(profile) : { session: createLocal(profile), invite: '' };
      pending = result.session;
      if (photo) await result.session.setPhoto(photo);
      await result.session.command('prepare');
      setInvite(remote ? result.invite : null); setSession(result.session); setRoute('party');
    } catch (cause) { if (pending) { try { await pending.end(); } catch {} pending.dispose(); } throw cause; }
    finally { setBusy(false); }
  };
  const joinParty = async (event: FormEvent<HTMLElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const next = await joinRemote(inviteToken.trim()); setInvite(null); setSession(next); setRoute('party'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '방에 참여하지 못했습니다. 초대 링크를 확인해 주세요.'); }
    finally { setBusy(false); }
  };
  const leaveParty = () => { session?.dispose(); setSession(null); setInvite(null); setRoute('home'); setNotice('파티가 끝났습니다. 단독 진행 기록은 이 기기에 저장되지 않습니다.'); };
  const startRoute = (next: Route) => { setError(''); setNotice(''); setRoute(next); };

  return <Theme theme={birthdayTheme} mode="dark"><AppShell height="auto" contentPadding={0}>
    <VStack as="main" className="party-app" data-theme={route === 'profile-local' || route === 'profile-remote' ? 'strawberry' : 'strawberry'} gap={4}>
      <header className="brandline"><Text className="brand-mark" type="label">생일 정상처리</Text><Text className="brand-status" type="supporting">A moment, just for you.</Text></header>
      {route === 'home' && <VStack as="section" className="landing panel-frame" gap={5}>
        <section className="landing-copy"><Text className="eyebrow" type="label">오늘, 당신을 위한 작은 의식</Text><Heading level={1} type="display-2">소원을 빌어요.<br className="wide-break"/> 불은 우리가 켤게요.</Heading><Text className="landing-deck">같은 마음으로 모여, 한 번에 후.<br/>마지막 촛불은 조금 고집을 부릴지도요.</Text></section>
        <section className="landing-cake" aria-label="생일 파티 케이크"><Cake name="" photoUrl={null} theme="strawberry" decoration="crown" phase="lit" candleCount={5} wind={0} startAt={null} reducedMotion={false}/></section>
        <section className="landing-actions"><Button className="party-primary" variant="primary" size="lg" label="혼자 축하하기" onClick={() => startRoute('profile-local')} /><Button className="secondary-entry" variant="secondary" size="lg" label="함께 축하하기" onClick={() => remoteConfigured ? startRoute('profile-remote') : setNotice('공동 파티 서버 연결을 준비 중입니다. 단독 진행으로 바로 시작할 수 있습니다.')} />
          {remoteConfigured ? <Text type="supporting">방을 만들거나 초대 링크로 참여할 수 있습니다.</Text> : <Text className="service-note" type="supporting">공동 파티는 백엔드 연결 준비 중입니다. 단독으로는 지금 시작할 수 있습니다.</Text>}
        </section>
        <section className="landing-stamp" aria-label="파티 진행 순서"><Text className="stamp-number">01</Text><Text type="label">케이크 준비</Text><Text className="stamp-arrow" aria-hidden="true">→</Text><Text className="stamp-number">02</Text><Text type="label">촛불 소등</Text><Text className="stamp-arrow" aria-hidden="true">→</Text><Text className="stamp-number">03</Text><Text type="label">업무 종료</Text></section>
        {notice && <Text className="status-note" role="status">{notice}</Text>}
      </VStack>}
      {(route === 'profile-local' || route === 'profile-remote') && <>
        {route === 'profile-remote' && !remoteConfigured ? <VStack as="section" className="party-panel" gap={3}><Heading level={1}>공동 방 준비 중</Heading><Text>공동 파티 서버가 아직 연결되지 않았습니다. 단독 모드로는 바로 진행할 수 있습니다.</Text><Button className="party-primary" variant="primary" label="단독으로 준비하기" onClick={() => startRoute('profile-local')} /><Button variant="secondary" label="처음으로" onClick={() => startRoute('home')} /></VStack> : <ProfileForm initial={emptyProfile()} title={route === 'profile-remote' ? '함께 축하할 방 만들기' : '오늘의 주인공 등록'} submitLabel={busy ? '연결 중…' : route === 'profile-remote' ? '방 만들고 준비하기' : '축하 준비 완료'} photoUrl={null} onSubmit={(profile, photo) => startParty(profile, photo, route === 'profile-remote')} onCancel={() => startRoute('home')} />}
      </>}
      {route === 'join' && <VStack as="section" className="party-panel join-panel" gap={4}>
        <header className="panel-heading"><Text className="eyebrow" type="label">초대받은 방 입장</Text><Heading level={1}>축하 인원을 확인합니다</Heading><Text type="supporting">공유받은 초대 링크를 사용합니다. 참여를 누르기 전에는 마이크를 켜지 않습니다.</Text></header>
        <VStack as="form" className="join-form" gap={3} onSubmit={joinParty}><TextInput label="초대 코드" value={inviteToken} onChange={setInviteToken} placeholder="초대 링크의 코드를 붙여 넣으세요" isRequired /><Button className="party-primary" variant="primary" size="lg" type="submit" label="초대받은 방 참여" isLoading={busy} />{error && <Text className="form-error" role="alert">{error}</Text>}</VStack>
        <Text type="supporting">아직 공동 서버 연결을 준비하고 있다면, 단독 진행은 계속 사용할 수 있습니다.</Text><Button variant="secondary" label="처음으로" onClick={() => startRoute('home')} />
      </VStack>}
      {route === 'party' && session && <PartySession key={session.getView().memberId} session={session} onLeave={leaveParty} invite={invite} />}
      {route !== 'home' && error && route !== 'join' && <Text className="form-error" role="alert">{error}</Text>}
      <footer className="page-footer"><Text type="supporting">단독 진행은 새로고침하면 초기화됩니다. 소리와 센서는 직접 켠 기기에서만 사용합니다.</Text><Text type="supporting">v{RELEASE.version} · {RELEASE.date}</Text></footer>
    </VStack>
  </AppShell></Theme>;
}
