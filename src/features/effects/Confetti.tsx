import { useEffect, useRef } from 'react';

type ConfettiProps = { active: boolean; seed: string; reducedMotion: boolean };
type Piece = { x: number; y: number; vx: number; vy: number; spin: number; angle: number; size: number; color: string; shape: number };
const palette = ['#D9474B', '#F1C83E', '#FFF9F0', '#7EAA92', '#B93C4A'];

function seededRandom(seed: string) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export default function Confetti({ active, seed, reducedMotion }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !active) return;
    let frame = 0;
    const random = seededRandom(seed);
    const pieces: Piece[] = Array.from({ length: reducedMotion ? 32 : 92 }, (_, index) => ({
      x: random() * window.innerWidth, y: reducedMotion ? random() * 220 : -random() * window.innerHeight * 0.9,
      vx: (random() - 0.5) * 2.2, vy: 1.4 + random() * 2.8, spin: (random() - 0.5) * 0.09,
      angle: random() * Math.PI, size: 4 + random() * 7, color: palette[index % palette.length]!, shape: index % 3,
    }));
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * ratio; canvas.height = window.innerHeight * ratio;
      canvas.style.width = `${window.innerWidth}px`; canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const draw = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      pieces.forEach(piece => {
        context.save(); context.translate(piece.x, piece.y); context.rotate(piece.angle); context.fillStyle = piece.color;
        if (piece.shape === 0) context.fillRect(-piece.size / 2, -piece.size / 3, piece.size, piece.size * 0.6);
        else if (piece.shape === 1) { context.beginPath(); context.arc(0, 0, piece.size / 2, 0, Math.PI * 2); context.fill(); }
        else { context.beginPath(); for (let point = 0; point < 10; point += 1) { const radius = point % 2 ? piece.size * 0.22 : piece.size * 0.55; const angle = point * Math.PI / 5 - Math.PI / 2; context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); } context.closePath(); context.fill(); }
        context.restore();
        if (!reducedMotion) { piece.x += piece.vx; piece.y += piece.vy; piece.angle += piece.spin; piece.vy += 0.025; }
      });
      if (!reducedMotion && pieces.some(piece => piece.y < window.innerHeight + 20)) frame = requestAnimationFrame(draw);
    };
    resize(); window.addEventListener('resize', resize); draw();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); context.clearRect(0, 0, canvas.width, canvas.height); };
  }, [active, reducedMotion, seed]);
  return <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />;
}
