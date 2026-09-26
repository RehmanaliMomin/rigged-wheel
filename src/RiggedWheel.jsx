import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Dices,
  Lightbulb,
  LoaderCircle,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  RotateCw,
  Settings2,
  Share2,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

// Laya (huggingface.co/convaiinnovations/laya) decides whether a question
// is praise or blame. It runs as a small API (see server/); set VITE_LAYA_URL
// to its address. Without it, the built-in word list decides.
const LAYA_URL = (import.meta.env?.VITE_LAYA_URL || '').replace(/\/+$/, '');
const LAYA_TIMEOUT_MS = 12000;
const SPIN_WAIT_MS = 2500; // how long Spin waits for Laya on a question it's still reading
const RULE_WEIGHT = 1; // how hard each matching word nudges Laya's answer (in log-odds)
const DUTY_WEIGHT = 3; // "who should respect…" is a taunt; strong enough to overrule Laya
const PRIVILEGE_WEIGHT = 2; // "who should pick…" is a perk

const DEFAULTS = {
  question: 'Who is always right?',
  good: 'Bairu', // gets the credit
  bad: 'Shauhar', // gets the blame
  goodCount: 8, // an even 50/50 wheel looks fair; it still always lands on the right person
  badCount: 8,
};
const MAX_SLICES = 40;
const QUICK_PICKS = [8, 12, 16, 20, 30, 40]; // split evenly between the two names
const IDEAS_SHOWN = 2; // question ideas shown per kind
const MAX_QUESTION = 80;
const PALETTE = {
  good: ['#e11d48', '#9f1239'],
  bad: ['#3b82f6', '#1e40af'],
};
const BULB = '#fcd34d';
const R = 188; // slice radius in SVG units (viewBox is 420 wide)
const BULBS = 24;
const FLICK_MIN = 0.3; // deg/ms a drag needs on release to count as a spin
const THEME_KEY = 'rigged-wheel-theme';

const SUGGESTIONS = {
  credit: [
    'Who is always right?',
    'Whose advice should we follow?',
    'Who is the better cook?',
    'Who has better taste?',
    'Who is the better driver?',
    'Who plans the best trips?',
    'Who is the funniest?',
    'Who is smarter?',
    'Who gives the best hugs?',
    'Who wins every argument?',
    'Who should we listen to?',
    'Who should be in charge?',
  ],
  blame: [
    'Who makes more mistakes?',
    'Who snores louder?',
    'Who leaves socks on the floor?',
    'Who forgot the anniversary?',
    'Who gets lost without GPS?',
    'Who ate the last slice?',
    'Who started the argument?',
    'Who hogs the blanket?',
    'Who is always late?',
    'Who is doing the dishes tonight?',
    'Who should respect the other more?',
    'Who should apologize first?',
  ],
};
const ALL_SUGGESTIONS = [...SUGGESTIONS.credit, ...SUGGESTIONS.blame];

function pickIdeas() {
  const sample = (list) => [...list].sort(() => Math.random() - 0.5).slice(0, IDEAS_SHOWN);
  const credit = sample(SUGGESTIONS.credit).map((q) => ({ q, kind: 'credit' }));
  const blame = sample(SUGGESTIONS.blame).map((q) => ({ q, kind: 'blame' }));
  return credit.flatMap((c, i) => [c, blame[i]]);
}

// Fallback when Laya is asleep, and a nudge when Laya is unsure.
const WORDS = {
  credit: [
    'right', 'correct', 'smart(er|est)?', 'wiser?', 'wisdom', 'advice', 'advise', 'better', 'best', 'great(er|est)?',
    'kind(er|est)?', 'nicer?', 'funn(y|ier|iest)', 'beautiful', 'prett(y|ier|iest)', 'handsome', 'trust(ed)?',
    'deserves?', 'wins?', 'winner', 'winning', 'favou?rite', 'loved?', 'boss', 'charge', 'decides?', 'picks?',
    'chooses?', 'remembers?', 'genius', 'hero', 'mvp', 'patient', 'organi[sz]ed', 'brave', 'strong(er)?', 'cute(r|st)?',
    'cool(er|est)?', 'talented', 'awesome', 'amazing', 'perfect', 'clever(er)?', 'hugs?', 'taste', 'listen(s|ed)?',
    'legend', 'queen', 'king', 'champion',
  ],
  blame: [
    'mistakes?', 'wrong', 'wors[et]', 'late(r|st)?', 'laz(y|ier|iest)', 'snor(e|es|ed|ing)', 'louder', 'forg(e|o)t(s|ten)?',
    'lost', 'los(e|es|ing|er)', 'mess(y|ier|iest)?', 'blamed?', 'fault', 'annoy(ing|s)?', 'lie(s|d)?', 'lying',
    'cheat(s|ed)?', 'broke', 'break(s)?', 'broken', 'burn(s|ed|t)?', 'crash(es|ed)?', 'stubborn', 'grump(y|ier)',
    'rude', 'dirt(y|ier)', 'smell(s|y)?', 'argu(e|es|ed|ment)', 'fight(s)?', 'overreacts?', 'complain(s)?', 'hogs?',
    'socks?', 'dishes', 'laundry', 'trash', 'garbage', 'chores?', 'vacuum', 'apologi[sz]e', 'sorry', 'drama',
    'scared', 'afraid', 'slow(er|est)?', 'spends?', 'ate', 'fart(s)?',
  ],
};
// "Who should / needs to / has to <verb>" puts the answer on the hook, unless the
// verb is a perk ("who should pick the movie?") or someone else is the subject
// ("who should we listen to?").
const MODALS = [['should'], ['must'], ['needs', 'to'], ['need', 'to'], ['has', 'to'], ['have', 'to'], ['ought', 'to'], ['gotta']];
const OTHER_SUBJECTS = new Set(['we', 'i', 'you', 'they', 'us', 'he', 'she', 'people', 'everyone']);
const PERK_VERBS = new Set(['get', 'pick', 'choose', 'decide', 'win', 'lead', 'relax', 'rest', 'sleep', 'eat', 'have', 'go', 'sit', 'make', 'plan', 'drive', 'keep', 'own', 'control']);
const PERK_AFTER_BE = new Set(['in', 'the', 'allowed', 'trusted', 'praised', 'thanked', 'celebrated', 'pampered', 'spoiled']);
const NEGATORS = new Set(['never', 'not', 'no', 'dont', 'doesnt', 'isnt', 'cant', 'wont', 'didnt', 'arent']);
const WORD_RES = {
  credit: new RegExp(`^(${WORDS.credit.join('|')})$`),
  blame: new RegExp(`^(${WORDS.blame.join('|')})$`),
};

const QUIPS = {
  credit: [
    ({ a }) => `The wheel has spoken. ${a} is right. Again.`,
    ({ o, pct }) => `${pct}% of the wheel said ${o}. Didn't matter.`,
    ({ o }) => `Spin harder, ${o}. (It won't help.)`,
    ({ a }) => `Scientifically, legally and spiritually: ${a}.`,
    ({ a }) => `Certified random. ${a} wins.`,
    ({ a }) => `Best of three? Best of a hundred? Still ${a}.`,
  ],
  blame: [
    ({ a }) => `The wheel has spoken. ${a}, this one's on you.`,
    ({ a, o, pct }) => `${pct}% of the wheel said ${o}. Still ${a}.`,
    ({ a }) => `Nice try, ${a}. The wheel knows.`,
    ({ a }) => `Scientifically, legally and spiritually: ${a}.`,
    ({ a }) => `Certified random. Sorry, ${a}.`,
    ({ a }) => `Appeal denied, ${a}.`,
  ],
};

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
    goodChip: 'bg-rose-50 text-rose-700 ring-rose-200',
    badChip: 'bg-blue-50 text-blue-700 ring-blue-200',
    idea: 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-white hover:text-slate-900',
    verdict: 'bg-white/80 ring-slate-900/10 text-slate-600',
    verdictBtn: 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
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
    goodChip: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    badChip: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
    idea: 'bg-slate-800/60 text-slate-300 ring-slate-700 hover:bg-slate-800 hover:text-white',
    verdict: 'bg-slate-800/80 ring-white/10 text-slate-300',
    verdictBtn: 'text-slate-400 hover:bg-slate-700 hover:text-white',
    copyBtn: 'bg-slate-700 hover:bg-slate-600',
    shareBtn: 'bg-rose-500/15 text-rose-300 ring-rose-500/30 hover:bg-rose-500/25',
    switchOff: 'bg-slate-600',
    focusRing: 'focus-visible:ring-rose-500/40',
    hub: 'bg-slate-100 ring-slate-950',
  },
};

/* ------------------------------------------------------------------ */
/* Helpers. Angles are degrees, clockwise from 12 o'clock.             */
/* ------------------------------------------------------------------ */

const mod = (n, m) => ((n % m) + m) % m;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
const logit = (p) => Math.log(p / (1 - p));
const pickOther = (list, current) => {
  const pool = list.filter((q) => q !== current);
  return pool[Math.floor(Math.random() * pool.length)];
};

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

// Equal-width slices for both names, the smaller group spread evenly among the
// larger one. The wheel doesn't depend on the question; only the landing does.
function buildSlices(goodCount, badCount) {
  const total = goodCount + badCount;
  const size = 360 / total;
  const [fewRole, fewCount, manyRole] = goodCount <= badCount ? ['good', goodCount, 'bad'] : ['bad', badCount, 'good'];
  const fewIndexes = new Set(Array.from({ length: fewCount }, (_, j) => Math.floor(((j + 0.5) * total) / fewCount)));
  const seen = { good: 0, bad: 0 };
  return Array.from({ length: total }, (_, i) => {
    const role = fewIndexes.has(i) ? fewRole : manyRole;
    return { start: i * size, end: (i + 1) * size, role, color: PALETTE[role][seen[role]++ % 2] };
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

// Reads "who should <verb>…": DUTY_WEIGHT against for a duty, PRIVILEGE_WEIGHT for a perk, else 0.
function obligationScore(words) {
  const who = words.findIndex((w) => w === 'who' || w === 'whos');
  if (who === -1) return 0;
  const after = words.slice(who + 1);
  const modal = MODALS.find((m) => m.every((w, i) => after[i] === w));
  if (!modal) return 0;
  const [verb, next] = after.slice(modal.length);
  if (!verb || OTHER_SUBJECTS.has(verb)) return 0;
  if (PERK_VERBS.has(verb) || (verb === 'be' && PERK_AFTER_BE.has(next))) return PRIVILEGE_WEIGHT;
  return -DUTY_WEIGHT;
}

// +1 for each praise word, -1 for each blame word ("never"/"not" just before flips it),
// plus the "who should…" reading above.
function wordScore(text) {
  const words = text.toLowerCase().replace(/['’]/g, '').split(/[^a-z]+/).filter(Boolean);
  let score = obligationScore(words);
  words.forEach((word, i) => {
    const hit = WORD_RES.credit.test(word) ? 1 : WORD_RES.blame.test(word) ? -1 : 0;
    if (!hit) return;
    const negated = words.slice(Math.max(0, i - 2), i).some((w) => NEGATORS.has(w));
    score += negated ? -hit : hit;
  });
  return score;
}

// Laya decides; the word list only tips it when Laya is unsure. Without Laya,
// the word list decides, and with no clues at all it's praise (the original joke).
function decide({ layaP, words }) {
  if (layaP != null) {
    const p = 1 / (1 + Math.exp(-(logit(clamp(layaP, 0.001, 0.999)) + RULE_WEIGHT * words)));
    const verdict = p >= 0.5 ? 'credit' : 'blame';
    return { verdict, source: 'laya', layaP, overruled: verdict !== (layaP >= 0.5 ? 'credit' : 'blame') };
  }
  if (words) return { verdict: words > 0 ? 'credit' : 'blame', source: 'words' };
  return { verdict: 'credit', source: 'default' };
}

/* ------------------------------------------------------------------ */
/* URL params + stored theme                                           */
/* ------------------------------------------------------------------ */

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const text = (key, max, fallback) => (p.get(key) || '').trim().slice(0, max) || fallback;
  const int = (key) => parseInt(p.get(key), 10);

  let goodCount = int('nw');
  let badCount = int('nl');
  const legacyTotal = int('n'); // old links: ?n=16 meant 15 × loser + 1 × winner
  if (Number.isNaN(goodCount)) goodCount = Number.isNaN(legacyTotal) ? DEFAULTS.goodCount : 1;
  if (Number.isNaN(badCount)) badCount = Number.isNaN(legacyTotal) ? DEFAULTS.badCount : legacyTotal - 1;
  goodCount = clamp(goodCount, 1, MAX_SLICES - 1);
  badCount = clamp(badCount, 1, MAX_SLICES - goodCount);

  return {
    question: text('q', MAX_QUESTION, DEFAULTS.question),
    goodCount,
    badCount,
    fromLink: p.has('q'),
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
  const [goodCount, setGoodCount] = useState(initial.goodCount);
  const [badCount, setBadCount] = useState(initial.badCount);
  const [ideas, setIdeas] = useState(() => pickIdeas());
  const [laya, setLaya] = useState({ status: 'idle', key: '', p: null });
  const [frozen, setFrozen] = useState(null); // decision locked for the length of a spin
  const [theme, setTheme] = useState(initialTheme);
  const [panelOpen, setPanelOpen] = useState(!initial.fromLink);
  const [spinning, setSpinning] = useState(false);
  const [waitingForLaya, setWaitingForLaya] = useState(false);
  const [result, setResult] = useState(null); // { verdict, index, answer, other, quip }
  const [tally, setTally] = useState({ spins: 0, good: 0, bad: 0 });
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canShare] = useState(() => typeof navigator !== 'undefined' && !!navigator.share);

  const t = THEMES[theme];
  const total = goodCount + badCount;

  const wheelRef = useRef(null);
  const pointerRef = useRef(null);
  const rotationRef = useRef(-180 / (initial.goodCount + initial.badCount)); // rest mid-way through slice 0
  const rafRef = useRef(0);
  const spinningRef = useRef(false);
  const dirRef = useRef(1);
  const dragRef = useRef(null);
  const audioRef = useRef(null);
  const mutedRef = useRef(false);
  const timersRef = useRef([]);
  const lastQuipRef = useRef(-1);
  const layaCacheRef = useRef(new Map());
  const blameShapesRef = useRef(null);
  const pendingSpinRef = useRef(null);
  const spinRef = useRef(null);

  const shownQuestion = question.trim() || DEFAULTS.question;
  const questionKey = shownQuestion.toLowerCase().replace(/\s+/g, ' ');
  // Fixed on purpose: praise always goes to the same person, blame to the other.
  const goodName = DEFAULTS.good;
  const badName = DEFAULTS.bad;

  const liveDecision = decide({
    layaP: laya.status === 'ok' && laya.key === questionKey ? laya.p : null,
    words: wordScore(shownQuestion),
  });
  const decision = frozen ?? liveDecision;
  const isCredit = decision.verdict === 'credit';
  const answerName = isCredit ? goodName : badName;
  const decoyName = isCredit ? badName : goodName;
  const answerRole = isCredit ? 'good' : 'bad';
  const layaThinking = laya.key === questionKey && laya.status === 'loading';

  const slices = useMemo(() => buildSlices(goodCount, badCount), [goodCount, badCount]);
  const slicesRef = useRef(slices);
  const lastSliceRef = useRef(sliceUnderPointer(slices, rotationRef.current));
  const otherPct = Math.round(((isCredit ? badCount : goodCount) / total) * 100);
  const landedSlice = result && !spinning ? slices[result.index] : null;

  const shareUrl = useMemo(() => {
    const params = new URLSearchParams({
      q: shownQuestion,
      nw: String(goodCount),
      nl: String(badCount),
    });
    return `${window.location.origin}${window.location.pathname}?${params}`;
  }, [shownQuestion, goodCount, badCount]);

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

  // Ask Laya about the question (debounced, cached, falls back to the word list on failure).
  useEffect(() => {
    if (!LAYA_URL) return undefined;
    const cached = layaCacheRef.current.get(questionKey);
    if (cached != null) {
      setLaya({ status: 'ok', key: questionKey, p: cached });
      return undefined;
    }
    setLaya({ status: 'loading', key: questionKey, p: null });
    const ctrl = new AbortController();
    let cancelled = false;
    const debounce = setTimeout(() => {
      const kill = setTimeout(() => ctrl.abort(), LAYA_TIMEOUT_MS);
      fetch(`${LAYA_URL}/classify`, {
        method: 'POST',
        // The second header skips ngrok's browser warning page when Laya is tunnelled from a laptop.
        headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1' },
        body: JSON.stringify({ question: shownQuestion }),
        signal: ctrl.signal,
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data) => {
          if (typeof data.p_credit !== 'number') throw new Error('bad response');
          layaCacheRef.current.set(questionKey, data.p_credit);
          if (!cancelled) setLaya({ status: 'ok', key: questionKey, p: data.p_credit });
        })
        .catch(() => {
          if (!cancelled) setLaya({ status: 'error', key: questionKey, p: null });
        })
        .finally(() => clearTimeout(kill));
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      ctrl.abort();
    };
  }, [questionKey, shownQuestion]);

  // A spin requested while Laya was reading starts as soon as Laya answers.
  useEffect(() => {
    if (pendingSpinRef.current && !layaThinking) releasePendingSpin();
  });

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

  function blip(ctx, { at, type, freq, endFreq, gain, length, vibrato }) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + length);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 6;
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(at);
      lfo.stop(at + length + 0.02);
    }
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    amp.gain.setValueAtTime(gain, at + length * 0.7);
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

  function playSadTrombone() {
    if (mutedRef.current) return;
    const ctx = getAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    [392, 370, 349.23, 329.63].forEach((freq, i) => {
      blip(ctx, {
        at: t0 + i * 0.38,
        type: 'sawtooth',
        freq,
        endFreq: i === 3 ? freq * 0.94 : undefined,
        gain: 0.09,
        length: i === 3 ? 1.1 : 0.34,
        vibrato: i === 3 ? 7 : 0,
      });
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

  // Spin now, or once Laya has answered if it's still reading the question,
  // so the landing always matches the verdict shown above the wheel.
  function requestSpin(opts) {
    if (spinningRef.current || pendingSpinRef.current) return;
    if (!layaThinking) {
      spin(opts);
      return;
    }
    getAudio();
    pendingSpinRef.current = opts ?? {};
    setWaitingForLaya(true);
    timersRef.current.push(setTimeout(releasePendingSpin, SPIN_WAIT_MS));
  }

  function releasePendingSpin() {
    const opts = pendingSpinRef.current;
    if (!opts) return;
    pendingSpinRef.current = null;
    setWaitingForLaya(false);
    spinRef.current(opts); // latest render's spin, so it sees the latest verdict
  }

  // The rig: pick the landing angle first (somewhere inside a random
  // answer slice), then work out a rotation of N full turns that ends
  // exactly there. Spin power only changes how many turns and how long.
  function spin({ direction = 1, power = Math.random() } = {}) {
    if (spinningRef.current) return;
    getAudio();

    const answers = slicesRef.current.filter((s) => s.role === answerRole);
    const target = answers[Math.floor(Math.random() * answers.length)];
    const angle = target.start + (target.end - target.start) * (0.15 + Math.random() * 0.7);
    const from = rotationRef.current;
    const turns = 5 + Math.round(power * 2); // 5-7 full rotations
    const offset = direction > 0 ? mod(-angle - from, 360) : mod(from + angle, 360);
    const to = from + direction * (turns * 360 + offset);
    const duration = 4000 + power * 1000; // 4-5 s
    const startedAt = performance.now();
    const locked = { ...decision, role: answerRole, answer: answerName, other: decoyName, pct: otherPct };

    spinningRef.current = true;
    dirRef.current = direction;
    setFrozen(decision);
    setSpinning(true);
    setResult(null);

    const step = (now) => {
      const p = Math.min(1, (now - startedAt) / duration);
      applyRotation(from + (to - from) * easeOutQuart(p));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else finish(locked);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  spinRef.current = spin;

  function finish(locked) {
    const deg = mod(rotationRef.current, 360);
    rotationRef.current = deg;
    wheelRef.current.style.transform = `rotate(${deg}deg)`;

    const index = sliceUnderPointer(slicesRef.current, deg);
    const quips = QUIPS[locked.verdict];
    const quip = (lastQuipRef.current + 1 + Math.floor(Math.random() * (quips.length - 1))) % quips.length;
    lastQuipRef.current = quip;
    const role = locked.verdict === 'credit' ? 'good' : 'bad';

    spinningRef.current = false;
    setSpinning(false);
    setFrozen(null);
    setTally((s) => ({ ...s, spins: s.spins + 1, [role]: s[role] + 1 }));
    setResult({ verdict: locked.verdict, role: locked.role, index, answer: locked.answer, other: locked.other, pct: locked.pct, quip });
    if (slicesRef.current[index].role === locked.role) celebrate(locked.verdict);
  }

  function celebrate(verdict) {
    const base = { disableForReducedMotion: true, zIndex: 50 };
    if (verdict === 'credit') {
      playFanfare();
      const colors = [PALETTE.good[0], '#fb7185', BULB, '#ffffff'];
      confetti({ ...base, colors, particleCount: 140, spread: 90, startVelocity: 45, origin: { y: 0.55 } });
      timersRef.current.push(
        setTimeout(() => {
          confetti({ ...base, colors, particleCount: 70, angle: 60, spread: 65, origin: { x: 0, y: 0.75 } });
          confetti({ ...base, colors, particleCount: 70, angle: 120, spread: 65, origin: { x: 1, y: 0.75 } });
        }, 250),
      );
      return;
    }
    playSadTrombone();
    blameShapesRef.current ??= ['🤦', '🙃', '😬'].map((text) => confetti.shapeFromText({ text, scalar: 2.4 }));
    confetti({
      ...base,
      shapes: blameShapesRef.current,
      scalar: 2.4,
      particleCount: 36,
      spread: 100,
      startVelocity: 38,
      gravity: 0.9,
      ticks: 260,
      origin: { y: 0.5 },
    });
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
      requestSpin({ direction: Math.sign(velocity), power: Math.min(1, (Math.abs(velocity) - FLICK_MIN) / 1.5) });
    }
  }

  /* ---------- question + share ---------- */

  function askQuestion(q) {
    setQuestion(q);
    setResult(null);
  }

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
    askQuestion(DEFAULTS.question);
    setGoodCount(DEFAULTS.goodCount);
    setBadCount(DEFAULTS.badCount);
  }

  /* ---------- render ---------- */

  const inputClass = `w-full rounded-xl border px-3 py-2.5 text-sm font-medium outline-none transition focus:ring-4 disabled:opacity-60 ${t.input}`;
  const cardClass = `rounded-3xl p-5 ring-1 transition-colors ${t.card}`;
  const iconBtnClass = `grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow ring-1 transition ${t.iconBtn}`;
  const roleChip = (role) => (role === 'good' ? t.goodChip : t.badChip);
  const answerSure = decision.layaP != null ? Math.round((isCredit ? decision.layaP : 1 - decision.layaP) * 100) : null;

  let verdictIcon;
  let verdictText;
  if (layaThinking) {
    verdictIcon = <LoaderCircle className="h-4 w-4 animate-spin" />;
    verdictText = <>Laya is reading the question…</>;
  } else if (decision.overruled) {
    verdictIcon = <BookOpen className="h-4 w-4" />;
    verdictText = (
      <>
        Laya said {isCredit ? 'blame' : 'praise'}, but it's {isCredit ? 'a perk' : 'a taunt'}
      </>
    );
  } else if (decision.source === 'laya') {
    verdictIcon = <Brain className="h-4 w-4" />;
    verdictText = (
      <>
        Laya: sounds like {isCredit ? 'praise' : 'blame'}
        {answerSure >= 50 && <span className="opacity-60"> · {answerSure}% sure</span>}
      </>
    );
  } else {
    verdictIcon = <BookOpen className="h-4 w-4" />;
    verdictText =
      decision.source === 'words' ? (
        <>Word list: sounds like {isCredit ? 'praise' : 'blame'}</>
      ) : (
        <>No clues, so it's praise</>
      );
  }
  const verdictTitle =
    decision.source === 'words' || decision.source === 'default'
      ? LAYA_URL
        ? "Laya didn't answer in time, so the built-in word list decided."
        : 'Laya isn\'t connected, so the built-in word list decided.'
      : decision.overruled
        ? 'The word list overruled Laya: "who should…" questions put the answer on the hook (or give them a perk).'
        : decision.source === 'laya'
          ? 'Laya scored the question. If it was unsure, the word list tipped it.'
        : undefined;

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

            {/* Who it lands on, and why */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span
                title={verdictTitle}
                className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-sm font-medium ring-1 ${t.verdict}`}
              >
                {verdictIcon}
                <span>{verdictText}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${roleChip(answerRole)}`}>
                  → {answerName}
                </span>
              </span>
              <button
                type="button"
                disabled={spinning}
                onClick={() => askQuestion(pickOther(ALL_SUGGESTIONS, shownQuestion))}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${t.verdictBtn}`}
              >
                <Dices className="h-3.5 w-3.5" />
                Surprise me
              </button>
            </div>

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
                    const text = s.role === 'good' ? goodName : badName;
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
                  {landedSlice && landedSlice.role === result.role && (
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
                        fill={BULB}
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
                onClick={() => requestSpin()}
                disabled={spinning || waitingForLaya}
                aria-label="Spin the wheel"
                className={`absolute left-1/2 top-1/2 grid h-[20%] w-[20%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-lg ring-4 transition hover:scale-105 disabled:hover:scale-100 ${t.hub}`}
              >
                <span
                  className={`text-[clamp(0.7rem,3.4vw,1.1rem)] font-black tracking-wider text-rose-600 ${spinning ? 'animate-pulse' : ''}`}
                >
                  SPIN
                </span>
              </button>

              {/* Pointer */}
              <div
                className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2"
                style={{ top: '-3%', width: '10%', height: '14%' }}
              >
                <div ref={pointerRef} className="h-full w-full" style={{ transformOrigin: '50% 36%' }}>
                  <svg viewBox="0 0 40 56" className="h-full w-full drop-shadow-md" aria-hidden="true">
                    <path d="M20 54 L6 26 A16 16 0 1 1 34 26 Z" fill={t.rim} stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
                    <circle cx="20" cy="20" r="6" fill={BULB} />
                  </svg>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => requestSpin()}
              disabled={spinning || waitingForLaya}
              className={`group mt-10 inline-flex items-center gap-2 rounded-full bg-rose-600 px-10 py-4 text-lg font-black uppercase tracking-wider text-white shadow-lg shadow-rose-600/30 transition hover:-translate-y-0.5 hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-4 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-rose-600 ${t.focusRing}`}
            >
              <RotateCw className={`h-5 w-5 ${spinning ? 'animate-spin' : 'transition-transform group-hover:rotate-90'}`} />
              {waitingForLaya ? 'Asking Laya…' : spinning ? 'Spinning…' : tally.spins ? 'Spin again' : 'Spin'}
            </button>

            <div aria-live="polite" className="mt-6 flex min-h-[5.5rem] flex-col items-center text-center">
              {result && !spinning ? (
                <div style={{ animation: 'rw-pop .45s ease-out' }}>
                  <p
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold ring-1 ${
                      result.verdict === 'credit' ? t.goodChip : t.badChip
                    }`}
                  >
                    {result.verdict === 'credit' ? <Trophy className="h-4 w-4" /> : <ThumbsDown className="h-4 w-4" />}
                    {result.verdict === 'credit' ? `${result.answer} wins!` : `It's ${result.answer}.`}
                  </p>
                  <p className="mt-3 text-lg font-semibold">
                    {QUIPS[result.verdict][result.quip]({ a: result.answer, o: result.other, pct: result.pct })}
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
                {tally.spins} {tally.spins === 1 ? 'spin' : 'spins'}
              </span>
              <span className={`rounded-full px-3 py-1 ${t.goodChip}`}>
                {goodName}: {tally.good}
              </span>
              <span className={`rounded-full px-3 py-1 ${t.badChip}`}>
                {badName}: {tally.bad}
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
                      disabled={spinning}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder={DEFAULTS.question}
                      className={inputClass}
                    />
                  </Field>

                  <div>
                    <SectionLabel
                      t={t}
                      hint={
                        <button
                          type="button"
                          disabled={spinning}
                          onClick={() => setIdeas(pickIdeas())}
                          className="inline-flex items-center gap-1 font-semibold transition hover:text-rose-500 disabled:cursor-not-allowed"
                        >
                          <Dices className="h-3.5 w-3.5" />
                          More ideas
                        </button>
                      }
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Lightbulb className="h-3.5 w-3.5" />
                        Question ideas
                      </span>
                    </SectionLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {ideas.map(({ q, kind }) => (
                        <button
                          key={q}
                          type="button"
                          disabled={spinning}
                          onClick={() => askQuestion(q)}
                          title={kind === 'credit' ? `Praise → ${goodName}` : `Blame → ${badName}`}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            q === shownQuestion ? roleChip(kind === 'credit' ? 'good' : 'bad') : t.idea
                          }`}
                        >
                          {kind === 'credit' ? <ThumbsUp className="h-3 w-3 text-rose-500" /> : <ThumbsDown className="h-3 w-3 text-blue-500" />}
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <SectionLabel t={t} hint={`${total} total · max ${MAX_SLICES}`}>
                      Slices
                    </SectionLabel>
                    <div className="grid grid-cols-2 gap-3">
                      <Stepper
                        t={t}
                        label={<Dot color={PALETTE.good[0]}>{goodName}</Dot>}
                        name={`${goodName} slices`}
                        value={goodCount}
                        min={1}
                        max={MAX_SLICES - badCount}
                        onChange={setGoodCount}
                        disabled={spinning}
                      />
                      <Stepper
                        t={t}
                        label={<Dot color={PALETTE.bad[0]}>{badName}</Dot>}
                        name={`${badName} slices`}
                        value={badCount}
                        min={1}
                        max={MAX_SLICES - goodCount}
                        onChange={setBadCount}
                        disabled={spinning}
                      />
                    </div>

                    <p className={`mb-1.5 mt-3 text-xs font-medium ${t.subtle}`}>Even split</p>
                    <div role="radiogroup" aria-label="Even split" className={`grid grid-cols-6 gap-1 rounded-xl p-1 ${t.seg}`}>
                      {QUICK_PICKS.map((n) => {
                        const on = goodCount === n / 2 && badCount === n / 2;
                        return (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={spinning}
                            onClick={() => {
                              setGoodCount(n / 2);
                              setBadCount(n / 2);
                            }}
                            className={`rounded-lg py-2 text-sm font-bold transition disabled:cursor-not-allowed ${on ? t.segOn : t.segOff}`}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>

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
          *Randomness not included. Praise-or-blame calls by{' '}
          <a
            href="https://huggingface.co/convaiinnovations/laya"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 hover:text-rose-500"
          >
            Laya
          </a>
          . Results are final and binding in most households.
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
