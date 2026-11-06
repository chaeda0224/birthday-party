import { useEffect, useRef, useState } from 'react';
import type { Decoration, Theme } from '../../domain/types';
import CakeFallback from './CakeFallback';

type CakeProps = {
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
  tilt?: { x: number; y: number };
};

export default function Cake(props: CakeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tiltRef = useRef(props.tilt);
  tiltRef.current = props.tilt;
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || fallback) return;
    let cancelled = false;
    let dispose = () => {};
    void import('./cake-scene').then(({ mountCakeScene }) => {
      if (cancelled) return;
      dispose = mountCakeScene(canvas, props, () => setFallback(true), () => tiltRef.current);
    });
    return () => { cancelled = true; dispose(); };
  }, [props.name, props.photoUrl, props.theme, props.decoration, props.phase, props.candleCount, props.wind, props.startAt, props.reducedMotion, props.jolt, props.longCandles, props.shortCandles, fallback]);

  if (fallback) return <CakeFallback {...props} />;
  return <canvas
    ref={canvasRef}
    className="cake-3d"
    role="img"
    aria-label={`${props.name || '오늘의 주인공'}을 위한 촛불 케이크, 긴 촛불 ${props.longCandles ?? 0}개, 짧은 촛불 ${props.shortCandles ?? 5}개`}
    data-jolt={props.jolt ?? 0}
  />;
}
