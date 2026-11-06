import type { Command, Contribution, Gender, Profile, Snapshot } from './types';
export const presets: Record<Gender, { honorific: string; message: string }> = {
  common: { honorific: '오늘의 주인공', message: '오늘 하루는 당신 마음대로.' },
  male: { honorific: '생일왕', message: '생일왕의 등장을 허가합니다.' },
  female: { honorific: '생일여왕', message: '생일여왕의 등장을 허가합니다.' },
};
export const emptyProfile = (): Profile => ({ name: '', month: 1, day: 1, gender: 'common', ...presets.common, theme: 'strawberry', decoration: 'crown', photoId: null, profileRevision: 0 });
export function validateProfile(input: Profile): Profile {
  const p = { ...input, name: input.name.trim(), honorific: input.honorific.trim(), message: input.message.trim() };
  if ([...p.name].length < 1 || [...p.name].length > 20) throw new Error('이름은 1~20자로 입력해 주세요.');
  if ([...p.honorific].length > 20 || [...p.message].length > 80) throw new Error('호칭은 20자, 축하 문구는 80자까지 적어 주세요.');
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!Number.isInteger(p.month) || !Number.isInteger(p.day) || p.month < 1 || p.month > 12 || p.day < 1 || p.day > days[p.month - 1]) throw new Error('생일의 월과 일을 확인해 주세요.');
  if (!['common', 'male', 'female'].includes(p.gender) || !['strawberry', 'mint', 'chocolate'].includes(p.theme) || !['crown', 'ribbon', 'none'].includes(p.decoration)) throw new Error('선택 항목을 확인해 주세요.');
  return p;
}
export function initialSnapshot(): Snapshot {
  const now = Date.now();
  return { roomId: crypto.randomUUID(), roundId: crypto.randomUUID(), revision: 0, controlRevision: 0, phase: 'waiting', paused: false, charge: 0, wind: 0, candleCount: 5, startAt: null, expiresAt: now + 7200000, hostLeaseUntil: now + 7200000, leaseSeq: 0, roleEpoch: 0, hostId: 'local', micId: 'local', audioId: 'local' };
}
export function transition(s: Snapshot, action: Command, now = Date.now()): Snapshot {
  if (s.phase === 'ended' || now >= s.expiresAt) throw new Error('종료된 파티입니다. 새로 시작해 주세요.');
  const next = { ...s, revision: s.revision + 1, controlRevision: s.controlRevision + 1 };
  if (action === 'pause') return { ...next, paused: true };
  if (action === 'resume') return { ...next, paused: false };
  if (s.paused) throw new Error('먼저 파티를 이어 주세요.');
  if (action === 'prepare' && s.phase === 'waiting') return { ...next, phase: 'preparing' };
  if (action === 'ignite' && s.phase === 'preparing') return { ...next, phase: 'lit', charge: 100 };
  if (action === 'blow' && s.phase === 'lit') return { ...next, phase: 'blowing' };
  if (action === 'force' && ['preparing', 'lit', 'blowing'].includes(s.phase)) return { ...next, phase: 'celebrating', wind: 100, startAt: now };
  if (action === 'replay' && s.phase === 'celebrating') return { ...next, phase: 'preparing', roundId: crypto.randomUUID(), charge: 0, wind: 0, startAt: null };
  throw new Error('현재 단계에서 할 수 없는 동작입니다.');
}
export function contribute(s: Snapshot, kind: Contribution, now = Date.now()): Snapshot {
  if (s.paused || s.phase === 'ended' || now >= s.expiresAt) return s;
  if (s.phase === 'preparing' && (kind === 'shake' || kind === 'button')) return { ...s, revision: s.revision + 1, charge: Math.min(100, s.charge + 12) };
  if (s.phase === 'blowing' && (kind === 'blow' || kind === 'button')) {
    const wind = Math.min(100, s.wind + 20);
    return { ...s, revision: s.revision + 1, wind, ...(wind >= 100 ? { phase: 'celebrating' as const, startAt: now + 1800 } : {}) };
  }
  return s;
}
