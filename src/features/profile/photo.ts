export type PhotoOptions = {
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const OUTPUT_SIZE = 1024;
const objectUrls = new Set<string>();

function readU24(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
    : ((bytes[offset] ?? 0) << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 30 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  );
}

function readDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (isPng(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (isJpeg(bytes)) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1] ?? 0;
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0),
          width: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        };
      }
      offset += segmentLength;
    }
    return null;
  }
  if (isWebp(bytes)) {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === 'VP8X') {
      return {
        width: readU24(bytes, 24, true) + 1,
        height: readU24(bytes, 27, true) + 1,
      };
    }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: (((bytes[27] ?? 0) << 8) | (bytes[26] ?? 0)) & 0x3fff,
        height: (((bytes[29] ?? 0) << 8) | (bytes[28] ?? 0)) & 0x3fff,
      };
    }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const b1 = bytes[21] ?? 0;
      const b2 = bytes[22] ?? 0;
      const b3 = bytes[23] ?? 0;
      const b4 = bytes[24] ?? 0;
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      };
    }
  }
  return null;
}

function validateOptions(options: PhotoOptions): Required<PhotoOptions> {
  const zoom = options.zoom ?? 1;
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;
  if (!Number.isFinite(zoom) || zoom < 1 || zoom > 3) throw new Error('확대 값은 1에서 3 사이로 설정해 주세요.');
  if (!Number.isFinite(offsetX) || offsetX < -1 || offsetX > 1) throw new Error('사진의 가로 위치 값이 범위를 벗어났습니다.');
  if (!Number.isFinite(offsetY) || offsetY < -1 || offsetY > 1) throw new Error('사진의 세로 위치 값이 범위를 벗어났습니다.');
  return { zoom, offsetX, offsetY };
}

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('사진을 저장할 수 없습니다. 다른 사진을 선택해 주세요.')), 'image/jpeg', quality);
  });
}

export async function preparePhoto(file: File, options: PhotoOptions = {}): Promise<{ blob: Blob; url: string }> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('사진은 5MB 이하 파일만 사용할 수 있습니다.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('JPEG, PNG, WebP 사진을 선택해 주세요.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validMagic = file.type === 'image/jpeg' ? isJpeg(bytes) : file.type === 'image/png' ? isPng(bytes) : isWebp(bytes);
  if (!validMagic) throw new Error('파일 형식과 사진 내용이 일치하지 않습니다. 다른 사진을 선택해 주세요.');
  const dimensions = readDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new Error('사진 크기를 읽을 수 없거나 너무 큽니다. 다른 사진을 선택해 주세요.');
  }
  const crop = validateOptions(options);
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('이 브라우저에서는 사진 처리를 지원하지 않습니다.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes).buffer], { type: file.type }), { imageOrientation: 'from-image' });
  } catch {
    throw new Error('사진을 열 수 없습니다. 손상되지 않은 JPEG, PNG, WebP 파일을 선택해 주세요.');
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const zoomedSide = side / crop.zoom;
    const maxOffsetX = Math.max(0, (bitmap.width - zoomedSide) / 2);
    const maxOffsetY = Math.max(0, (bitmap.height - zoomedSide) / 2);
    const sx = Math.max(0, Math.min(bitmap.width - zoomedSide, (bitmap.width - zoomedSide) / 2 + crop.offsetX * maxOffsetX));
    const sy = Math.max(0, Math.min(bitmap.height - zoomedSide, (bitmap.height - zoomedSide) / 2 + crop.offsetY * maxOffsetY));
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('이 브라우저에서는 사진 자르기를 지원하지 않습니다.');
    drawing.drawImage(bitmap, sx, sy, zoomedSide, zoomedSide, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const qualities = [0.9, 0.78, 0.64, 0.5, 0.38];
    let output: Blob | null = null;
    for (const quality of qualities) {
      output = await encode(canvas, quality);
      if (output.size <= MAX_OUTPUT_BYTES) break;
    }
    if (!output || output.size > MAX_OUTPUT_BYTES) throw new Error('편집한 사진이 1MB보다 큽니다. 확대를 줄이거나 다른 사진을 선택해 주세요.');
    const url = URL.createObjectURL(output);
    objectUrls.add(url);
    return { blob: output, url };
  } finally {
    bitmap.close();
  }
}

export function releasePhoto(url: string): void {
  if (!objectUrls.delete(url)) return;
  URL.revokeObjectURL(url);
}
