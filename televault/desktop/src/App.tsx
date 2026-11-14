import { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";
import { useApp } from "./context/AppContext";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Header } from "./components/header/Header";
import { HeaderStats } from "./components/stats/HeaderStats";
import { OverviewView } from "./components/overview/OverviewView";
import { FileManager } from "./components/files/FileManager";
import { FilePreviewModal } from "./components/preview/FilePreviewModal";
import { TransfersDrawer } from "./components/transfers/TransfersDrawer";
import { SetupWizard } from "./components/setup/SetupWizard";
import { SettingsModal } from "./components/settings/SettingsModal";
import { UnlockScreen } from "./components/unlock/UnlockScreen";
import { ToastContainer } from "./components/common/Toast";
import { TroveOnboarding } from "./components/onboarding/TroveOnboarding";
import { TroveLogo } from "./components/common/Logo";

export function App() {
  const { isLocked } = useAuth();
  const { activeView, telegramStatus, refreshAll } = useApp();
  const [hasTimedOut, setHasTimedOut] = useState(false);

  // Apply saved theme preference on load
  useEffect(() => {
    const savedTheme = localStorage.getItem("trove_theme") || "light";
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // Quick fallback so splash does not hang if backend takes a moment to boot
  useEffect(() => {
    const timer = setTimeout(() => setHasTimedOut(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const [onboardingFinished, setOnboardingFinished] = useState<boolean>(() => {
    return localStorage.getItem("trove_onboarded") === "true";
  });

  // Single Source of Truth: An account is ready when a Telegram session is stored in SQLite
  const isAccountReady = Boolean(telegramStatus?.sessionStored && telegramStatus?.account);

  // Show onboarding walkthrough if not finished AND no account is ready in SQLite
  const showOnboarding = !onboardingFinished && !isAccountReady;

  // Initial loading splash while querying Telegram connection state
  if (telegramStatus === null && !hasTimedOut && !onboardingFinished) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#f8fafc] dark:bg-[#07090e] select-none transition-colors">
        <div className="flex flex-col items-center gap-3 animate-in fade-in duration-200">
          <TroveLogo size={56} className="animate-pulse" />
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider">
            Loading Trove...
          </span>
        </div>
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <>
        <TroveOnboarding
          onComplete={async () => {
            setOnboardingFinished(true);
            localStorage.setItem("trove_onboarded", "true");
            await refreshAll().catch(() => null);
          }}
        />
        <ToastContainer />
      </>
    );
  }

  // If locked with a master password, render unlock screen
  if (isLocked) {
    return <UnlockScreen />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-vault-bg text-slate-800 dark:text-vault-text select-none animate-in fade-in duration-500 transition-colors">
      {/* Primary Sidebar */}
      <Sidebar />

      {/* Main App Container */}
      <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        {/* Titlebar / Header Navigation with working window controls */}
        <Header />

        {/* Real Backend Statistics Bar */}
        <HeaderStats />

        {/* Dynamic View Area */}
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative bg-slate-50/50 dark:bg-[#0b0c10] transition-colors">
          {activeView === "overview" ? <OverviewView /> : <FileManager />}
        </main>
      </div>

      {/* Modals & Overlays */}
      <FilePreviewModal />
      <TransfersDrawer />
      <SetupWizard />
      <SettingsModal />
      <ToastContainer />
    </div>
  );
}

export default App;
