import { ImageMagick, initializeImageMagick, MagickFormat } from "npm:@imagemagick/magick-wasm@0.0.46";

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "bp-private";
const LIMIT = 5 * 1024 * 1024;
const OUTPUT_LIMIT = 1024 * 1024;
const PIXEL_LIMIT = 20_000_000;
const WASM_URL = "https://cdn.jsdelivr.net/npm/@imagemagick/magick-wasm@0.0.46/dist/x86/magick.wasm";
let wasmReady: Promise<unknown> | null = null;

async function boundedBody(req: Request, limit: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new Error("PAYLOAD_TOO_LARGE"); }
    parts.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

async function rpc(token: string, fn: string, args: object) {
  const response = await fetch(`${PROJECT_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "BACKEND_ERROR");
  return payload;
}

async function serviceRpc(fn: string, args: object) {
  const response = await fetch(`${PROJECT_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`BACKEND_${fn.toUpperCase()}_${String(payload.code ?? response.status).replace(/[^A-Z0-9_]/g,'')}`);
  return payload;
}

async function storage(path: string, init: RequestInit) {
  return await fetch(`${PROJECT_URL}/storage/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, ...(init.headers || {}) },
  });
}

async function authenticatedUser(token: string) {
  const response = await fetch(`${PROJECT_URL}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("AUTH_REQUIRED");
  return await response.json();
}

function imageDimensions(bytes: Uint8Array, mime: string): [number, number] {
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  const u32be = (i: number) => ((bytes[i] * 0x1000000) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]) >>> 0;
  if (mime === "image/png" && bytes.length >= 24) return [u32be(16), u32be(20)];
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 4 < bytes.length) {
      if (bytes[i++] !== 0xff) continue;
      let marker = bytes[i++];
      while (marker === 0xff) marker = bytes[i++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > bytes.length) break;
      const size = u16(i);
      if (size < 2 || i + size > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && size >= 7) return [u16(i + 5), u16(i + 3)];
      i += size;
    }
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === "VP8X") return [u24le(24) + 1, u24le(27) + 1];
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return [((bytes[26] | bytes[27] << 8) & 0x3fff), ((bytes[28] | bytes[29] << 8) & 0x3fff)];
    if (kind === "VP8L" && bytes[20] === 0x2f) return [1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6))];
  }
  throw new Error("UNSUPPORTED_IMAGE");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ code: "METHOD_NOT_ALLOWED" }, 405);
  try {
    if (!PROJECT_URL || !ANON || !SERVICE) throw new Error("SERVER_CONFIG_MISSING");
    if (new URL(req.url).searchParams.get('maintenance') === '1') {
      if (!(await serviceRpc('bp_maintenance_claim', {}))) return reply({status:'recently-checked'});
      await serviceRpc('bp_prune_expired', {});
      const paths = await serviceRpc('bp_cleanup_claim', {p_limit:20});
      let removed=0;
      for (const objectPath of paths) {
        const response=await storage(`object/${BUCKET}/${objectPath}`, {method:'DELETE'});
        if (response.ok || response.status===404) { await serviceRpc('bp_cleanup_ack',{p_object_path:objectPath}); removed++; }
      }
      return reply({status:'checked',removed});
    }
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.get("authorization") || "");
    if (!match) throw new Error("AUTH_REQUIRED");
    const token = match[1];
    const user = await authenticatedUser(token);
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > LIMIT + 16 * 1024) throw new Error("PAYLOAD_TOO_LARGE");

    let body: Record<string, unknown>;
    let file: File | null = null;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.toLowerCase().startsWith("multipart/form-data")) {
      const bytes = await boundedBody(req, LIMIT + 16 * 1024);
      const form = await new Request(req.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
      body = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string")) as Record<string, unknown>;
      const candidate = form.get("file");
      if (candidate instanceof File) file = candidate;
      if (file && file.size > LIMIT) throw new Error("PAYLOAD_TOO_LARGE");
      if (body.action !== "upload") throw new Error("INVALID_REQUEST");
    } else {
      body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 16384)));
    }

    const action = body.action;
    const roomId = body.roomId;
    if (typeof roomId !== "string" || !/^[0-9a-f-]{36}$/i.test(roomId)) throw new Error("INVALID_REQUEST");
    if (action === "delete") {
      const expectedRevision = Number(body.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("INVALID_REQUEST");
      const result = await rpc(token, "bp_photo_delete", { p_room_id: roomId, p_expected_revision: expectedRevision });
      return reply({ profile: result.profile });
    }
    if (action === "read") {
      const read = await rpc(token, "bp_photo_read", { p_room_id: roomId });
      const snapshot = await rpc(token, "bp_snapshot", { p_room_id: roomId });
      const expiresAt = Date.parse(snapshot.snapshot?.expiresAt);
      const serverNow = Date.parse(snapshot.snapshot?.serverNow);
      const remaining = Math.floor((expiresAt - serverNow) / 1000);
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("ROOM_EXPIRED");
      const ttl = Math.min(60, remaining);
      const signed = await storage(`object/sign/${BUCKET}/${read.objectPath}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresIn: ttl }) });
      const signedBody = await signed.json().catch(() => ({}));
      if (!signed.ok || typeof signedBody.signedURL !== "string") throw new Error("PHOTO_READ_FAILED");
      const url = signedBody.signedURL.startsWith("http") ? signedBody.signedURL : `${PROJECT_URL}/storage/v1${signedBody.signedURL}`;
      // Recheck after URL creation to close the room end/expiry race as far as the API allows.
      const [latestRead, latestSnapshot] = await Promise.all([
        rpc(token, "bp_photo_read", { p_room_id: roomId }),
        rpc(token, "bp_snapshot", { p_room_id: roomId }),
      ]);
      if (latestRead.objectPath !== read.objectPath || Date.parse(latestSnapshot.snapshot?.expiresAt) <= Date.parse(latestSnapshot.snapshot?.serverNow)) throw new Error("ROOM_EXPIRED");
      return reply({ profile: latestRead.profile, url });
    }
    if (action !== "upload" || !file) throw new Error("INVALID_REQUEST");
    const expectedRevision = Number(body.expectedRevision);
    const operationId = crypto.randomUUID();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("INVALID_REQUEST");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("UNSUPPORTED_IMAGE");
    const input = new Uint8Array(await file.arrayBuffer());
    if (input.length > LIMIT || input.length === 0) throw new Error("PAYLOAD_TOO_LARGE");
    const head = input.subarray(0, 12);
    const validMagic = (file.type === "image/jpeg" && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
      || (file.type === "image/png" && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
      || (file.type === "image/webp" && String.fromCharCode(...head.subarray(0, 4)) === "RIFF" && String.fromCharCode(...head.subarray(8, 12)) === "WEBP");
    if (!validMagic) throw new Error("UNSUPPORTED_IMAGE");
    const [width, height] = imageDimensions(input, file.type);
    if (!width || !height || width * height > PIXEL_LIMIT) throw new Error("IMAGE_DIMENSIONS");

    wasmReady ??= initializeImageMagick(new URL(WASM_URL));
    await wasmReady;
    let output: Uint8Array | undefined;
    await ImageMagick.read(input, async (image) => {
      if (image.width !== width || image.height !== height) throw new Error("IMAGE_HEADER_MISMATCH");
      image.autoOrient();
      const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
      if (scale < 1) image.resize(Math.max(1, Math.floor(image.width * scale)), Math.max(1, Math.floor(image.height * scale)));
      image.strip();
      await image.write(MagickFormat.WebP, async (encoded) => { output = new Uint8Array(encoded); });
    });
    if (!output?.length || output.length > OUTPUT_LIMIT) throw new Error("UNSUPPORTED_IMAGE");

    const begun = await rpc(token, "bp_photo_begin", { p_room_id: roomId, p_operation_id: operationId, p_expected_revision: expectedRevision });
    try {
      const put = await storage(`object/${BUCKET}/${begun.objectPath}`, { method: "POST", headers: { "content-type": "image/webp", "x-upsert": "false" }, body: output });
      if (!put.ok) throw new Error("PHOTO_STORE_FAILED");
      const committed = await serviceRpc("bp_photo_commit", { p_room_id: roomId, p_photo_id: begun.photoId, p_operation_id: operationId, p_expected_revision: expectedRevision, p_actor_id: user.id });
      return reply({ profile: committed.profile });
    } catch (error) {
      // A lost commit response can follow success; the queue protects referenced objects.
      await serviceRpc("bp_cleanup_enqueue", { p_object_path: begun.objectPath }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "REQUEST_FAILED";
    const code = /^[A-Z0-9_]+$/.test(message) ? message : "REQUEST_FAILED";
    const status = code === "AUTH_REQUIRED" ? 401 : code === "UNSUPPORTED_IMAGE" ? 415 : code === "PAYLOAD_TOO_LARGE" ? 413 : code === "INVALID_REQUEST" ? 400 : 409;
    return reply({ code }, status);
  }
});
