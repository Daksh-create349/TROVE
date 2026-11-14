import { getFileCategory, type FileCategory } from "../../utils/formatters";

interface FileIconProps {
  mimeType?: string;
  filename?: string;
  size?: number;
  className?: string;
}

export function FileIcon({
  mimeType = "",
  filename = "",
  size = 56,
  className = "",
}: FileIconProps) {
  const category: FileCategory = getFileCategory(mimeType, filename);
  const ext = filename.split(".").pop()?.toUpperCase() || "";

  // macOS Document dimensions ratio: 56 wide x 70 high (0.8 ratio)
  const width = size;
  const height = Math.round(size * 1.25);

  const getMacTheme = () => {
    switch (category) {
      case "image":
        return {
          badgeText: ext || "IMG",
          badgeBg: "#9333ea",
          badgeTextColor: "#ffffff",
          accentColor: "#a855f7",
          type: "image" as const,
        };
      case "video":
        return {
          badgeText: ext || "MOV",
          badgeBg: "#e11d48",
          badgeTextColor: "#ffffff",
          accentColor: "#f43f5e",
          type: "video" as const,
        };
      case "audio":
        return {
          badgeText: ext || "MP3",
          badgeBg: "#ea580c",
          badgeTextColor: "#ffffff",
          accentColor: "#f97316",
          type: "audio" as const,
        };
      case "code":
        return {
          badgeText: ext || "CODE",
          badgeBg: "#0284c7",
          badgeTextColor: "#ffffff",
          accentColor: "#38bdf8",
          type: "code" as const,
        };
      case "archive":
        return {
          badgeText: ext || "ZIP",
          badgeBg: "#d97706",
          badgeTextColor: "#ffffff",
          accentColor: "#f59e0b",
          type: "archive" as const,
        };
      case "document":
        if (ext === "PDF") {
          return {
            badgeText: "PDF",
            badgeBg: "#dc2626",
            badgeTextColor: "#ffffff",
            accentColor: "#ef4444",
            type: "pdf" as const,
          };
        }
        return {
          badgeText: ext || "DOC",
          badgeBg: "#2563eb",
          badgeTextColor: "#ffffff",
          accentColor: "#3b82f6",
          type: "doc" as const,
        };
      default:
        return {
          badgeText: ext || "FILE",
          badgeBg: "#64748b",
          badgeTextColor: "#ffffff",
          accentColor: "#94a3b8",
          type: "file" as const,
        };
    }
  };

  const theme = getMacTheme();

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 64 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-[0_4px_10px_rgba(0,0,0,0.18)] transition-transform duration-200 group-hover:scale-105 select-none ${className}`}
    >
      <defs>
        {/* Paper Surface Gradient (macOS Clean Document) */}
        <linearGradient id={`docBase-${category}`} x1="0" y1="0" x2="64" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f1f5f9" />
        </linearGradient>

        {/* Fold Flap Shadow */}
        <linearGradient id={`flapShadow-${category}`} x1="44" y1="0" x2="44" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.05" />
        </linearGradient>

        {/* Folded Corner Flap */}
        <linearGradient id={`flapGradient-${category}`} x1="44" y1="0" x2="64" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="50%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>

        {/* Subtle drop shadow under the document page */}
        <filter id="macDocShadow" x="-10%" y="-5%" width="125%" height="115%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000000" floodOpacity="0.16" />
        </filter>
      </defs>

      {/* Main Document Body with Clipped Top-Right Corner */}
      <path
        d="M8 2 C4.686 2 2 4.686 2 8 L2 72 C2 75.314 4.686 78 8 78 L56 78 C59.314 78 62 75.314 62 72 L62 20 L44 2 Z"
        fill={`url(#docBase-${category})`}
        stroke="#cbd5e1"
        strokeWidth="1"
        filter="url(#macDocShadow)"
      />

      {/* Folded Corner Under-shadow */}
      <path
        d="M44 2 L44 18 A 2 2 0 0 0 46 20 L62 20 Z"
        fill={`url(#flapShadow-${category})`}
      />

      {/* 3D Folded Corner Flap */}
      <path
        d="M44 2 L44 17 C44 18.657 45.343 20 47 20 L62 20 Z"
        fill={`url(#flapGradient-${category})`}
        stroke="#94a3b8"
        strokeWidth="0.75"
      />

      {/* Realistic Ruled Text Lines on Top Half */}
      <rect x="10" y="16" width="26" height="2.5" rx="1.25" fill="#e2e8f0" />
      <rect x="10" y="24" width="44" height="2.5" rx="1.25" fill="#e2e8f0" />
      <rect x="10" y="32" width="44" height="2.5" rx="1.25" fill="#e2e8f0" />
      <rect x="10" y="40" width="36" height="2.5" rx="1.25" fill="#e2e8f0" />

      {/* macOS Centered Icon Graphic based on type */}
      {theme.type === "image" && (
        <g transform="translate(18, 46)">
          <rect width="28" height="20" rx="4" fill="#a855f7" fillOpacity="0.15" stroke="#9333ea" strokeWidth="1" />
          <circle cx="9" cy="7" r="2.5" fill="#9333ea" />
          <path d="M4 17 L12 10 L18 15 L21 12 L24 17 Z" fill="#9333ea" />
        </g>
      )}

      {theme.type === "code" && (
        <g transform="translate(18, 46)">
          <rect width="28" height="20" rx="4" fill="#0284c7" fillOpacity="0.15" stroke="#0284c7" strokeWidth="1" />
          <path d="M10 7 L6 10 L10 13 M18 7 L22 10 L18 13" stroke="#0284c7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="15" y1="6" x2="13" y2="14" stroke="#0284c7" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      )}

      {theme.type === "video" && (
        <g transform="translate(18, 46)">
          <rect width="28" height="20" rx="4" fill="#e11d48" fillOpacity="0.15" stroke="#e11d48" strokeWidth="1" />
          <polygon points="11,7 19,10 11,13" fill="#e11d48" />
        </g>
      )}

      {theme.type === "audio" && (
        <g transform="translate(18, 46)">
          <rect width="28" height="20" rx="4" fill="#ea580c" fillOpacity="0.15" stroke="#ea580c" strokeWidth="1" />
          <path d="M11 13 A 2 2 0 1 0 9 15 L9 8 L17 6 L17 12 A 2 2 0 1 0 15 14" stroke="#ea580c" strokeWidth="1.2" fill="none" />
        </g>
      )}

      {theme.type === "archive" && (
        <g transform="translate(18, 46)">
          <rect width="28" height="20" rx="4" fill="#d97706" fillOpacity="0.15" stroke="#d97706" strokeWidth="1" />
          <line x1="14" y1="2" x2="14" y2="18" stroke="#d97706" strokeWidth="1.5" strokeDasharray="2 1" />
        </g>
      )}

      {(theme.type === "doc" || theme.type === "pdf" || theme.type === "file") && (
        <g transform="translate(18, 46)">
          <rect width="28" height="20" rx="4" fill={theme.badgeBg} fillOpacity="0.15" stroke={theme.badgeBg} strokeWidth="1" />
          <line x1="6" y1="7" x2="22" y2="7" stroke={theme.badgeBg} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="11" x2="18" y2="11" stroke={theme.badgeBg} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="6" y1="15" x2="14" y2="15" stroke={theme.badgeBg} strokeWidth="1.5" strokeLinecap="round" />
        </g>
      )}

      {/* macOS Bottom Tag Badge */}
      <rect
        x="8"
        y="68"
        width="48"
        height="8"
        rx="2"
        fill={theme.badgeBg}
      />
      <text
        x="32"
        y="74.5"
        textAnchor="middle"
        fill={theme.badgeTextColor}
        fontSize="5.5"
        fontWeight="800"
        fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"
        letterSpacing="0.08em"
      >
        {theme.badgeText.slice(0, 5)}
      </text>
    </svg>
  );
}

export default FileIcon;
