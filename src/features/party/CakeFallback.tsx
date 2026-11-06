import type { Decoration, Theme } from '../../domain/types';

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
  longCandles?: number;
  shortCandles?: number;
};

const colors: Record<Theme, { icing: string; cake: string; berry: string }> = {
  strawberry: { icing: '#FFF9F0', cake: '#E95B55', berry: '#B92F43' },
  mint: { icing: '#F8F4E9', cake: '#76A994', berry: '#D64D4D' },
  chocolate: { icing: '#FFF5E6', cake: '#85533F', berry: '#D9474B' },
};

export default function CakeFallback({ name, photoUrl, theme, decoration, phase, candleCount, wind, startAt, reducedMotion }: CakeProps) {
  const palette = colors[theme];
  const stubborn = phase === 'celebrating' && startAt !== null && Date.now() < startAt;
  const lit = phase === 'lit' || phase === 'blowing' || stubborn;
  const extinguished = (phase === 'celebrating' && !stubborn) || phase === 'ended';
  const candles = Array.from({ length: 5 }, (_, index) => {
    const x = 105 + index * 43;
    const isLit = stubborn ? index === 4 : lit && index < candleCount;
    return <g key={index}>
      <path d={`M${x} 167V119`} stroke="#F5D451" strokeWidth="9" strokeLinecap="round" />
      <path d={`M${x} 164V121`} stroke="#FFF0A2" strokeWidth="2" strokeLinecap="round" />
      {isLit && <g className={reducedMotion ? undefined : 'candle-flame'}>
        <path d={`M${x} 115 C${x - 13} 103 ${x - 5} 91 ${x} 84 C${x + 6} 95 ${x + 12} 104 ${x} 115Z`} fill="#FFD34F" />
        <path d={`M${x} 112 C${x - 5} 106 ${x - 2} 101 ${x} 97 C${x + 4} 103 ${x + 5} 108 ${x} 112Z`} fill="#FFF4C0" />
      </g>}
      {(extinguished && (!stubborn || index !== 4)) && <path d={`M${x} 115c-9-11 9-15 1-25 14 10 8 18 1 25`} fill="none" stroke="#7B7067" strokeWidth="3" strokeLinecap="round" className={reducedMotion ? undefined : 'smoke-wisp'} />}
    </g>;
  });

  return <svg className={`cake-art ${reducedMotion ? '' : phase === 'preparing' ? 'cake-wobble' : ''}`} viewBox="0 0 420 330" role="img" aria-label={`${name || '오늘의 주인공'}을 위한 케이크, 촛불 ${candleCount}개`}>
    <ellipse cx="210" cy="289" rx="171" ry="20" fill="#7D41351A" />
    {decoration === 'crown' && <path d="M174 53l-6-27 26 17 16-28 16 28 27-17-7 27Z" fill="#F1C83E" stroke="#593C2F" strokeWidth="4" strokeLinejoin="round" />}
    {decoration === 'ribbon' && <g fill="#DB4C55" stroke="#593C2F" strokeWidth="3"><path d="M174 43c-30-24-49 9-5 19l15-8Z"/><path d="M246 43c30-24 49 9 5 19l-15-8Z"/><circle cx="210" cy="49" r="9"/></g>}
    {photoUrl ? <g><defs><clipPath id="cake-photo-clip"><circle cx="210" cy="80" r="33" /></clipPath></defs><path d="M210 115v35" stroke="#6E4936" strokeWidth="4"/><circle cx="210" cy="80" r="36" fill="#FFF9F0" stroke="#6E4936" strokeWidth="4"/><image href={photoUrl} x="177" y="47" width="66" height="66" preserveAspectRatio="xMidYMid slice" clipPath="url(#cake-photo-clip)"/></g> : <g><path d="M210 73v70" stroke="#6E4936" strokeWidth="4"/><rect x="153" y="64" width="114" height="42" rx="7" fill="#FFF9F0" stroke="#6E4936" strokeWidth="4"/><text x="210" y="91" textAnchor="middle" fontSize="15" fontWeight="700" fill="#34251F">{name ? [...name].slice(0, 8).join('') : '생일자'}</text></g>}
    <g stroke="#5B3C31" strokeWidth="3" strokeLinejoin="round">
      <path d="M57 183q0-20 21-20h264q21 0 21 20v67q0 19-22 19H79q-22 0-22-19Z" fill={palette.cake}/>
      <path d="M57 189q16-11 32 1t32 0 32 0 32 0 32 0 32 0 32 0 32 0 32 0 31 0v-18q0-9-13-9H78q-21 0-21 16Z" fill={palette.icing}/>
      <path d="M65 190q17 0 17 13v14q0 10 13 10t13-12v-11q0-12 14-12t14 13v16q0 11 13 11t13-12v-17q0-11 14-11t14 13v15q0 12 14 12t14-12v-16q0-12 14-12t14 13v14q0 12 14 12t14-13v-15q0-11 14-11t14 13v14q0 12 14 12t14-14v-13q0-13 17-13" fill="none" stroke={palette.icing} strokeWidth="13" strokeLinecap="round"/>
      <path d="M57 251q0-18 22-18h262q22 0 22 18v30H57Z" fill={palette.icing}/>
      <path d="M57 262q17-10 34 0t34 0 34 0 34 0 34 0 34 0 34 0 34 0 33 0v20H57Z" fill={palette.cake} stroke="none"/>
      <path d="M72 282h276q-12 20-30 20H101q-18 0-29-20Z" fill={palette.icing}/>
      {candles}
      <g fill="#34251F" stroke="none"><ellipse cx="171" cy="208" rx="5" ry="7"/><ellipse cx="249" cy="208" rx="5" ry="7"/></g>
      <path d="M192 229q18-13 36 0" fill="none" stroke="#34251F" strokeWidth="4" strokeLinecap="round"/>
      <g fill={palette.berry} stroke="none"><circle cx="111" cy="184" r="6"/><circle cx="144" cy="181" r="5"/><circle cx="282" cy="182" r="6"/><circle cx="315" cy="184" r="5"/><path d="M195 180l4 8-4 8 8-4 8 4-4-8 4-8-8 4Z" fill="#F2C94C"/><path d="M231 180l4 8-4 8 8-4 8 4-4-8 4-8-8 4Z" fill="#F2C94C"/></g>
      {stubborn && <text x="210" y="145" textAnchor="middle" stroke="none" fill="#34251F" fontSize="12" fontWeight="700">저는 쉽게 꺼지는 사람이 아닙니다</text>}
      {wind > 0 && <path d="M75 149q25-15 45 0m-37 9q14-9 27 0" fill="none" stroke="#8E7569" strokeWidth="3" strokeLinecap="round" opacity={Math.min(0.8, wind / 100)} />}
    </g>
  </svg>;
}
