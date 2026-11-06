import { contribute, initialSnapshot, transition, validateProfile } from '../domain/state';
import type { Command, Contribution, Profile, Session, SessionView } from '../domain/types';
export class LocalSession implements Session {
  readonly mode = 'local' as const;
  private listeners = new Set<() => void>();
  private lastInput = 0;
  private view: SessionView;
  constructor(profile: Profile) { this.view = { snapshot: initialSnapshot(), profile: validateProfile(profile), memberId: 'local', isHost: true, connected: true, members: [{ id: 'local', role: 'host' }], photoUrl: null, error: null }; }
  getView = () => this.view;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<SessionView>) { this.view = { ...this.view, ...patch }; this.listeners.forEach(fn => fn()); }
  async command(action: Command) { this.update({ snapshot: transition(this.view.snapshot, action) }); }
  async contribute(kind: Contribution) { if (Date.now() - this.lastInput < 250) return; this.lastInput = Date.now(); this.update({ snapshot: contribute(this.view.snapshot, kind) }); }
  async updateProfile(profile: Profile) {
    if (this.view.snapshot.phase === 'ended') throw new Error('종료된 파티입니다.');
    this.update({ profile: { ...validateProfile(profile), profileRevision: (this.view.profile?.profileRevision ?? 0) + 1 } });
  }
  async setPhoto(blob: Blob | null) { if (this.view.photoUrl) URL.revokeObjectURL(this.view.photoUrl); this.update({ photoUrl: blob ? URL.createObjectURL(blob) : null }); }
  async setRoles(micId: string | null, audioId: string | null) { this.update({ snapshot: { ...this.view.snapshot, micId, audioId } }); }
  async acknowledgeAudio(_kind: 'ready' | 'stopped') {}
  async end() { if (this.view.photoUrl) URL.revokeObjectURL(this.view.photoUrl); this.update({ profile: null, photoUrl: null, snapshot: { ...this.view.snapshot, phase: 'ended' } }); }
  dispose() { if (this.view.photoUrl) URL.revokeObjectURL(this.view.photoUrl); this.listeners.clear(); this.view = { ...this.view, photoUrl: null, profile: null }; }
}
