# Supabase backend setup

## Database and Auth

Run `supabase/migrations/202611060001_birthday_party_backend.sql` in the project's SQL Editor. The migration relies on Supabase `auth`, `storage`, and `realtime` schemas. Enable Anonymous Sign-Ins in Auth settings. The migration creates the private `bp-private` bucket and denies client access to its objects. The `realtime.messages` membership policy is included; the Supabase managed table is already RLS-enabled, so the migration must not alter that table's RLS setting.

Room timestamps in JSON are ISO 8601 strings. Snapshots include `members: [{id, role}]`, and create/join/snapshot responses include top-level `memberId` and `isHost`. `hostId` is the Auth user ID; `micId` and `audioId` are member IDs.

Host command names are `start`, `light`, `blow`, `pause`, `resume`, `recover`, `force_extinguish`, `force_preparing`, and `celebrate_again`; ending uses `bp_end_room`. `bp_role_ack` takes room ID, member ID, role (`mic` or `audio`), status (`ready` or `stopped`), round ID, control revision, and role epoch. An audio device should send `ready` about every 20 seconds; its lease lasts 30 seconds. Before entering the blow phase, the host calls `bp_request_audio_stop`; only the assigned audio device can acknowledge `stopped`. Mic contribution stays blocked while an assigned sound device has not confirmed stop. A removed sound role still blocks mic use until its last lease expires plus a two second margin.

Host heartbeat extends a live six second lease. An expired heartbeat pauses the room and returns `{error: "HOST_LEASE_EXPIRED", snapshot}`. Recovery is an explicit `bp_command` action `recover`; heartbeat does not silently recover the host. Profile updates pass `p_expected_revision`.

## Photo Edge Function

Deploy `supabase/functions/photo/index.ts` as the `photo` Edge Function. It verifies the caller with Auth `/user`; keep `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as Edge Function environment secrets. Never put the service role key in the browser. The browser calls `/functions/v1/photo`:

- Upload: multipart fields `action=upload`, `roomId`, `expectedRevision`, and `file`.
- Delete: JSON `{ "action": "delete", "roomId": "…", "expectedRevision": 1 }`.
- Read: JSON `{ "action": "read", "roomId": "…" }`.

Successful upload/delete responses contain `profile`; read contains `profile` and a signed `url`. The URL expires within 60 seconds and never outlives the room's remaining TTL. Upload validates JPEG/PNG/WebP headers and dimensions before WASM decode, strips metadata, resizes, re-encodes to WebP, then uses a service-only CAS commit bound to the verified Auth user. The WASM file is fetched from the version-pinned jsDelivr URL in the function source; the CDN must be reachable by Edge Functions. Browser or project runtime behavior for this exact package/WASM version still needs deployment verification.

## Cleanup status

The database has service-role-only cleanup queue RPCs, but this work does not install a scheduler or deploy a maintenance worker. An external scheduled caller or a follow-up Edge Function must run `bp_prune_expired`, claim paths with `bp_cleanup_claim`, remove those objects from `bp-private`, then call `bp_cleanup_ack`. Failed deletions remain queued for retry. Do not report object cleanup as operational until that worker/schedule is installed and verified.

## Verification status

`tests/backend-contract.test.mjs` checks the source-level API and security wiring. Parent-owned live Supabase verification covers Auth, REST/RPC, Realtime and Storage with test accounts. UI deployment, photo upload/read/delete on the deployed Edge runtime, cleanup scheduling, and production-device behavior remain separate checks.
