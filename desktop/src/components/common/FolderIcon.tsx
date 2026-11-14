interface FolderIconProps {
  className?: string;
  size?: number;
}

export function FolderIcon({ className = "", size = 64 }: FolderIconProps) {
  return (
    <svg
      width={size}
      height={Math.round(size * 0.82)}
      viewBox="0 0 100 82"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`transition-transform duration-200 group-hover:scale-105 select-none ${className}`}
    >
      <defs>
        {/* Back folder gradient */}
        <linearGradient id="macFolderBack" x1="0" y1="0" x2="100" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>

        {/* Front folder body gradient (macOS Sky Blue) */}
        <linearGradient id="macFolderFront" x1="0" y1="20" x2="100" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="25%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>

        {/* Top glossy rim highlight */}
        <linearGradient id="macFolderRim" x1="0" y1="22" x2="100" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#93c5fd" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.3" />
        </linearGradient>

        {/* Drop shadow */}
        <filter id="macFolderShadow" x="-10%" y="10%" width="120%" height="100%">
          <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#000000" floodOpacity="0.22" />
        </filter>
      </defs>

      {/* Back flap with rounded tab */}
      <path
        d="M8 12 C8 7.58 11.58 4 16 4 L38 4 C41.5 4 44.5 5.8 46.2 8.8 L49.5 14 L84 14 C88.42 14 92 17.58 92 22 L92 34 L8 34 Z"
        fill="url(#macFolderBack)"
      />

      {/* Front folder main body */}
      <rect
        x="6"
        y="20"
        width="88"
        height="58"
        rx="9"
        fill="url(#macFolderFront)"
        filter="url(#macFolderShadow)"
      />

      {/* Glossy top edge highlight */}
      <rect
        x="8"
        y="21"
        width="84"
        height="2.5"
        rx="1.25"
        fill="url(#macFolderRim)"
      />

      {/* Subtle macOS folder center groove / embossed curve */}
      <path
        d="M10 24 C30 22 70 22 90 24"
        stroke="#ffffff"
        strokeWidth="0.75"
        strokeOpacity="0.3"
      />
    </svg>
  );
}

export default FolderIcon;
