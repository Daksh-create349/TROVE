import React, { useState, useEffect } from "react";

interface WindowsWindowControlsProps {
  className?: string;
}

export function WindowsWindowControls({ className = "" }: WindowsWindowControlsProps) {
  const isMac = typeof window !== "undefined" && window.televault?.platform === "darwin";
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (isMac || typeof window === "undefined" || !window.televault?.window) return;

    // Check initial window state
    window.televault.window.isMaximized().then((max) => {
      setIsMaximized(Boolean(max));
    }).catch(() => {});

    // Listen for window state changes (maximize/unmaximize)
    if (window.televault.window.onMaximizedChange) {
      const unsubscribe = window.televault.window.onMaximizedChange((max) => {
        setIsMaximized(max);
      });
      return unsubscribe;
    }
  }, [isMac]);

  // On macOS, native traffic light buttons are rendered on the top-left; do NOT render anything here
  if (isMac) {
    return null;
  }

  const handleMinimize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.televault?.window.minimize();
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await window.televault?.window.maximize();
    const state = await window.televault?.window.isMaximized();
    if (typeof state === "boolean") {
      setIsMaximized(state);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.televault?.window.close();
  };

  return (
    <div
      className={`flex items-center h-full app-no-drag select-none z-50 ${className}`}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      role="region"
      aria-label="Window management controls"
    >
      {/* Minimize Button */}
      <button
        type="button"
        onClick={handleMinimize}
        title="Minimize"
        aria-label="Minimize"
        className="flex h-full w-11 items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/80 dark:hover:bg-white/10 active:bg-slate-300 dark:active:bg-white/15 hover:text-slate-900 dark:hover:text-white transition-colors duration-150 focus:outline-none cursor-pointer"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" className="pointer-events-none fill-current">
          <rect width="10" height="1" />
        </svg>
      </button>

      {/* Maximize / Restore Button */}
      <button
        type="button"
        onClick={handleMaximize}
        title={isMaximized ? "Restore" : "Maximize"}
        aria-label={isMaximized ? "Restore" : "Maximize"}
        className="flex h-full w-11 items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/80 dark:hover:bg-white/10 active:bg-slate-300 dark:active:bg-white/15 hover:text-slate-900 dark:hover:text-white transition-colors duration-150 focus:outline-none cursor-pointer"
      >
        {isMaximized ? (
          /* Windows Restore Icon (overlapping squares) */
          <svg width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none text-current" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M2.5 0.5h7v7h-7z" />
            <path d="M0.5 2.5h7v7h-7z" />
          </svg>
        ) : (
          /* Windows Maximize Icon (single square) */
          <svg width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none text-current" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>

      {/* Close Button - Authentic Windows Red hover (#e81123) */}
      <button
        type="button"
        onClick={handleClose}
        title="Close"
        aria-label="Close"
        className="flex h-full w-11 items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-[#e81123] hover:text-white active:bg-[#c4101f] active:text-white transition-colors duration-150 focus:outline-none cursor-pointer"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  );
}
