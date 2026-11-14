import { useState } from "react";
import {
  X,
  Send,
  Lock,
  HardDrive,
  Info,
  LogOut,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";
import { formatBytes } from "../../utils/formatters";
import { TroveLogo } from "../common/Logo";

type SettingsTab = "telegram" | "security" | "storage" | "about";

export function SettingsModal() {
  const {
    isSettingsOpen,
    closeSettings,
    openSetup,
    telegramStatus,
    telegramProfile,
    storageStats,
    startSync,
    isSyncing,
    refreshTelegram,
    reconnectTelegram,
    isReconnecting,
    addToast,
  } = useApp();

  const { profile, updateProfile, setPassword: setLocalAppPassword } = useAuth();

  const [activeTab, setActiveTab] = useState<SettingsTab>("telegram");
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [newPassword, setNewPassword] = useState("");
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  if (!isSettingsOpen) return null;

  const handleDisconnect = async () => {
    if (!window.televault) return;
    setIsDisconnecting(true);
    try {
      await window.televault.telegram.disconnect();
      await refreshTelegram();
      addToast({
        type: "success",
        title: "Telegram Disconnected",
        message: "Logged out and purged local session safely.",
      });
      closeSettings();
    } catch (err) {
      addToast({
        type: "error",
        title: "Disconnect failed",
        message: (err as Error).message,
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName.trim()) {
      await updateProfile(displayName.trim());
    }
    if (newPassword.trim().length >= 4) {
      await setLocalAppPassword(newPassword.trim());
      setNewPassword("");
      addToast({ type: "success", title: "Local password updated" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="flex h-[75vh] w-full max-w-2xl flex-col rounded-3xl border border-slate-200 dark:border-[#232634] bg-white dark:bg-[#0d0e14] shadow-2xl overflow-hidden text-xs transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#1c1e27] bg-slate-50 dark:bg-[#08090d] px-5 py-3 transition-colors">
          <div className="flex items-center gap-2">
            <TroveLogo size={18} />
            <span className="font-bold text-slate-900 dark:text-white text-xs">Trove Settings</span>
          </div>

          <button
            onClick={closeSettings}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content with Sidebar Tabs */}
        <div className="flex-1 flex overflow-hidden">
          {/* Tabs Sidebar */}
          <div className="w-48 border-r border-slate-200 dark:border-[#1c1e27] bg-slate-50/70 dark:bg-[#090a0e] p-2 space-y-1 transition-colors">
            <button
              onClick={() => setActiveTab("telegram")}
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-medium transition-colors cursor-pointer ${
                activeTab === "telegram"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-[#141620] hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Send className="h-3.5 w-3.5" />
              <span>Telegram Account</span>
            </button>

            <button
              onClick={() => setActiveTab("security")}
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-medium transition-colors cursor-pointer ${
                activeTab === "security"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-[#141620] hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Profile & Security</span>
            </button>

            <button
              onClick={() => setActiveTab("storage")}
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-medium transition-colors cursor-pointer ${
                activeTab === "storage"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-[#141620] hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <HardDrive className="h-3.5 w-3.5" />
              <span>Storage & Sync</span>
            </button>

            <button
              onClick={() => setActiveTab("about")}
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left font-medium transition-colors cursor-pointer ${
                activeTab === "about"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-[#141620] hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Info className="h-3.5 w-3.5" />
              <span>About & System</span>
            </button>
          </div>

          {/* Tab Viewport */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {/* TAB: Telegram Account */}
            {activeTab === "telegram" && (() => {
              const activeAccount =
                telegramProfile ||
                (telegramStatus?.account
                  ? {
                      firstName: telegramStatus.account.firstName || "Telegram User",
                      lastName: telegramStatus.account.lastName || "",
                      username: telegramStatus.account.username || null,
                      id: telegramStatus.account.telegramUserId,
                    }
                  : null);

              const isActuallyConnected = telegramStatus?.state === "connected";
              const hasSavedSession = Boolean(telegramStatus?.sessionStored && activeAccount);

              return (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Telegram Account Integration</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Trove connects directly to your Telegram Saved Messages using secure MTProto protocol.
                  </p>

                  <div className="rounded-2xl border border-slate-200 dark:border-[#1e202a] bg-slate-50/70 dark:bg-[#12141c] p-4 space-y-3 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400 text-xs">Connection State</span>
                      <span
                        className={`inline-flex items-center gap-1.5 font-semibold text-2xs px-2.5 py-0.5 rounded-full ${
                          isActuallyConnected
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : isReconnecting
                            ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                            : hasSavedSession
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-slate-500/15 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        <span className="capitalize">
                          {isActuallyConnected
                            ? "Connected (MTProto Active)"
                            : isReconnecting
                            ? "Connecting..."
                            : hasSavedSession
                            ? "Offline (Session Stored)"
                            : "Not Connected"}
                        </span>
                      </span>
                    </div>

                    {activeAccount && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 dark:text-slate-400 text-xs">Telegram User</span>
                          <span className="font-semibold text-slate-800 dark:text-white">
                            {activeAccount.firstName} {activeAccount.lastName || ""}{" "}
                            {activeAccount.username && `(@${activeAccount.username})`}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 dark:text-slate-400 text-xs">User ID</span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">{activeAccount.id}</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 dark:text-slate-400 text-xs">Target Storage Peer</span>
                          <span className="text-slate-700 dark:text-slate-300 font-medium">Saved Messages (`me`)</span>
                        </div>
                      </>
                    )}
                  </div>

                  {isActuallyConnected ? (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <button
                        onClick={handleDisconnect}
                        disabled={isDisconnecting}
                        className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 font-medium text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>{isDisconnecting ? "Disconnecting..." : "Disconnect Telegram Account"}</span>
                      </button>

                      <button
                        onClick={async () => {
                          await refreshTelegram();
                          addToast({
                            type: "info",
                            title: "Telegram Status Refreshed",
                            message: "Checked MTProto session and connection status.",
                          });
                        }}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-[#272b3a] bg-white dark:bg-[#141722] px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1a1e2c] transition-colors cursor-pointer shadow-xs"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                        <span>Refresh Status</span>
                      </button>
                    </div>
                  ) : hasSavedSession ? (
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <button
                        onClick={async () => {
                          const success = await reconnectTelegram();
                          if (success) {
                            addToast({
                              type: "success",
                              title: "Reconnected",
                              message: "Connected to Telegram MTProto session.",
                            });
                          } else {
                            addToast({
                              type: "error",
                              title: "Reconnect Failed",
                              message: "Could not restore connection. Check internet or re-login.",
                            });
                          }
                        }}
                        disabled={isReconnecting}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-colors disabled:opacity-60 cursor-pointer"
                      >
                        <RefreshCw className={`h-4 w-4 ${isReconnecting ? "animate-spin" : ""}`} />
                        <span>{isReconnecting ? "Connecting..." : "Reconnect Vault"}</span>
                      </button>

                      <button
                        onClick={() => {
                          closeSettings();
                          openSetup();
                        }}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-[#272b3a] bg-white dark:bg-[#141722] px-4 py-2 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1a1e2c] transition-colors cursor-pointer shadow-xs"
                      >
                        <Send className="h-3.5 w-3.5 text-indigo-500" />
                        <span>Change Account</span>
                      </button>

                      <button
                        onClick={handleDisconnect}
                        disabled={isDisconnecting}
                        className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 font-medium text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        <span>Unlink Session</span>
                      </button>
                    </div>
                  ) : (
                    <div className="pt-2">
                      <button
                        onClick={() => {
                          closeSettings();
                          openSetup();
                        }}
                        className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-colors cursor-pointer"
                      >
                        <Send className="h-4 w-4" />
                        <span>Connect Telegram Account</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* TAB: Security & Profile */}
            {activeTab === "security" && (
              <form onSubmit={handleSaveSecurity} className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Profile & Local Security</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Update local application name and master password protection.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="My Vault"
                      className="w-full rounded-xl border border-slate-300 dark:border-[#232634] bg-white dark:bg-[#12141c] px-3.5 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                      Change Local Lock Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new master password"
                      className="w-full rounded-xl border border-slate-300 dark:border-[#232634] bg-white dark:bg-[#12141c] px-3.5 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-colors cursor-pointer"
                >
                  Save Profile Changes
                </button>
              </form>
            )}

            {/* TAB: Storage & Sync */}
            {activeTab === "storage" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Storage & Saved Messages Sync</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Scan Telegram Saved Messages to reconstruct metadata manifests and inspect disk usage.
                </p>

                <div className="rounded-2xl border border-slate-200 dark:border-[#1e202a] bg-slate-50/70 dark:bg-[#12141c] p-4 space-y-2.5 transition-colors">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Total Indexed Cloud Bytes</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{formatBytes(storageStats?.totalBytes || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Total Files</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{storageStats?.totalFiles || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Database Size</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{formatBytes(storageStats?.databaseBytes || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Local Staging & Cache</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{formatBytes(storageStats?.dataDirectoryBytes || 0)}</span>
                  </div>
                </div>

                <button
                  onClick={startSync}
                  disabled={isSyncing}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-500 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                  <span>{isSyncing ? "Scanning Saved Messages..." : "Scan & Synchronize Saved Messages"}</span>
                </button>
              </div>
            )}

            {/* TAB: About */}
            {activeTab === "about" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2.5">
                  <TroveLogo size={24} />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">About Trove</h3>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-[#19243d] bg-slate-50/70 dark:bg-[#0c1324] p-4 space-y-2 text-xs transition-colors">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Version</span>
                    <span className="font-mono text-slate-900 dark:text-white">v0.1.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Platform</span>
                    <span className="font-mono text-slate-900 dark:text-white">{window.televault?.platform || "desktop"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Backend Server</span>
                    <span className="font-mono text-slate-900 dark:text-white">http://127.0.0.1:4787 (loopback)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Electron Security</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>contextIsolation & safeStorage active</span>
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Trove does not impose an arbitrary total file-size quota, but never claims that Telegram provides guaranteed unlimited storage. Storage is subject to Telegram's platform limits and account capabilities.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
