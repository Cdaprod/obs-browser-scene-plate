import { useState, useRef, useEffect, useCallback } from "react";

// ─── Particle burst on select ─────────────────────────────────────────────────

function Particles({ trigger, deselect }) {
const [bursts, setBursts] = useState([]);
const idRef = useRef(0);

useEffect(() => {
if (!trigger) return;
const id = idRef.current++;
const count = 7;
const particles = Array.from({ length: count }, (_, i) => ({
id: `${id}-${i}`,
angle: (360 / count) * i + Math.random() * 20 - 10,
dist: 18 + Math.random() * 10,
size: 2.5 + Math.random() * 2,
delay: Math.random() * 40,
color: deselect
? `hsl(${200 + Math.random() * 30},30%,55%)`
: ["#00e5c0", "#00ffd5", "#7fffd4", "#40ffe8"][Math.floor(Math.random() * 4)],
}));
setBursts((b) => […b, { id, particles }]);
const t = setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 600);
return () => clearTimeout(t);
}, [trigger]);

return (
<div className="particles" aria-hidden>
{bursts.map((burst) =>
burst.particles.map((p) => (
<span
key={p.id}
className="particle"
style={{
"–angle": `${p.angle}deg`,
"–dist": `${p.dist}px`,
"–size": `${p.size}px`,
"–delay": `${p.delay}ms`,
"–color": p.color,
}}
/>
))
)}
</div>
);
}

// ─── Slot-machine digit ───────────────────────────────────────────────────────

function SlotDigit({ value, prevValue }) {
const [displayValue, setDisplayValue] = useState(value);
const [animState, setAnimState] = useState("idle"); // idle | exit | enter
const isFirst = useRef(true);

useEffect(() => {
if (isFirst.current) { isFirst.current = false; return; }
if (value === prevValue) return;
setAnimState("exit");
const t1 = setTimeout(() => {
setDisplayValue(value);
setAnimState("enter");
}, 110);
const t2 = setTimeout(() => setAnimState("idle"), 230);
return () => { clearTimeout(t1); clearTimeout(t2); };
}, [value]);

return (
<span
className={`slot-digit slot-digit--${animState}`}
style={{ "–dir": value > prevValue ? "1" : "-1" }}
>
{displayValue}
</span>
);
}

// ─── Border draw SVG overlay ──────────────────────────────────────────────────

function BorderDraw({ selected, radius = 9 }) {
const ref = useRef(null);
const [dims, setDims] = useState({ w: 0, h: 0 });

useEffect(() => {
const el = ref.current?.parentElement;
if (!el) return;
const ro = new ResizeObserver(([e]) => {
setDims({ w: e.contentRect.width, h: e.contentRect.height });
});
ro.observe(el);
return () => ro.disconnect();
}, []);

const { w, h } = dims;
if (!w || !h) return <svg ref={ref} className="border-draw" />;

// Perimeter of rounded rect approximation
const perimeter = 2 * (w + h) - (8 - 2 * Math.PI) * radius;

return (
<svg
ref={ref}
className={`border-draw ${selected ? "border-draw--sel" : ""}`}
viewBox={`0 0 ${w} ${h}`}
style={{ "–perim": perimeter }}
>
<rect
className="border-draw__rect"
x="1.5" y="1.5"
width={w - 3} height={h - 3}
rx={radius} ry={radius}
strokeDasharray={perimeter}
strokeDashoffset={perimeter}
/>
</svg>
);
}

// ─── Counter ticker ───────────────────────────────────────────────────────────

function CountTicker({ count }) {
const prev = useRef(count);
const [key, setKey] = useState(0);
const [dir, setDir] = useState(1);

useEffect(() => {
if (count !== prev.current) {
setDir(count > prev.current ? 1 : -1);
setKey((k) => k + 1);
prev.current = count;
}
}, [count]);

return (
<span className="ticker-wrap">
<span key={key} className="ticker-num" style={{ "–dir": dir }}>
{count}
</span>
</span>
);
}

// ─── SelectionBadge ──────────────────────────────────────────────────────────

function SelectionBadge({ order, prevOrder, onChange, size = 28 }) {
const selected = order > 0;
const wasSelected = prevOrder > 0;
const justSelected = selected && !wasSelected;
const justDeselected = !selected && wasSelected;

const [selectTrigger, setSelectTrigger] = useState(0);
const [deselectTrigger, setDeselectTrigger] = useState(0);

const prevOrderTracked = useRef(order);

useEffect(() => {
if (justSelected) setSelectTrigger((t) => t + 1);
if (justDeselected) setDeselectTrigger((t) => t + 1);
}, [justSelected, justDeselected]);

return (
<button
type="button"
aria-label={selected ? `Selected #${order}` : "Select asset"}
aria-pressed={selected}
onClick={(e) => { e.stopPropagation(); onChange?.(!selected); }}
style={{ "–sz": `${size}px` }}
className={`badge ${selected ? "badge--sel" : ""}`}
>
{/* Particle burst */}
<Particles trigger={selectTrigger} deselect={false} />
<Particles trigger={deselectTrigger} deselect={true} />


  {/* Ring */}
  <svg className="badge__ring" viewBox="0 0 36 36" fill="none">
    <circle className="badge__track" cx="18" cy="18" r="16" strokeWidth="2" />
    <circle
      className="badge__arc"
      cx="18" cy="18" r="16"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeDasharray="100.53"
      strokeDashoffset="100.53"
    />
  </svg>

  {/* Disc */}
  <span className={`badge__disc ${justDeselected ? "badge__disc--out" : ""}`} />

  {/* Slot-machine number */}
  {selected && (
    <SlotDigit value={order} prevValue={prevOrder > 0 ? prevOrder : order} />
  )}
</button>


);
}

// ─── Asset data ───────────────────────────────────────────────────────────────

const HUE_STEPS = [210, 195, 240, 170, 225, 200, 185, 215, 230, 190, 245, 205];
const LABELS = [
"compose-20260323190", "compose-20260323170", "compose-20260323155",
"compose-20260323003", "compose-20260322234", "repro-kid-two-asset",
"compose-17741196760", "compose-20260317214", "compose-17735174480",
"compose-17735163984", "compose-17735160826", "compose-17734425707",
];
const ASSETS = LABELS.map((l, i) => ({ id: i, label: l, hue: HUE_STEPS[i] }));

// ─── Demo ─────────────────────────────────────────────────────────────────────

export default function Demo() {
const [sel, setSel] = useState([]);
const prevSel = useRef([]);

const toggle = (id) => {
setSel((p) => {
prevSel.current = p;
return p.includes(id) ? p.filter((x) => x !== id) : […p, id];
});
};

const orderOf = (arr, id) => { const i = arr.indexOf(id); return i === -1 ? 0 : i + 1; };

const hasSelection = sel.length > 0;

return (
<div className="root" style={{ "–has-sel": hasSelection ? 1 : 0 }}>


  {/* Header */}
  <header className="hdr">
    <span className="hdr__logo">◈ Explorer</span>
    <div className="hdr__right">
      {hasSelection && (
        <span className="hdr__count">
          <CountTicker count={sel.length} />
          <span className="hdr__count-label"> selected</span>
        </span>
      )}
      {hasSelection && (
        <button className="hdr__clear" onClick={() => setSel([])}>× Clear</button>
      )}
    </div>
  </header>

  {/* Grid */}
  <div className="grid">
    {ASSETS.map((a, gridIdx) => {
      const order = orderOf(sel, a.id);
      const prev  = orderOf(prevSel.current, a.id);
      const isSel = order > 0;

      return (
        <div
          key={a.id}
          className={`card ${isSel ? "card--sel" : ""} ${hasSelection && !isSel ? "card--dim" : ""}`}
          style={{
            background: `linear-gradient(145deg,
              hsl(${a.hue},38%,14%) 0%,
              hsl(${a.hue + 15},28%,10%) 100%)`,
            animationDelay: `${gridIdx * 30}ms`,
            "--scale-boost": isSel ? "1.025" : "1",
          }}
          onClick={() => toggle(a.id)}
        >
          <div className="card__noise" />

          {/* SVG border draw */}
          <BorderDraw selected={isSel} />

          {/* Glow pulse overlay (selected only) */}
          {isSel && <div className="card__glow-pulse" />}

          <div className="card__badge">
            <SelectionBadge
              order={order}
              prevOrder={prev}
              onChange={() => toggle(a.id)}
            />
          </div>

          <div className="card__foot">
            <span className="card__tag">video</span>
            <span className="card__name">{a.label}…</span>
          </div>
        </div>
      );
    })}
  </div>

  {/* Bottom action bar */}
  {hasSelection && (
    <div className="bar">
      <span className="bar__count">
        <CountTicker count={sel.length} /> selected
      </span>
      <button className="bar__action">▶ Preview</button>
      <button className="bar__action">⇢ Resolve</button>
      <button className="bar__action">🏷 Tag</button>
      <button className="bar__action bar__action--del" onClick={() => setSel([])}>
        🗑 Delete
      </button>
    </div>
  )}

  <style>{`
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      min-height: 100vh;
      background: #090d12;
      padding: 16px;
      font-family: ui-rounded, 'SF Pro Text', -apple-system, system-ui, sans-serif;
      padding-bottom: var(--has-sel, 0) * 1px;
      padding-bottom: calc(var(--has-sel, 0) * 68px + 16px);
    }

    /* ── Header ────────────────────────────────────────────────── */
    .hdr {
      display: flex; align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .hdr__logo { font-size: 16px; font-weight: 700; color: #fff; letter-spacing: -0.03em; }
    .hdr__right { display: flex; align-items: center; gap: 10px; }
    .hdr__count {
      display: flex; align-items: baseline; gap: 2px;
      font-size: 12px; font-weight: 600; color: #00e5c0;
      overflow: hidden;
    }
    .hdr__count-label { font-weight: 400; color: rgba(255,255,255,0.5); }
    .hdr__clear {
      font-size: 12px; color: rgba(255,255,255,0.5);
      background: rgba(255,255,255,0.07);
      border: none; border-radius: 20px; padding: 4px 11px;
      cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .hdr__clear:hover { background: rgba(255,255,255,0.13); color: #fff; }

    /* ── Ticker ─────────────────────────────────────────────────── */
    .ticker-wrap {
      display: inline-block; overflow: hidden;
      height: 1.2em; line-height: 1.2em; vertical-align: bottom;
    }
    .ticker-num {
      display: block;
      animation: ticker-in 0.2s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    @keyframes ticker-in {
      from { transform: translateY(calc(var(--dir, 1) * -100%)); opacity: 0; }
      to   { transform: translateY(0); opacity: 1; }
    }

    /* ── Grid ───────────────────────────────────────────────────── */
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }
    @media (min-width: 600px) {
      .grid { grid-template-columns: repeat(5, 1fr); }
    }

    /* ── Card ───────────────────────────────────────────────────── */
    .card {
      position: relative;
      aspect-ratio: 9/11;
      border-radius: 9px;
      overflow: hidden;
      cursor: pointer;
      transition:
        transform     0.22s cubic-bezier(0.34,1.56,0.64,1),
        filter        0.25s ease,
        box-shadow    0.22s ease;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      transform: scale(var(--scale-boost, 1));
    }
    .card:active { transform: scale(0.95) !important; transition-duration: 0.08s; }

    /* dim unselected when any selection active */
    .card--dim {
      filter: brightness(0.55) saturate(0.5);
    }

    /* selected card gets brightness lift */
    .card--sel {
      filter: brightness(1.12) saturate(1.1);
      box-shadow: 0 4px 24px -6px rgba(0,229,192,0.3);
      z-index: 2;
    }

    /* teal corner shimmer */
    .card--sel::after {
      content: '';
      position: absolute; inset: 0;
      background: linear-gradient(135deg, rgba(0,229,192,0.08) 0%, transparent 55%);
      pointer-events: none;
      border-radius: inherit;
    }

    .card__noise {
      position: absolute; inset: 0; opacity: 0.3;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size: 180px;
    }

    /* glow pulse */
    .card__glow-pulse {
      position: absolute; inset: 0;
      border-radius: inherit;
      pointer-events: none;
      box-shadow: inset 0 0 0 1.5px rgba(0,229,192,0.6);
      animation: glow-breathe 2.4s ease-in-out infinite;
    }
    @keyframes glow-breathe {
      0%,100% { opacity: 0.5; }
      50%      { opacity: 1; }
    }

    .card__badge {
      position: absolute; top: 6px; right: 6px; z-index: 10;
    }

    .card__foot {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 22px 7px 7px;
      background: linear-gradient(transparent, rgba(0,0,0,0.72));
    }
    .card__tag {
      display: block; font-size: 9px; font-weight: 600;
      color: rgba(255,255,255,0.55); text-transform: uppercase;
      letter-spacing: 0.06em; margin-bottom: 2px;
    }
    .card__name {
      display: block; font-size: 10px; color: rgba(255,255,255,0.8);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-weight: 500;
    }

    /* ── Border draw SVG ────────────────────────────────────────── */
    .border-draw {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 5;
      overflow: visible;
    }
    .border-draw__rect {
      fill: none;
      stroke: #00e5c0;
      stroke-width: 2;
      transition: stroke-dashoffset 0.45s cubic-bezier(0.65,0,0.35,1), opacity 0.2s ease;
      opacity: 0;
    }
    .border-draw--sel .border-draw__rect {
      stroke-dashoffset: 0 !important;
      opacity: 1;
    }

    /* ── Badge ──────────────────────────────────────────────────── */
    .badge {
      --sz: 28px;
      position: relative;
      width: var(--sz); height: var(--sz);
      border: none; background: transparent; padding: 0;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      -webkit-tap-highlight-color: transparent;
      outline: none; border-radius: 50%;
    }
    .badge__ring {
      position: absolute; inset: 0; width: 100%; height: 100%;
      overflow: visible;
      transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1);
    }
    .badge:hover .badge__ring { transform: scale(1.1); }
    .badge:active .badge__ring { transform: scale(0.84); transition-duration: 0.07s; }

    .badge__track {
      stroke: rgba(255,255,255,0.35);
      transition: stroke 0.18s ease;
    }
    .badge--sel .badge__track { stroke: transparent; }

    .badge__arc {
      stroke: #00e5c0;
      transform-origin: 18px 18px;
      transform: rotate(-90deg);
      opacity: 0;
      transition: stroke-dashoffset 0.30s cubic-bezier(0.65,0,0.35,1), opacity 0.08s ease;
    }
    .badge--sel .badge__arc { stroke-dashoffset: 0 !important; opacity: 1; }

    .badge__disc {
      position: absolute; inset: 13%; border-radius: 50%;
      background: #00e5c0;
      transform: scale(0); opacity: 0;
      transition:
        transform 0.24s cubic-bezier(0.34,1.56,0.64,1),
        opacity   0.16s ease;
    }
    .badge--sel .badge__disc { transform: scale(1); opacity: 1; }
    .badge__disc--out {
      animation: disc-out 0.22s cubic-bezier(0.55,0,1,0.45) forwards !important;
    }
    @keyframes disc-out {
      from { transform: scale(1); opacity: 1; }
      to   { transform: scale(0) rotate(20deg); opacity: 0; }
    }

    /* ── Slot digit ─────────────────────────────────────────────── */
    .slot-digit {
      position: relative; z-index: 2;
      font-size: calc(var(--sz, 28px) * 0.43);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: #04111a;
      line-height: 1;
      letter-spacing: -0.02em;
      display: block;
      overflow: hidden;
    }
    .slot-digit--idle {
      animation: num-in 0.22s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    .slot-digit--exit {
      animation: slot-exit 0.11s ease-in forwards;
    }
    .slot-digit--enter {
      animation: slot-enter 0.14s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    @keyframes num-in {
      from { transform: scale(0.3) rotate(-15deg); opacity: 0; }
      to   { transform: scale(1) rotate(0deg); opacity: 1; }
    }
    @keyframes slot-exit {
      from { transform: translateY(0) scale(1); opacity: 1; }
      to   { transform: translateY(calc(var(--dir,1) * -8px)) scale(0.7); opacity: 0; }
    }
    @keyframes slot-enter {
      from { transform: translateY(calc(var(--dir,1) * 8px)) scale(0.7); opacity: 0; }
      to   { transform: translateY(0) scale(1); opacity: 1; }
    }

    /* ── Particles ──────────────────────────────────────────────── */
    .particles {
      position: absolute; inset: 0;
      pointer-events: none; z-index: 20;
      display: flex; align-items: center; justify-content: center;
    }
    .particle {
      position: absolute;
      width: var(--size, 3px); height: var(--size, 3px);
      border-radius: 50%;
      background: var(--color, #00e5c0);
      animation: particle-fly 0.55s calc(var(--delay, 0ms)) cubic-bezier(0,0.9,0.57,1) both;
    }
    @keyframes particle-fly {
      0%   { transform: rotate(var(--angle)) translateX(0)      scale(1);   opacity: 1; }
      60%  { opacity: 1; }
      100% { transform: rotate(var(--angle)) translateX(var(--dist)) scale(0); opacity: 0; }
    }

    /* ── Bottom bar ─────────────────────────────────────────────── */
    .bar {
      position: fixed; bottom: 12px; left: 12px; right: 12px;
      background: rgba(14,20,28,0.94);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 10px 14px;
      display: flex; align-items: center; gap: 8px;
      animation: bar-in 0.24s cubic-bezier(0.34,1.56,0.64,1) both;
      z-index: 100;
    }
    @keyframes bar-in {
      from { transform: translateY(32px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .bar__count {
      display: flex; align-items: baseline; gap: 4px;
      font-size: 12px; font-weight: 600; color: #00e5c0;
      margin-right: 2px; white-space: nowrap; overflow: hidden;
    }
    .bar__action {
      font-size: 12px; font-weight: 500;
      color: rgba(255,255,255,0.8);
      background: rgba(255,255,255,0.09);
      border: none; border-radius: 20px; padding: 5px 11px;
      cursor: pointer; white-space: nowrap;
      transition: background 0.13s, color 0.13s;
    }
    .bar__action:hover { background: rgba(255,255,255,0.16); color: #fff; }
    .bar__action--del {
      color: rgba(255,90,90,0.85);
      background: rgba(255,60,60,0.1);
      margin-left: auto;
    }
    .bar__action--del:hover { background: rgba(255,60,60,0.2); color: #ff5a5a; }
  `}</style>
</div>


);
}