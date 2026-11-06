import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/202611060001_birthday_party_backend.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/photo/index.ts', import.meta.url), 'utf8');

test('room RPC and snapshot contract is present', () => {
  for (const signature of [
    'bp_create_room(p_profile jsonb)', 'bp_join_room(p_token text,p_role text default',
    'bp_snapshot(p_room_id uuid)', 'bp_command(p_room_id uuid,p_action text,p_request_id uuid,p_round_id uuid,p_control_revision bigint)',
    'bp_contribute(p_room_id uuid,p_kind text,p_request_id uuid,p_round_id uuid,p_control_revision bigint)',
    'bp_update_profile(p_room_id uuid,p_profile jsonb,p_expected_revision bigint)', 'bp_heartbeat(p_room_id uuid)',
    'bp_set_roles(p_room_id uuid,p_mic_id uuid,p_audio_id uuid)', 'bp_role_ack(p_room_id uuid,p_member_id uuid,p_role text,p_kind text,p_round_id uuid,p_control_revision bigint,p_role_epoch bigint)',
    'bp_request_audio_stop(p_room_id uuid,p_round_id uuid,p_control_revision bigint,p_role_epoch bigint)', 'bp_end_room(p_room_id uuid)',
  ]) assert.ok(sql.includes(signature), `missing ${signature}`);
  for (const field of ["'members'", "'memberId'", "'audioLeaseUntil'", "'serverNow'", "'hostLeaseUntil'", "'controlRevision'", "'roleEpoch'"]) assert.ok(sql.includes(field), `missing snapshot field ${field}`);
  assert.match(sql, /create policy bp_room_broadcast_member_read on realtime\.messages for select/);
  assert.doesNotMatch(sql, /alter table realtime\.messages enable row level security/i);
});

test('photo API uses user verification, server-only commit, and bounded image handling', () => {
  assert.match(edge, /body\.action !== "upload"/);
  assert.match(edge, /action === "delete"/);
  assert.match(edge, /action === "read"/);
  assert.match(edge, /authenticatedUser\(token\)/);
  assert.match(edge, /serviceRpc\("bp_photo_commit"/);
  assert.match(edge, /p_actor_id: user\.id/);
  assert.match(sql, /revoke all on function public\.bp_photo_commit\([^;]+ from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.bp_photo_commit\([^;]+ to service_role/);
  assert.ok(edge.indexOf('imageDimensions(input, file.type)') < edge.indexOf('initializeImageMagick('), 'pixel dimensions must be checked before WASM decode');
  assert.match(edge, /magick-wasm@0\.0\.46/);
  assert.match(edge, /bp_cleanup_enqueue/);
  assert.match(edge, /expiresIn: ttl/);
});
