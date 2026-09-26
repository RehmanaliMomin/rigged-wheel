import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Check,
  ChevronDown,
  Copy,
  Heart,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
  Share2,
  Sun,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  question: 'Who is always right?',
  winner: 'Wife',
  loser: 'Husband',
  loserCount: 15,
  winnerCount: 1,
  tiny: true,
};
const MAX_SLICES = 40;
const QUICK_PICKS = [8, 12, 16, 20, 30, 40];
const MAX_QUESTION = 80;
const MAX_NAME = 20;
const TINY_FACTOR = 0.55; // winner slice width relative to an even slice
const COLORS = {
  winner: '#e11d48',
  loserA: '#3b82f6',
  loserB: '#1e40af',
  bulb: '#fcd34d',
};
const R = 188; // slice radius in SVG units (viewBox is 420 wide)
const BULBS = 24;
const FLICK_MIN = 0.3; // deg/ms a drag needs on release to count as a spin
const THEME_KEY = 'rigged-wheel-theme';

const THEMES = {
  light: {
    scheme: 'light',
    background:
      'radial-gradient(circle at 12% 0%, #dbeafe 0, transparent 42%), radial-gradient(circle at 88% 100%, #ffe4e6 0, transparent 45%), #f8fafc',
    rim: '#0f172a',
    text: 'text-slate-800',
    stage: 'bg-white/70 ring-slate-900/5 shadow-xl',
    card: 'bg-white ring-slate-900/5 shadow-lg',
    muted: 'text-slate-500',
    subtle: 'text-slate-400',
    input:
      'border-slate-200 bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:border-rose-400 focus:bg-white focus:ring-rose-100',
    well: 'bg-slate-50 ring-slate-200',
    stepBtn: 'text-slate-500 hover:bg-white hover:text-slate-900',
    seg: 'bg-slate-100',
    segOn: 'bg-white text-slate-900 shadow',
    segOff: 'text-slate-500 hover:text-slate-800',
    iconBtn: 'bg-white text-slate-500 ring-slate-900/5 hover:text-slate-900',
    chip: 'bg-slate-100 text-slate-600',
    winChip: 'bg-rose-50 text-rose-700 ring-rose-200',
    loseChip: 'bg-blue-50 text-blue-700',
    copyBtn: 'bg-slate-900 hover:bg-slate-700',
    shareBtn: 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100',
    switchOff: 'bg-slate-300',
    focusRing: 'focus-visible:ring-rose-200',
    hub: 'bg-white ring-slate-900',
  },
  dark: {
    scheme: 'dark',
    background:
      'radial-gradient(circle at 12% 0%, rgba(59,130,246,.2) 0, transparent 42%), radial-gradient(circle at 88% 100%, rgba(225,29,72,.18) 0, transparent 45%), #0b1120',
    rim: '#020617',
    text: 'text-slate-100',
    stage: 'bg-slate-900/70 ring-white/10 shadow-xl shadow-black/30',
    card: 'bg-slate-900 ring-white/10 shadow-lg shadow-black/20',
    muted: 'text-slate-400',
    subtle: 'text-slate-500',
    input:
      'border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500 focus:border-rose-400 focus:bg-slate-800 focus:ring-rose-500/20',
    well: 'bg-slate-800/60 ring-slate-700',
    stepBtn: 'text-slate-400 hover:bg-slate-700 hover:text-white',
    seg: 'bg-slate-800',
    segOn: 'bg-slate-600 text-white shadow',
    segOff: 'text-slate-400 hover:text-slate-100',
    iconBtn: 'bg-slate-800 text-slate-300 ring-white/10 hover:text-white',
    chip: 'bg-slate-800 text-slate-300',
    winChip: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    loseChip: 'bg-blue-500/15 text-blue-300',
    copyBtn: 'bg-slate-700 hover:bg-slate-600',
    shareBtn: 'bg-rose-500/15 text-rose-300 ring-rose-500/30 hover:bg-rose-500/25',
    switchOff: 'bg-slate-600',
    focusRing: 'focus-visible:ring-rose-500/40',
    hub: 'bg-slate-100 ring-slate-950',
  },
};

const QUIPS = [
  ({ w }) => `The wheel has spoken. ${w} is right. Again.`,
  ({ l, pct }) => `${pct}% of the wheel said ${l}. Didn't matter.`,
  ({ l }) => `Spin harder, ${l}. (It won't help.)`,
  ({ w }) => `Scientifically, legally and spiritually: ${w}.`,
  ({ w }) => `Certified random. ${w} wins.`,
  ({ w }) => `Best of three? Best of a hundred? Still ${w}.`,
];

/* ------------------------------------------------------------------ */
/* Geometry helpers. Angles are degrees, clockwise from 12 o'clock.    */
/* ------------------------------------------------------------------ */

const mod = (n, m) => ((n % m) + m) % m;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

function slicePath(start, end, r) {
  const [x1, y1] = polar(r, start);
  const [x2, y2] = polar(r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M0 0 L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}Z`;
}

function buildSlices(loserCount, winnerCount, tiny) {
  const total = loserCount + winnerCount;
  const even = 360 / total;
  const winSize = tiny ? even * TINY_FACTOR : even;
  const loseSize = (360 - winSize * winnerCount) / loserCount;
  // Spread the winner slices evenly around the wheel.
  const winIndexes = new Set(
    Array.from({ length: winnerCount }, (_, j) => Math.floor(((j + 0.5) * total) / winnerCount)),
  );
  let angle = 0;
  let losersSoFar = 0;
  return Array.from({ length: total }, (_, i) => {
    const isWinner = winIndexes.has(i);
    const size = isWinner ? winSize : loseSize;
    const slice = {
      start: angle,
      end: angle + size,
      isWinner,
      color: isWinner ? COLORS.winner : losersSoFar++ % 2 ? COLORS.loserB : COLORS.loserA,
    };
    angle += size;
    return slice;
  });
}

// The pointer sits at 12 o'clock. With the wheel rotated by `rotation`,
// the wheel-local angle under it is -rotation.
function sliceUnderPointer(slices, rotation) {
  const local = mod(-rotation, 360);
  const i = slices.findIndex((s) => local >= s.start && local < s.end);
  return i === -1 ? slices.length - 1 : i;
}

function labelSize(slice, text) {
  const arc = (2 * Math.PI * R * 0.72 * (slice.end - slice.start)) / 360;
  const room = R * 0.66;
  return Math.max(7, Math.min(24, arc * 0.6, room / (Math.max(text.length, 3) * 0.62)));
}

/* ------------------------------------------------------------------ */
/* URL params + stored theme                                           */
/* ------------------------------------------------------------------ */

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const text = (key, max, fallback) => (p.get(key) || '').trim().slice(0, max) || fallback;
  const int = (key) => parseInt(p.get(key), 10);

  let winnerCount = int('nw');
  let loserCount = int('nl');
  const legacyTotal = int('n'); // old links: ?n=16 meant 15 losers + 1 winner
  if (Number.isNaN(winnerCount)) winnerCount = Number.isNaN(legacyTotal) ? DEFAULTS.winnerCount : 1;
  if (Number.isNaN(loserCount)) loserCount = Number.isNaN(legacyTotal) ? DEFAULTS.loserCount : legacyTotal - 1;
  winnerCount = clamp(winnerCount, 1, MAX_SLICES - 1);
  loserCount = clamp(loserCount, 1, MAX_SLICES - winnerCount);

  return {
    question: text('q', MAX_QUESTION, DEFAULTS.question),
    winner: text('w', MAX_NAME, DEFAULTS.winner),
    loser: text('l', MAX_NAME, DEFAULTS.loser),
    loserCount,
    winnerCount,
    tiny: p.get('tiny') !== '0',
    fromLink: ['q', 'w', 'l'].some((k) => p.has(k)),
  };
}

function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage blocked: fall through to system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function RiggedWheel() {
  const [initial] = useState(readParams);
  const [question, setQuestion] = useState(initial.question);
  const [winner, setWinner] = useState(initial.winner);
  const [loser, setLoser] = useState(initial.loser);
  const [loserCount, setLoserCount] = useState(initial.loserCount);
  const [winnerCount, setWinnerCount] = useState(initial.winnerCount);
  const [tiny, setTiny] = useState(initial.tiny);
  const [theme, setTheme] = useState(initialTheme);
  const [panelOpen, setPanelOpen] = useState(!initial.fromLink);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null); // { isWinner, index, quip }
  const [stats, setStats] = useState({ spins: 0, wins: 0 });
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShare] = useState(() => typeof navigator !== 'undefined' && !!navigator.share);

  const t = THEMES[theme];
  const total = loserCount + winnerCount;

  const wheelRef = useRef(null);
  const pointerRef = useRef(null);
  const rotationRef = useRef(-180 / (initial.loserCount + initial.winnerCount)); // rest mid-way through slice 0
  const rafRef = useRef(0);
  const spinningRef = useRef(false);
  const dirRef = useRef(1);
  const dragRef = useRef(null);
  const audioRef = useRef(null);
  const mutedRef = useRef(false);
  const timersRef = useRef([]);
  const lastQuipRef = useRef(-1);

  const shownQuestion = question.trim() || DEFAULTS.question;
  const winnerLabel = winner.trim() || DEFAULTS.winner;
  const loserLabel = loser.trim() || DEFAULTS.loser;

  const slices = useMemo(() => buildSlices(loserCount, winnerCount, tiny), [loserCount, winnerCount, tiny]);
  const slicesRef = useRef(slices);
  const lastSliceRef = useRef(sliceUnderPointer(slices, rotationRef.current));
  const loserPct = Math.round(
    (slices.filter((s) => !s.isWinner).reduce((sum, s) => sum + s.end - s.start, 0) / 360) * 100,
  );
  const landedSlice = result && !spinning ? slices[result.index] : null;

  const shareUrl = useMemo(() => {
    const params = new URLSearchParams({
      q: shownQuestion,
      w: winnerLabel,
      l: loserLabel,
      nl: String(loserCount),
      nw: String(winnerCount),
    });
    if (!tiny) params.set('tiny', '0');
    return `${window.location.origin}${window.location.pathname}?${params}`;
  }, [shownQuestion, winnerLabel, loserLabel, loserCount, winnerCount, tiny]);

  useLayoutEffect(() => {
    wheelRef.current.style.transform = `rotate(${rotationRef.current}deg)`;
  }, []);

  useEffect(() => {
    slicesRef.current = slices;
    lastSliceRef.current = sliceUnderPointer(slices, rotationRef.current);
  }, [slices]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage blocked: theme just won't persist */
    }
  }, [theme]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      timersRef.current.forEach(clearTimeout);
      audioRef.current?.close();
      audioRef.current = null;
      confetti.reset();
    },
    [],
  );

  /* ---------- sound ---------- */

  // Created lazily inside a user gesture so browsers allow playback.
  function getAudio() {
    if (!audioRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioRef.current = new Ctx();
    }
    if (audioRef.current.state === 'suspended') audioRef.current.resume();
    return audioRef.current;
  }

  function blip(ctx, { at, type, freq, endFreq, gain, length }) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + length);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  function tick() {
    // Flapper kicks against the direction of travel.
    pointerRef.current?.animate(
      [{ transform: 'rotate(0deg)' }, { transform: `rotate(${-22 * dirRef.current}deg)` }, { transform: 'rotate(0deg)' }],
      { duration: 130, easing: 'ease-out' },
    );
    if (mutedRef.current) return;
    const ctx = getAudio();
    if (!ctx) return;
    blip(ctx, { at: ctx.currentTime, type: 'triangle', freq: 1500, endFreq: 500, gain: 0.15, length: 0.035 });
  }

  function playFanfare() {
    if (mutedRef.current) return;
    const ctx = getAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      blip(ctx, { at: t0 + i * 0.11, type: 'triangle', freq, gain: 0.22, length: i === 3 ? 0.7 : 0.16 });
    });
  }

  /* ---------- spin ---------- */

  function applyRotation(deg) {
    rotationRef.current = deg;
    wheelRef.current.style.transform = `rotate(${deg}deg)`;
    const idx = sliceUnderPointer(slicesRef.current, deg);
    if (idx !== lastSliceRef.current) {
      lastSliceRef.current = idx;
      tick();
    }
  }

  // The rig: pick the landing angle first (somewhere inside a random
  // winner slice), then work out a rotation of N full turns that ends
  // exactly there. Spin power only changes how many turns and how long.
  function spin({ direction = 1, power = Math.random() } = {}) {
    if (spinningRef.current) return;
    getAudio();

    const winners = slicesRef.current.filter((s) => s.isWinner);
    const win = winners[Math.floor(Math.random() * winners.length)];
    const target = win.start + (win.end - win.start) * (0.15 + Math.random() * 0.7);
    const from = rotationRef.current;
    const turns = 5 + Math.round(power * 2); // 5-7 full rotations
    const offset = direction > 0 ? mod(-target - from, 360) : mod(from + target, 360);
    const to = from + direction * (turns * 360 + offset);
    const duration = 4000 + power * 1000; // 4-5 s
    const startedAt = performance.now();

    spinningRef.current = true;
    dirRef.current = direction;
    setSpinning(true);
    setResult(null);

    const step = (now) => {
      const p = Math.min(1, (now - startedAt) / duration);
      applyRotation(from + (to - from) * easeOutQuart(p));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else finish();
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function finish() {
    const deg = mod(rotationRef.current, 360);
    rotationRef.current = deg;
    wheelRef.current.style.transform = `rotate(${deg}deg)`;

    const index = sliceUnderPointer(slicesRef.current, deg);
    const landed = slicesRef.current[index];
    const quip = (lastQuipRef.current + 1 + Math.floor(Math.random() * (QUIPS.length - 1))) % QUIPS.length;
    lastQuipRef.current = quip;

    spinningRef.current = false;
    setSpinning(false);
    setStats((s) => ({ spins: s.spins + 1, wins: s.wins + (landed.isWinner ? 1 : 0) }));
    setResult({ isWinner: landed.isWinner, index, quip });
    if (landed.isWinner) celebrate();
  }

  function celebrate() {
    playFanfare();
    const base = {
      colors: [COLORS.winner, '#fb7185', '#fcd34d', '#ffffff'],
      disableForReducedMotion: true,
      zIndex: 50,
    };
    confetti({ ...base, particleCount: 140, spread: 90, startVelocity: 45, origin: { y: 0.55 } });
    timersRef.current.push(
      setTimeout(() => {
        confetti({ ...base, particleCount: 70, angle: 60, spread: 65, origin: { x: 0, y: 0.75 } });
        confetti({ ...base, particleCount: 70, angle: 120, spread: 65, origin: { x: 1, y: 0.75 } });
      }, 250),
    );
  }

  /* ---------- grab & flick ---------- */

  function pointerAngle(e) {
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return (Math.atan2(e.clientX - cx, cy - e.clientY) * 180) / Math.PI;
  }

  function onPointerDown(e) {
    if (spinningRef.current) return;
    getAudio();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { last: pointerAngle(e), samples: [{ t: e.timeStamp, r: rotationRef.current }] };
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const angle = pointerAngle(e);
    const delta = mod(angle - drag.last + 180, 360) - 180;
    drag.last = angle;
    if (delta) dirRef.current = Math.sign(delta);
    applyRotation(rotationRef.current + delta);
    drag.samples.push({ t: e.timeStamp, r: rotationRef.current });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
  }

  function onPointerUp(e) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const velocity = (last.r - first.r) / Math.max(e.timeStamp - first.t, 1);
    if (Math.abs(velocity) > FLICK_MIN) {
      spin({ direction: Math.sign(velocity), power: Math.min(1, (Math.abs(velocity) - FLICK_MIN) / 1.5) });
    }
  }

  /* ---------- share ---------- */

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const el = document.createElement('textarea');
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setCopied(true);
    timersRef.current.push(setTimeout(() => setCopied(false), 1800));
  }

  async function nativeShare() {
    try {
      await navigator.share({
        title: shownQuestion,
        text: `${shownQuestion} Spin the wheel and see for yourself.`,
        url: shareUrl,
      });
    } catch (err) {
      if (err?.name !== 'AbortError') copyLink();
    }
  }

  function resetSettings() {
    setQuestion(DEFAULTS.question);
    setWinner(DEFAULTS.winner);
    setLoser(DEFAULTS.loser);
    setLoserCount(DEFAULTS.loserCount);
    setWinnerCount(DEFAULTS.winnerCount);
    setTiny(DEFAULTS.tiny);
  }

  /* ---------- render ---------- */

  const inputClass = `w-full rounded-xl border px-3 py-2.5 text-sm font-medium outline-none transition focus:ring-4 ${t.input}`;
  const cardClass = `rounded-3xl p-5 ring-1 transition-colors ${t.card}`;
  const iconBtnClass = `grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow ring-1 transition ${t.iconBtn}`;

  return (
    <div
      className={`min-h-screen antialiased transition-colors ${t.text}`}
      style={{ background: t.background, colorScheme: t.scheme }}
    >
      <style>{`@keyframes rw-pop{0%{opacity:0;transform:scale(.85)}60%{opacity:1;transform:scale(1.04)}100%{transform:scale(1)}}`}</style>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        {/* Header */}
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-600 text-white shadow-lg shadow-rose-600/30">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight sm:text-2xl">The Totally Fair Wheel</h1>
              <p className={`text-sm ${t.muted}`}>Settle any argument with certified randomness.*</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTheme((m) => (m === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className={iconBtnClass}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
              className={iconBtnClass}
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <main className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
          {/* Stage */}
          <section
            className={`flex flex-col items-center rounded-[2rem] px-5 py-8 ring-1 backdrop-blur transition-colors sm:px-10 sm:py-10 ${t.stage}`}
          >
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-500">The question</p>
            <h2 className="mt-2 max-w-xl text-balance text-center text-3xl font-black tracking-tight sm:text-4xl">
              {shownQuestion}
            </h2>

            <div className="relative mt-10 aspect-square w-full max-w-[26rem] select-none">
              <div
                ref={wheelRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => (dragRef.current = null)}
                className={`absolute inset-0 rounded-full touch-none ${spinning ? 'cursor-wait' : 'cursor-grab active:cursor-grabbing'}`}
                style={{ willChange: 'transform' }}
              >
                <svg viewBox="-210 -210 420 420" className="h-full w-full drop-shadow-2xl" aria-hidden="true">
                  <circle r="206" fill={t.rim} />
                  <circle r={R + 2} fill="#fff" />
                  {slices.map((s, i) => {
                    const text = s.isWinner ? winnerLabel : loserLabel;
                    return (
                      <g key={i}>
                        <path d={slicePath(s.start, s.end, R)} fill={s.color} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
                        <g transform={`rotate(${(s.start + s.end) / 2})`}>
                          <text
                            x={R - 14}
                            transform="rotate(-90)"
                            textAnchor="end"
                            dominantBaseline="central"
                            fill="#fff"
                            fontSize={labelSize(s, text)}
                            fontWeight="800"
                            letterSpacing="0.02em"
                          >
                            {text}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                  {landedSlice?.isWinner && (
                    <path
                      d={slicePath(landedSlice.start, landedSlice.end, R)}
                      fill="none"
                      stroke="#fde047"
                      strokeWidth="6"
                      strokeLinejoin="round"
                      className="animate-pulse"
                    />
                  )}
                  {Array.from({ length: BULBS }, (_, i) => {
                    const [cx, cy] = polar(197, (i * 360) / BULBS);
                    return (
                      <circle
                        key={i}
                        cx={cx}
                        cy={cy}
                        r="4.5"
                        fill={COLORS.bulb}
                        className={spinning ? 'animate-pulse' : ''}
                        style={{ animationDelay: `${(i % 2) * 0.5}s`, animationDuration: '0.8s' }}
                      />
                    );
                  })}
                </svg>
              </div>

              {/* Hub doubles as a spin button */}
              <button
                type="button"
                onClick={() => spin()}
                disabled={spinning}
                aria-label="Spin the wheel"
                className={`absolute left-1/2 top-1/2 grid h-[20%] w-[20%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-lg ring-4 transition hover:scale-105 disabled:hover:scale-100 ${t.hub}`}
              >
                <Heart className={`h-1/2 w-1/2 fill-rose-600 text-rose-600 ${spinning ? 'animate-pulse' : ''}`} />
              </button>

              {/* Pointer */}
              <div
                className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2"
                style={{ top: '-3%', width: '10%', height: '14%' }}
              >
                <div ref={pointerRef} className="h-full w-full" style={{ transformOrigin: '50% 36%' }}>
                  <svg viewBox="0 0 40 56" className="h-full w-full drop-shadow-md" aria-hidden="true">
                    <path d="M20 54 L6 26 A16 16 0 1 1 34 26 Z" fill={t.rim} stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
                    <circle cx="20" cy="20" r="6" fill={COLORS.bulb} />
                  </svg>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => spin()}
              disabled={spinning}
              className={`group mt-10 inline-flex items-center gap-2 rounded-full bg-rose-600 px-10 py-4 text-lg font-black uppercase tracking-wider text-white shadow-lg shadow-rose-600/30 transition hover:-translate-y-0.5 hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-4 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-rose-600 ${t.focusRing}`}
            >
              <RotateCw className={`h-5 w-5 ${spinning ? 'animate-spin' : 'transition-transform group-hover:rotate-90'}`} />
              {spinning ? 'Spinning…' : stats.spins ? 'Spin again' : 'Spin'}
            </button>

            <div aria-live="polite" className="mt-6 flex min-h-[5.5rem] flex-col items-center text-center">
              {result && !spinning ? (
                <div style={{ animation: 'rw-pop .45s ease-out' }}>
                  <p className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold ring-1 ${t.winChip}`}>
                    <Trophy className="h-4 w-4" />
                    {result.isWinner ? `${winnerLabel} wins!` : `${loserLabel} wins?!`}
                  </p>
                  <p className="mt-3 text-lg font-semibold">
                    {QUIPS[result.quip]({ w: winnerLabel, l: loserLabel, pct: loserPct })}
                  </p>
                </div>
              ) : (
                <p className={`pt-3 text-sm ${t.subtle}`}>
                  {spinning ? 'Anything could happen…' : 'Hit spin, or grab the wheel and flick it as hard as you like.'}
                </p>
              )}
            </div>

            <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs font-semibold">
              <span className={`rounded-full px-3 py-1 ${t.chip}`}>
                {stats.spins} {stats.spins === 1 ? 'spin' : 'spins'}
              </span>
              <span className={`rounded-full px-3 py-1 ${t.winChip}`}>
                {winnerLabel}: {stats.wins}
              </span>
              <span className={`rounded-full px-3 py-1 ${t.loseChip}`}>
                {loserLabel}: {stats.spins - stats.wins}
              </span>
            </div>
          </section>

          {/* Sidebar */}
          <aside className="space-y-6">
            <div className={cardClass}>
              <button
                type="button"
                onClick={() => setPanelOpen((o) => !o)}
                aria-expanded={panelOpen}
                className="flex w-full items-center justify-between"
              >
                <span className="flex items-center gap-2 font-bold">
                  <Settings2 className={`h-5 w-5 ${t.subtle}`} />
                  Customize
                </span>
                <ChevronDown className={`h-5 w-5 transition-transform ${t.subtle} ${panelOpen ? 'rotate-180' : ''}`} />
              </button>

              {panelOpen && (
                <div className="mt-5 space-y-5">
                  <Field t={t} label="Question" hint={`${question.length}/${MAX_QUESTION}`}>
                    <input
                      value={question}
                      maxLength={MAX_QUESTION}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder={DEFAULTS.question}
                      className={inputClass}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field t={t} label={<Dot color={COLORS.winner}>Winner</Dot>}>
                      <input
                        value={winner}
                        maxLength={MAX_NAME}
                        onChange={(e) => setWinner(e.target.value)}
                        placeholder={DEFAULTS.winner}
                        className={inputClass}
                      />
                    </Field>
                    <Field t={t} label={<Dot color={COLORS.loserA}>Loser</Dot>}>
                      <input
                        value={loser}
                        maxLength={MAX_NAME}
                        onChange={(e) => setLoser(e.target.value)}
                        placeholder={DEFAULTS.loser}
                        className={inputClass}
                      />
                    </Field>
                  </div>

                  <div>
                    <SectionLabel t={t} hint={`${total} total · max ${MAX_SLICES}`}>
                      Slices
                    </SectionLabel>
                    <div className="grid grid-cols-2 gap-3">
                      <Stepper
                        t={t}
                        label={<Dot color={COLORS.winner}>{winnerLabel}</Dot>}
                        name={`${winnerLabel} slices`}
                        value={winnerCount}
                        min={1}
                        max={MAX_SLICES - loserCount}
                        onChange={setWinnerCount}
                        disabled={spinning}
                      />
                      <Stepper
                        t={t}
                        label={<Dot color={COLORS.loserA}>{loserLabel}</Dot>}
                        name={`${loserLabel} slices`}
                        value={loserCount}
                        min={1}
                        max={MAX_SLICES - winnerCount}
                        onChange={setLoserCount}
                        disabled={spinning}
                      />
                    </div>

                    <p className={`mb-1.5 mt-3 text-xs font-medium ${t.subtle}`}>Quick picks (total slices)</p>
                    <div role="radiogroup" aria-label="Total slices" className={`grid grid-cols-6 gap-1 rounded-xl p-1 ${t.seg}`}>
                      {QUICK_PICKS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={total === n}
                          disabled={spinning || n - winnerCount < 1}
                          onClick={() => setLoserCount(n - winnerCount)}
                          className={`rounded-lg py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            total === n ? t.segOn : t.segOff
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={tiny}
                    disabled={spinning}
                    onClick={() => setTiny((v) => !v)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${t.well}`}
                  >
                    <span>
                      <span className="block text-sm font-semibold">
                        Tiny {winnerLabel} {winnerCount === 1 ? 'slice' : 'slices'}
                      </span>
                      <span className={`block text-xs ${t.subtle}`}>The smaller it is, the funnier the win.</span>
                    </span>
                    <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${tiny ? 'bg-rose-600' : t.switchOff}`}>
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${tiny ? 'left-[22px]' : 'left-0.5'}`}
                      />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={resetSettings}
                    disabled={spinning}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold transition hover:text-rose-500 disabled:cursor-not-allowed ${t.subtle}`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to defaults
                  </button>
                </div>
              )}
            </div>

            <div className={cardClass}>
              <h3 className="flex items-center gap-2 font-bold">
                <Share2 className={`h-5 w-5 ${t.subtle}`} />
                Send it to your partner
              </h3>
              <p className={`mt-1 text-sm ${t.muted}`}>They can spin as many times as they like.</p>
              <div className="mt-4 flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                  aria-label="Share link"
                  className={`${inputClass} min-w-0 flex-1 truncate text-xs`}
                />
                <button
                  type="button"
                  onClick={copyLink}
                  aria-label="Copy link"
                  className={`grid w-11 shrink-0 place-items-center rounded-xl text-white transition ${
                    copied ? 'bg-emerald-500' : t.copyBtn
                  }`}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {canShare && (
                <button
                  type="button"
                  onClick={nativeShare}
                  className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold ring-1 transition ${t.shareBtn}`}
                >
                  <Share2 className="h-4 w-4" />
                  Share…
                </button>
              )}
              <p className={`mt-3 text-xs ${t.subtle}`} aria-live="polite">
                {copied ? 'Link copied. Send it and wait.' : 'Includes your question, names and slice counts.'}
              </p>
            </div>
          </aside>
        </main>

        <footer className={`mt-10 text-center text-xs ${t.subtle}`}>
          *Randomness not included. Results are final and binding in most households.
        </footer>
      </div>
    </div>
  );
}

function SectionLabel({ t, hint, children }) {
  return (
    <span className={`mb-1.5 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider ${t.muted}`}>
      {children}
      {hint && <span className={`truncate font-medium normal-case tracking-normal ${t.subtle}`}>{hint}</span>}
    </span>
  );
}

function Field({ t, label, hint, children }) {
  return (
    <label className="block">
      <SectionLabel t={t} hint={hint}>
        {label}
      </SectionLabel>
      {children}
    </label>
  );
}

function Dot({ color, children }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{children}</span>
    </span>
  );
}

function Stepper({ t, label, name, value, min, max, onChange, disabled }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const n = parseInt(draft, 10);
    if (Number.isNaN(n)) setDraft(String(value));
    else onChange(clamp(n, min, max));
  }

  const btn = `grid h-9 w-9 shrink-0 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-30 ${t.stepBtn}`;

  return (
    <div role="group" aria-label={name}>
      <p className={`mb-1.5 text-xs font-semibold ${t.muted}`}>{label}</p>
      <div className={`flex items-center rounded-xl p-1 ring-1 ${t.well}`}>
        <button type="button" aria-label={`Fewer ${name}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} className={btn}>
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          aria-label={name}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 2);
            setDraft(v);
            const n = parseInt(v, 10);
            if (n >= min && n <= max) onChange(n);
          }}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-full min-w-0 bg-transparent text-center text-lg font-black tabular-nums outline-none disabled:opacity-60"
        />
        <button type="button" aria-label={`More ${name}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} className={btn}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
