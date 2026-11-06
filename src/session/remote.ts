import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { validateProfile } from '../domain/state';
import type { Command, Contribution, Profile, Session, SessionView, Snapshot } from '../domain/types';

const projectUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const remoteConfigured = Boolean(projectUrl?.startsWith('https://') && publishableKey);
let sharedClient: SupabaseClient | undefined;
async function client(): Promise<SupabaseClient> {
  if (!remoteConfigured) throw new Error('함께 축하하기를 준비하고 있어요. 지금은 혼자 축하하기를 이용해 주세요.');
  if (!sharedClient) {
    const { createClient } = await import('@supabase/supabase-js');
    sharedClient = createClient(projectUrl!, publishableKey!, { auth: { storage: sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  const { data } = await sharedClient.auth.getSession();
  if (!data.session) { const auth = await sharedClient.auth.signInAnonymously(); if (auth.error) throw new Error('방 입장을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  return sharedClient;
}
const messages: Record<string, string> = {
  ROOM_ENDED: '종료된 파티입니다.', ROOM_EXPIRED: '파티의 입장 시간이 끝났습니다.', NOT_MEMBER: '이 파티의 초대 링크로 다시 입장해 주세요.',
  NOT_HOST: '진행자만 할 수 있는 동작입니다.', STALE_REVISION: '다른 화면에서 설정이 바뀌었습니다. 새 설정을 확인해 주세요.',
  STALE_ROUND: '새 파티가 시작됐어요. 화면을 다시 연결합니다.', HOST_PAUSED: '진행자 연결을 기다리고 있어요.',
  RATE_LIMITED: '조금만 천천히 눌러 주세요.', UNSUPPORTED_IMAGE: 'JPEG, PNG, WebP 사진을 선택해 주세요.',
};
function safeError(error: { message?: string } | null): Error {
  const key = Object.keys(messages).find(k => error?.message?.includes(k));
  return Object.assign(new Error(key ? messages[key] : '연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.'), { code: key });
}
interface ResponseView { snapshot: Snapshot; profile: Profile | null; memberId?: string; isHost?: boolean; members?: SessionView['members']; inviteToken?: string }
function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  const time = (v: unknown) => typeof v === 'number' ? v : Date.parse(String(v));
  return { ...snapshot, startAt: snapshot.startAt == null ? null : time(snapshot.startAt), expiresAt: time(snapshot.expiresAt), hostLeaseUntil: time(snapshot.hostLeaseUntil), audioLeaseUntil: snapshot.audioLeaseUntil == null ? null : time(snapshot.audioLeaseUntil), serverNow: snapshot.serverNow == null ? undefined : time(snapshot.serverNow) };
}
export class RemoteSession implements Session {
  readonly mode = 'remote' as const;
  private view: SessionView;
  private listeners = new Set<() => void>();
  private channel?: RealtimeChannel;
  private poll?: ReturnType<typeof setInterval>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private disposed = false;
  private syncBusy = false;
  private photoId: string | null = null;
  private photoRequest = 0;
  private lastInput = 0;
  private photoRefresh?: ReturnType<typeof setTimeout>;
  constructor(private db: SupabaseClient, data: ResponseView, memberId: string) {
    this.view = { snapshot: normalizeSnapshot(data.snapshot), profile: data.profile, memberId: data.memberId ?? memberId, isHost: data.isHost ?? data.snapshot.hostId === memberId, members: data.members ?? (data.snapshot as Snapshot & {members: SessionView['members']}).members ?? [], connected: true, photoUrl: null, error: null };
    this.poll = setInterval(() => { void this.refresh(); }, 5000);
    this.heartbeat = setInterval(() => { void this.beat(); this.checkExpiry(); }, 2000);
    this.channel = db.channel(`room:${data.snapshot.roomId}`, { config: { private: true } })
      .on('broadcast', { event: '*' }, () => { void this.refresh(); })
      .subscribe(status => { if (status === 'SUBSCRIBED') void this.refresh(); });
    document.addEventListener('visibilitychange', this.visibility);
    void this.refreshPhoto();
  }
  getView = () => this.view;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<SessionView>) { if (this.disposed) return; this.view = { ...this.view, ...patch }; this.listeners.forEach(fn => fn()); }
  private checkExpiry() {
    if (Date.now() >= this.view.snapshot.expiresAt) this.terminal('파티의 입장 시간이 끝났습니다.');
    else if (Date.now() > this.view.snapshot.hostLeaseUntil && this.view.snapshot.phase !== 'ended') this.update({ connected: false, photoUrl: null, error: '진행자 연결을 기다리고 있어요.' });
  }
  private visibility = () => { if (document.hidden) this.update({ connected: false }); else void this.refresh(); };
  private apply(data: ResponseView | Snapshot) {
    const next = normalizeSnapshot('snapshot' in data ? data.snapshot : data);
    if (!next || next.revision < this.view.snapshot.revision) return;
    if (next.phase === 'ended') { this.terminal(); return; }
    this.update({ snapshot: next, members: (next as Snapshot & {members?: SessionView['members']}).members ?? this.view.members, ...('profile' in data ? { profile: data.profile, memberId: data.memberId ?? this.view.memberId, isHost: data.isHost ?? this.view.isHost } : {}), connected: true, error: null });
    if (this.view.profile?.photoId !== this.photoId) void this.refreshPhoto();
  }
  private async rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) { const e = safeError(error); if (['ROOM_ENDED', 'ROOM_EXPIRED', 'NOT_MEMBER'].includes((e as Error & {code:string}).code)) this.terminal(e.message); throw e; }
    return data;
  }
  async refresh() {
    if (this.disposed || this.syncBusy || this.view.snapshot.phase === 'ended') return;
    this.syncBusy = true;
    try { this.apply(await this.rpc('bp_snapshot', { p_room_id: this.view.snapshot.roomId })); }
    catch (e) { if (this.getView().snapshot.phase !== 'ended') this.update({ connected: false, error: (e as Error).message }); }
    finally { this.syncBusy = false; }
  }
  private async beat() {
    if (!this.view.isHost || document.hidden || this.view.snapshot.phase === 'ended') return;
    try { this.apply(await this.rpc('bp_heartbeat', { p_room_id: this.view.snapshot.roomId })); }
    catch { this.update({ connected: false }); }
  }
  async command(action: Command) {
    const s = this.view.snapshot;
    const actions: Record<Command, string> = {prepare:'start',ignite:'light',blow:'blow',force:'force_extinguish',pause:'pause',resume:Date.now()>s.hostLeaseUntil?'recover':'resume',replay:'celebrate_again'};
    this.apply(await this.rpc('bp_command', { p_room_id: s.roomId, p_action: actions[action], p_request_id: crypto.randomUUID(), p_round_id: s.roundId, p_control_revision: s.controlRevision }));
  }
  async contribute(kind: Contribution) {
    if (Date.now() - this.lastInput < 250 || !this.view.connected) return;
    this.lastInput = Date.now(); const s = this.view.snapshot;
    this.apply(await this.rpc('bp_contribute', { p_room_id: s.roomId, p_kind: kind, p_request_id: crypto.randomUUID(), p_round_id: s.roundId, p_control_revision: s.controlRevision }));
  }
  async updateProfile(profile: Profile) {
    this.apply(await this.rpc('bp_update_profile', { p_room_id: this.view.snapshot.roomId, p_profile: validateProfile(profile), p_expected_revision: profile.profileRevision }));
  }
  private async photoRequestBody(body: FormData | Record<string, unknown>) {
    const { data, error } = await this.db.functions.invoke('photo', { body });
    if (error) throw new Error('사진을 반영하지 못했습니다. 기존 사진은 유지됩니다.');
    return data;
  }
  async setPhoto(blob: Blob | null) {
    const p = this.view.profile; if (!p) return;
    if (blob) { const form = new FormData(); form.set('action', 'upload'); form.set('roomId', this.view.snapshot.roomId); form.set('expectedRevision', String(p.profileRevision)); form.set('file', blob, 'portrait.webp'); await this.photoRequestBody(form); }
    else await this.photoRequestBody({ action: 'delete', roomId: this.view.snapshot.roomId, expectedRevision: p.profileRevision });
    await this.refresh();
  }
  private async refreshPhoto() {
    clearTimeout(this.photoRefresh);
    const id = this.view.profile?.photoId ?? null; const request = ++this.photoRequest; this.photoId = id;
    if (!id) { this.update({ photoUrl: null }); return; }
    try {
      const result = await this.photoRequestBody({ action: 'read', roomId: this.view.snapshot.roomId });
      if (request !== this.photoRequest || this.disposed || this.view.snapshot.phase === 'ended' || this.view.profile?.photoId !== id) return;
      this.update({ photoUrl: result.url }); this.photoRefresh = setTimeout(() => { void this.refreshPhoto(); }, 45000);
    } catch { if (request === this.photoRequest) this.update({ photoUrl: null }); }
  }
  async setRoles(micId: string | null, audioId: string | null) { this.apply(await this.rpc('bp_set_roles', { p_room_id: this.view.snapshot.roomId, p_mic_id: micId, p_audio_id: audioId })); }
  async acknowledgeAudio(kind: 'ready' | 'stopped') { const s = this.view.snapshot; this.apply(await this.rpc('bp_role_ack', {p_room_id:s.roomId,p_member_id:this.view.memberId,p_role:'audio',p_kind:kind,p_round_id:s.roundId,p_control_revision:s.controlRevision,p_role_epoch:s.roleEpoch})); }
  async end() { await this.rpc('bp_end_room', { p_room_id: this.view.snapshot.roomId }); this.terminal(); }
  private terminal(error: string | null = null) {
    this.photoRequest++; clearTimeout(this.photoRefresh); clearInterval(this.poll); clearInterval(this.heartbeat);
    if (this.channel) void this.db.removeChannel(this.channel);
    this.update({ snapshot: { ...this.view.snapshot, phase: 'ended' }, profile: null, photoUrl: null, connected: false, error });
  }
  dispose() { this.disposed = true; this.photoRequest++; clearTimeout(this.photoRefresh); clearInterval(this.poll); clearInterval(this.heartbeat); document.removeEventListener('visibilitychange', this.visibility); if (this.channel) void this.db.removeChannel(this.channel); this.listeners.clear(); this.view = { ...this.view, profile: null, photoUrl: null }; }
}
export async function createRemote(profile: Profile): Promise<{ session: Session; invite: string }> {
  const db = await client(); const { data, error } = await db.rpc('bp_create_room', { p_profile: validateProfile(profile) });
  if (error) throw safeError(error);
  const { data: auth } = await db.auth.getUser(); if (!auth.user) throw new Error('로그인이 만료되었습니다.');
  const session = new RemoteSession(db, data, auth.user.id);
  try { await session.setRoles(session.getView().memberId, null); } catch (e) { session.dispose(); throw e; }
  return { session, invite: `${location.origin}${location.pathname}#invite=${encodeURIComponent(data.inviteToken)}` };
}
export async function joinRemote(token: string): Promise<Session> {
  const db = await client(); const { data, error } = await db.rpc('bp_join_room', { p_token: token });
  if (error) throw safeError(error); const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('로그인이 만료되었습니다.'); return new RemoteSession(db, data, auth.user.id);
}
