// The vegetable basket from the original landing page.
export function Basket({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 260" role="img" aria-label="A basket of vegetables" className={className}>
      <rect x="105" y="125" width="22" height="60" fill="#7cb342" />
      <circle cx="90" cy="120" r="24" fill="#388e3c" />
      <circle cx="116" cy="98" r="28" fill="#43a047" />
      <circle cx="142" cy="120" r="24" fill="#388e3c" />
      <circle cx="195" cy="145" r="32" fill="#e53935" />
      <polygon points="195,108 201,120 215,118 205,128 195,124 185,128 175,118 189,120" fill="#43a047" />
      <g>
        <polygon points="245,90 285,90 265,180" fill="#fb8c00" />
        <ellipse cx="255" cy="80" rx="7" ry="16" fill="#66bb6a" />
        <ellipse cx="265" cy="74" rx="7" ry="18" fill="#7cb342" />
        <ellipse cx="275" cy="80" rx="7" ry="16" fill="#66bb6a" />
      </g>
      <g transform="rotate(14 300 130)">
        <polygon points="285,95 325,95 305,185" fill="#f57c00" />
        <ellipse cx="295" cy="85" rx="7" ry="16" fill="#66bb6a" />
        <ellipse cx="305" cy="79" rx="7" ry="18" fill="#7cb342" />
        <ellipse cx="315" cy="85" rx="7" ry="16" fill="#66bb6a" />
      </g>
      <rect x="320" y="125" width="42" height="58" rx="19" fill="#fdd835" />
      <rect x="338" y="113" width="8" height="14" fill="#558b2f" />
      <rect x="55" y="170" width="310" height="72" rx="14" fill="#c68b4e" />
      <rect x="55" y="170" width="310" height="12" rx="6" fill="#a8703a" />
      <line x1="55" y1="200" x2="365" y2="200" stroke="#a8703a" strokeWidth="3" />
      <line x1="55" y1="222" x2="365" y2="222" stroke="#a8703a" strokeWidth="3" />
    </svg>
  );
}
