import { useState, useRef, useEffect } from "react";

// ─── SelectionBadge ──────────────────────────────────────────────────────────

function SelectionBadge({ order, onChange, size = 28 }) {
const selected = order > 0;
const prevOrder = useRef(order);
const [numKey, setNumKey] = useState(0);

useEffect(() => {
if (order !== prevOrder.current) {
setNumKey((k) => k + 1);
prevOrder.current = order;
}
}, [order]);

return (
<button
type="button"
aria-label={selected ? `Selected #${order}` : "Select asset"}
aria-pressed={selected}
onClick={(e) => { e.stopPropagation(); onChange?.(!selected); }}
style={{ "–sz": `${size}px` }}
className={`badge ${selected ? "badge--sel" : ""}`}
>
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
<span className="badge__disc" />
{selected && (
<span key={numKey} className="badge__num">{order}</span>
)}
</button>
);
}

// ─── Mock asset data ──────────────────────────────────────────────────────────

const HUE_STEPS = [210,195,240,170,225,200,185,215,230,190,245,205];
const LABELS = [
"compose-20260323190","compose-20260323170","compose-20260323155",
"compose-20260323003","compose-20260322234","repro-kid-two-asset",
"compose-17741196760","compose-20260317214","compose-17735174480",
"compose-17735163984","compose-17735160826","compose-17734425707",
];
const ASSETS = LABELS.map((l, i) => ({ id: i, label: l, hue: HUE_STEPS[i] }));

// ─── Demo ─────────────────────────────────────────────────────────────────────

export default function Demo() {
const [sel, setSel] = useState([]);

const toggle = (id) =>
setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : […p, id]));

const orderOf = (id) => { const i = sel.indexOf(id); return i === -1 ? 0 : i + 1; };

return (
<div className="root">
{/* Header */}
<header className="hdr">
<span className="hdr__logo">◈ Explorer</span>
<div className="hdr__right">
{sel.length > 0 && (
<span className="hdr__count">{sel.length} selected</span>
)}
{sel.length > 0 && (
<button className="hdr__clear" onClick={() => setSel([])}>
× Clear
</button>
)}
</div>
</header>


  {/* Grid */}
  <div className="grid">
    {ASSETS.map((a) => {
      const isSel = orderOf(a.id) > 0;
      return (
        <div
          key={a.id}
          className={`card ${isSel ? "card--sel" : ""}`}
          style={{
            background: `linear-gradient(145deg,
              hsl(${a.hue},38%,14%) 0%,
              hsl(${a.hue + 15},28%,10%) 100%)`,
          }}
          onClick={() => toggle(a.id)}
        >
          {/* fake thumbnail noise */}
          <div className="card__noise" />
          <div className="card__badge">
            <SelectionBadge
              order={orderOf(a.id)}
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
  {sel.length > 0 && (
    <div className="bar">
      <span className="bar__count">{sel.length} selected</span>
      <button className="bar__action">▶ Preview</button>
      <button className="bar__action">⇢ Resolve</button>
      <button className="bar__action">🏷 Tag</button>
      <button className="bar__action bar__action--del">🗑 Delete</button>
    </div>
  )}

  <style>{`
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      min-height: 100vh;
      background: #090d12;
      padding: 16px;
      font-family: ui-rounded, 'SF Pro Text', -apple-system, system-ui, sans-serif;
      padding-bottom: ${sel.length > 0 ? "80px" : "16px"};
    }

    /* Header */
    .hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .hdr__logo {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.03em;
    }
    .hdr__right { display: flex; align-items: center; gap: 10px; }
    .hdr__count {
      font-size: 12px;
      font-weight: 600;
      color: #00e5c0;
      animation: fadein 0.2s ease;
    }
    .hdr__clear {
      font-size: 12px;
      color: rgba(255,255,255,0.5);
      background: rgba(255,255,255,0.07);
      border: none;
      border-radius: 20px;
      padding: 4px 11px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .hdr__clear:hover { background: rgba(255,255,255,0.13); color: #fff; }

    /* Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }
    @media (min-width: 600px) {
      .grid { grid-template-columns: repeat(5, 1fr); }
    }

    /* Card */
    .card {
      position: relative;
      aspect-ratio: 9/11;
      border-radius: 9px;
      overflow: hidden;
      cursor: pointer;
      outline: 2px solid transparent;
      outline-offset: -2px;
      transition:
        outline-color 0.18s ease,
        box-shadow    0.2s  ease,
        transform     0.11s ease;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    .card:active { transform: scale(0.96); }
    .card--sel {
      outline-color: #00e5c0;
      box-shadow:
        0 0 0 1px #00e5c0 inset,
        0 0 20px -6px rgba(0,229,192,0.4);
    }
    /* subtle shimmer on selected */
    .card--sel::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg,
        rgba(0,229,192,0.06) 0%,
        transparent 60%);
      pointer-events: none;
      border-radius: inherit;
    }

    .card__noise {
      position: absolute;
      inset: 0;
      opacity: 0.35;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size: 180px;
    }

    .card__badge {
      position: absolute;
      top: 6px;
      right: 6px;
      z-index: 10;
    }

    .card__foot {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      padding: 22px 7px 7px;
      background: linear-gradient(transparent, rgba(0,0,0,0.72));
    }
    .card__tag {
      display: block;
      font-size: 9px;
      font-weight: 600;
      color: rgba(255,255,255,0.55);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 2px;
    }
    .card__name {
      display: block;
      font-size: 10px;
      color: rgba(255,255,255,0.8);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    }

    /* ── Badge ──────────────────────────────────────────────────── */
    .badge {
      --sz: 28px;
      position: relative;
      width: var(--sz);
      height: var(--sz);
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
      outline: none;
      border-radius: 50%;
    }

    .badge__ring {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1);
    }
    .badge:hover .badge__ring { transform: scale(1.1); }
    .badge:active .badge__ring { transform: scale(0.86); transition-duration: 0.07s; }

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
      transition:
        stroke-dashoffset 0.30s cubic-bezier(0.65,0,0.35,1),
        opacity 0.08s ease;
    }
    .badge--sel .badge__arc {
      stroke-dashoffset: 0 !important;
      opacity: 1;
    }

    .badge__disc {
      position: absolute;
      inset: 13%;
      border-radius: 50%;
      background: #00e5c0;
      transform: scale(0);
      opacity: 0;
      transition:
        transform 0.24s cubic-bezier(0.34,1.56,0.64,1),
        opacity   0.16s ease;
    }
    .badge--sel .badge__disc {
      transform: scale(1);
      opacity: 1;
    }

    .badge__num {
      position: relative;
      z-index: 2;
      font-size: calc(var(--sz) * 0.43);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: #04111a;
      line-height: 1;
      letter-spacing: -0.02em;
      animation: num-in 0.22s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    @keyframes num-in {
      from { transform: scale(0.3) rotate(-15deg); opacity: 0; }
      to   { transform: scale(1)   rotate(0deg);   opacity: 1; }
    }

    /* Bottom bar */
    .bar {
      position: fixed;
      bottom: 12px;
      left: 12px;
      right: 12px;
      background: rgba(18,24,32,0.92);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: bar-in 0.22s cubic-bezier(0.34,1.56,0.64,1) both;
      z-index: 100;
    }
    @keyframes bar-in {
      from { transform: translateY(30px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .bar__count {
      font-size: 12px;
      font-weight: 600;
      color: #00e5c0;
      margin-right: 2px;
      white-space: nowrap;
    }
    .bar__action {
      font-size: 12px;
      font-weight: 500;
      color: rgba(255,255,255,0.8);
      background: rgba(255,255,255,0.09);
      border: none;
      border-radius: 20px;
      padding: 5px 11px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.13s, color 0.13s;
    }
    .bar__action:hover { background: rgba(255,255,255,0.16); color: #fff; }
    .bar__action--del {
      color: rgba(255,90,90,0.85);
      background: rgba(255,60,60,0.1);
      margin-left: auto;
    }
    .bar__action--del:hover { background: rgba(255,60,60,0.2); color: #ff5a5a; }

    @keyframes fadein { from { opacity:0; } to { opacity:1; } }
  `}</style>
</div>


);
}