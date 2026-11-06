import * as THREE from 'three';
import type { Decoration, Theme } from '../../domain/types';

export type CakeSceneProps = {
  name: string;
  photoUrl: string | null;
  theme: Theme;
  decoration: Decoration;
  phase: string;
  candleCount: number;
  wind: number;
  startAt: number | null;
  reducedMotion: boolean;
  jolt?: boolean | number;
  longCandles?: number;
  shortCandles?: number;
};

const palette: Record<Theme, { cake: string; glaze: string; berry: string }> = {
  strawberry: { cake: '#e8b9a8', glaze: '#fff8ef', berry: '#963b35' },
  mint: { cake: '#b5c6b2', glaze: '#fff9ed', berry: '#963b35' },
  chocolate: { cake: '#593a30', glaze: '#e8d8c3', berry: '#a9473d' },
};

const mat = (color: string, roughness = 0.48, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function roundedCylinder(radius: number, height: number, color: string, roughness = 0.5) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.985, height, 96, 1, false), mat(color, roughness));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTopperTexture(text: string, photoUrl: string | null, done: (texture: THREE.CanvasTexture) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const draw = (image?: HTMLImageElement) => {
    ctx.clearRect(0, 0, 512, 512);
    ctx.save();
    ctx.beginPath(); ctx.arc(256, 256, 247, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#f6eee1'; ctx.fillRect(0, 0, 512, 512);
    if (image) {
      const scale = Math.max(512 / image.width, 512 / image.height);
      const w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, (512 - w) / 2, (512 - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#29211e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '500 58px Georgia, serif';
      ctx.fillText([...text].slice(0, 14).join('') || '생일 축하해요', 256, 260, 438);
    }
    ctx.restore();
    ctx.strokeStyle = '#c6a66b'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(256, 256, 247, 0, Math.PI * 2); ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    done(texture);
  };
  if (!photoUrl) { draw(); return null; }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => draw(image);
  image.onerror = () => draw();
  image.src = photoUrl;
  return null;
}

export function mountCakeScene(canvas: HTMLCanvasElement, props: CakeSceneProps, onFallback: () => void) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch {
    onFallback();
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(canvas.clientWidth || 480, canvas.clientHeight || 360, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
  camera.position.set(3.2, 5.7, 7.8);
  camera.lookAt(0, 2.65, 0);
  scene.add(new THREE.HemisphereLight('#fff1d9', '#211714', 0.48));
  const key = new THREE.SpotLight('#fff1df', 220, 18, Math.PI / 5, 0.7, 1.5);
  key.position.set(-3.7, 7.2, 4.2); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.00015; scene.add(key);
  const rim = new THREE.DirectionalLight('#d8b984', 0.72); rim.position.set(3, 4, -4); scene.add(rim);
  const fill = new THREE.PointLight('#ffddb0', 5, 6, 2); fill.position.set(0, 2, 2.7); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#000000', opacity: 0.48 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.1; floor.receiveShadow = true; scene.add(floor);
  const cake = new THREE.Group(); scene.add(cake);
  const colors = palette[props.theme];

  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.82, 0.1, 128), mat('#b99b63', 0.22, 0.78));
  plate.position.y = 0.14; plate.castShadow = true; plate.receiveShadow = true; cake.add(plate);
  const plateEdge = new THREE.Mesh(new THREE.TorusGeometry(1.81, 0.035, 12, 128), mat('#e2c788', 0.2, 0.78));
  plateEdge.rotation.x = Math.PI / 2; plateEdge.position.y = 0.2; cake.add(plateEdge);
  const lower = roundedCylinder(1.55, 0.82, colors.cake, 0.62); lower.position.y = 0.62; cake.add(lower);
  const lowerTop = roundedCylinder(1.565, 0.14, colors.glaze, 0.27); lowerTop.position.y = 1.04; cake.add(lowerTop);
  const upper = roundedCylinder(1.1, 0.69, colors.cake, 0.6); upper.position.y = 1.43; cake.add(upper);
  const upperTop = roundedCylinder(1.115, 0.14, colors.glaze, 0.24); upperTop.position.y = 1.79; cake.add(upperTop);
  const dripMaterial = mat(colors.glaze, 0.42);
  const drips = new THREE.Group();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const length = 0.09 + (0.5 + 0.5 * Math.sin(i * 2.17)) * 0.13;
    const radius = 1.55;
    const drop = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), dripMaterial);
    drop.scale.set(0.095 + 0.018 * Math.sin(i * 3.1), length, 0.095 + 0.018 * Math.sin(i * 3.1));
    drop.position.set(Math.cos(a) * radius, 1.02 - length * 0.42, Math.sin(a) * radius);
    drop.castShadow = true; drips.add(drop);
  }
  cake.add(drips);
  const crownDrips = new THREE.Group();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const length = 0.08 + (0.5 + 0.5 * Math.sin(i * 2.6 + 1)) * 0.11;
    const drop = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), dripMaterial);
    drop.scale.set(0.075 + 0.012 * Math.sin(i * 2.2), length, 0.075 + 0.012 * Math.sin(i * 2.2));
    drop.position.set(Math.cos(a) * 1.105, 1.77 - length * 0.42, Math.sin(a) * 1.105);
    crownDrips.add(drop);
  }
  cake.add(crownDrips);

  const cream = mat('#fff8ed', 0.34);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const dollop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), cream);
    dollop.scale.set(1, 0.7, 1);
    dollop.position.set(Math.cos(a) * 1.35, 1.12, Math.sin(a) * 1.35);
    cake.add(dollop);
  }

  const berryMat = mat(colors.berry, 0.28);
  const seedMat = mat('#e8d4a2', 0.4);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 20), berryMat);
    berry.scale.set(0.76, 1.25, 0.76); berry.position.set(Math.cos(a) * 0.72, 1.94, Math.sin(a) * 0.72); cake.add(berry);
    for (let j = 0; j < 5; j++) {
      const sa = j * 1.26;
      const seed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), seedMat);
      seed.position.set(berry.position.x + Math.cos(sa) * 0.075, 1.95 + Math.sin(sa) * 0.09, berry.position.z + Math.sin(sa) * 0.075);
      cake.add(seed);
    }
  }

  const topper = new THREE.Group(); cake.add(topper);
  let disposed = false;
  const topperStick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 12), mat('#c5a768', 0.3, 0.6));
  topperStick.position.set(0, 2.08, 0); topper.add(topperStick);
  const topperMaterial = new THREE.MeshStandardMaterial({ color: '#fff8ec', roughness: 0.34, metalness: 0.08, side: THREE.DoubleSide });
  const disk = new THREE.Mesh(new THREE.CircleGeometry(props.photoUrl ? 0.34 : 0.31, 64), topperMaterial);
  disk.position.set(0, 2.34, 0); topper.add(disk);
  const border = new THREE.Mesh(new THREE.TorusGeometry(props.photoUrl ? 0.34 : 0.31, 0.018, 10, 64), mat('#c5a768', 0.28, 0.62));
  border.position.set(0, 2.34, 0); topper.add(border);
  if (!props.photoUrl && props.decoration !== 'none') {
    const accent = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.024, 10, 32), mat(props.decoration === 'crown' ? '#cfad62' : '#9a5c55', 0.3, 0.35));
    accent.position.set(0, 2.34, 0.01); topper.add(accent);
  }
  let topperTexture: THREE.CanvasTexture | null = null;
  makeTopperTexture(props.name, props.photoUrl, (texture) => {
    topperTexture?.dispose(); topperTexture = texture;
    if (!disposed) { topperMaterial.map = texture; topperMaterial.needsUpdate = true; }
    else texture.dispose();
  });

  const candleGroup = new THREE.Group(); cake.add(candleGroup);
  const lit = props.phase === 'lit' || props.phase === 'blowing' || (props.phase === 'celebrating' && props.startAt !== null && Date.now() < props.startAt);
  const wax = mat('#f4ead6', 0.34);
  const gold = mat('#c8a95f', 0.3, 0.45);
  const clampCount = (n: number | undefined, fallback: number) => Math.max(0, Math.min(21, Math.floor(n ?? fallback)));
  const longCount = clampCount(props.longCandles, 0);
  const shortCount = clampCount(props.shortCandles, 5);
  const total = Math.min(21, longCount + shortCount);
  const longTotal = Math.min(longCount, total);
  const shortTotal = total - longTotal;
  const flames: { mesh: THREE.Mesh; geometry: THREE.PlaneGeometry; light: THREE.PointLight; seed: number; base: Float32Array }[] = [];
  const flameCanvas = document.createElement('canvas');
  flameCanvas.width = 64; flameCanvas.height = 128;
  const flameCtx = flameCanvas.getContext('2d');
  let flameTexture: THREE.CanvasTexture | null = null;
  if (flameCtx) {
    const gradient = flameCtx.createRadialGradient(32, 82, 2, 32, 68, 54);
    gradient.addColorStop(0, 'rgba(255,255,235,1)'); gradient.addColorStop(0.12, 'rgba(255,237,178,1)');
    gradient.addColorStop(0.42, 'rgba(255,164,66,.94)'); gradient.addColorStop(0.72, 'rgba(255,105,35,.52)'); gradient.addColorStop(1, 'rgba(255,90,24,0)');
    flameCtx.fillStyle = gradient; flameCtx.beginPath(); flameCtx.moveTo(32, 3);
    flameCtx.bezierCurveTo(56, 35, 52, 68, 39, 111); flameCtx.quadraticCurveTo(31, 130, 22, 108);
    flameCtx.bezierCurveTo(10, 77, 16, 35, 32, 3); flameCtx.fill();
    flameTexture = new THREE.CanvasTexture(flameCanvas); flameTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const candleDefs = [
    ...Array.from({ length: longTotal }, (_, i) => ({ long: true, i, rowCount: longTotal })),
    ...Array.from({ length: shortTotal }, (_, i) => ({ long: false, i, rowCount: shortTotal })),
  ];
  for (const def of candleDefs) {
    const height = def.long ? 1.8 : 0.95;
    const spacing = Math.min(0.27, 2.1 / Math.max(1, def.rowCount - 1));
    const x = (def.i - (def.rowCount - 1) / 2) * spacing;
    const z = def.long ? -0.28 : 0.36;
    const baseY = 1.86;
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.043, height, 24), wax);
    candle.position.set(x, baseY + height / 2, z); candle.castShadow = true; candleGroup.add(candle);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.006, 8, 24), gold);
    band.rotation.x = Math.PI / 2; band.position.set(x, baseY + 0.1, z); candleGroup.add(band);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.055, 8), mat('#28221d'));
    const tipY = baseY + height;
    wick.position.set(x, tipY + 0.025, z); candleGroup.add(wick);
    if (!lit) continue;
    const geometry = new THREE.PlaneGeometry(0.27, 0.5, 5, 10);
    const positions = geometry.attributes.position.array as Float32Array;
    const base = positions.slice();
    const flame = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: flameTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    flame.position.set(x, tipY + 0.25, z + 0.025); candleGroup.add(flame);
    const light = new THREE.PointLight('#ffba69', 1.5, 2.8, 2); light.position.set(x, tipY + 0.14, z); candleGroup.add(light);
    flames.push({ mesh: flame, geometry, light, seed: def.i * 2.31 + (def.long ? 0 : 1.2), base });
  }

  let frame = 0;
  const clock = new THREE.Clock();
  const resize = new ResizeObserver(() => {
    if (disposed) return;
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
  });
  resize.observe(canvas);
  const lost = (event: Event) => { event.preventDefault(); onFallback(); };
  canvas.addEventListener('webglcontextlost', lost);
  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    if (!props.reducedMotion) {
      const preparing = props.phase === 'preparing';
      const shake = props.jolt ? Math.sin(t * 34) * Math.exp(-t * 5) * 0.045 : 0;
      cake.rotation.z = (preparing ? Math.sin(t * 2.4) * 0.012 : 0) + shake;
      cake.position.y = (preparing ? Math.sin(t * 2.4) * 0.012 : 0) + Math.abs(shake) * 0.12;
      for (const flame of flames) {
        const positions = flame.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < positions.length; i += 3) {
          const y = flame.base[i + 1] + 0.25;
          const bend = Math.max(0, y + 0.25) * (Math.sin(t * 5.7 + flame.seed) * 0.035 + Math.sin(t * 9.1 + flame.seed * 1.7) * 0.014);
          positions[i] = flame.base[i] + bend;
        }
        flame.geometry.attributes.position.needsUpdate = true;
        flame.geometry.computeVertexNormals();
        flame.light.intensity = 1.25 + 0.3 * Math.sin(t * 8.3 + flame.seed) + 0.12 * Math.sin(t * 13.7 + flame.seed * 1.4);
      }
      fill.intensity = 4 + flames.length * 0.7 + Math.sin(t * 9) * (flames.length ? 0.55 : 0);
    } else {
      cake.rotation.z = 0; cake.position.y = 0;
    }
    if (props.wind > 0 && lit) for (const flame of flames) flame.mesh.rotation.z = Math.min(0.28, props.wind / 300) * Math.sin(t * 4.2 + flame.seed);
    renderer.render(scene, camera);
  };
  animate();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    canvas.removeEventListener('webglcontextlost', lost);
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if ('map' in material && material.map) material.map.dispose();
          material.dispose();
        }
      }
    });
    topperTexture?.dispose();
    renderer.dispose();
    flameTexture?.dispose();
  };
}
