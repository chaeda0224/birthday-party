export type Phase = 'waiting' | 'preparing' | 'lit' | 'blowing' | 'celebrating' | 'ended';
export type Gender = 'common' | 'male' | 'female';
export type Theme = 'strawberry' | 'mint' | 'chocolate';
export type Decoration = 'crown' | 'ribbon' | 'none';
export interface Profile {
  name: string; month: number; day: number; gender: Gender; honorific: string; message: string;
  theme: Theme; decoration: Decoration; photoId: string | null; profileRevision: number;
  longCandles: number; shortCandles: number; photoPlacement: 'topper' | 'background' | 'both';
}
export interface Snapshot {
  roomId: string; roundId: string; revision: number; controlRevision: number; phase: Phase;
  paused: boolean; charge: number; wind: number; candleCount: number; startAt: number | null;
  expiresAt: number; hostLeaseUntil: number; leaseSeq: number; roleEpoch: number;
  hostId: string; micId: string | null; audioId: string | null;
  audioLeaseUntil?: number | null; serverNow?: number;
}
export interface Member { id: string; role: 'host' | 'guest' | 'stage' }
export interface SessionView {
  snapshot: Snapshot; profile: Profile | null; memberId: string; isHost: boolean;
  connected: boolean; members: Member[]; photoUrl: string | null; error: string | null;
}
export type Command = 'prepare' | 'ignite' | 'blow' | 'force' | 'pause' | 'resume' | 'replay';
export type Contribution = 'shake' | 'blow' | 'button';
export interface Session {
  readonly mode: 'local' | 'remote';
  getView(): SessionView;
  subscribe(listener: () => void): () => void;
  command(action: Command): Promise<void>;
  contribute(kind: Contribution): Promise<void>;
  updateProfile(profile: Profile): Promise<void>;
  setPhoto(blob: Blob | null): Promise<void>;
  setRoles(micId: string | null, audioId: string | null): Promise<void>;
  acknowledgeAudio(kind: 'ready' | 'stopped'): Promise<void>;
  end(): Promise<void>;
  dispose(): void;
}
export const RELEASE = { version: '0.1.2', date: '2026-11-06' } as const;
