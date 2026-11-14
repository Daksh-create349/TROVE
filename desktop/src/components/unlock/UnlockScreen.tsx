import React, { useState } from "react";
import { Lock, ArrowRight } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { TroveLogo } from "../common/Logo";

export function UnlockScreen() {
  const { unlock, profile } = useAuth();
  const [password, setPassword] = useState("");
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setIsLoading(true);
    setIsError(false);
    const success = await unlock(password);
    setIsLoading(false);

    if (!success) {
      setIsError(true);
      setPassword("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#080c16] p-4 select-none">
      <div className="w-full max-w-sm rounded-3xl border border-[#19243d] bg-[#0c1324] p-8 text-center shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="mx-auto mb-4 flex items-center justify-center">
          <TroveLogo size={56} />
        </div>

        <h1 className="text-lg font-bold text-white">Trove Locked</h1>
        <p className="mt-1 text-xs text-slate-400">
          Enter your local master password to unlock {profile?.displayName || "your vault"}.
        </p>

        <form onSubmit={handleUnlock} className="mt-6 space-y-4">
          <div className="relative flex items-center">
            <Lock className="absolute left-3 h-4 w-4 text-slate-500" />
            <input
              type="password"
              autoFocus
              required
              placeholder="Master Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setIsError(false);
              }}
              className={`w-full rounded-xl border bg-[#070b14] py-2.5 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none transition-all ${
                isError
                  ? "border-rose-500/80 focus:border-rose-500"
                  : "border-[#1e2a44] focus:border-blue-500"
              }`}
            />
          </div>

          {isError && (
            <div className="text-2xs text-rose-400 font-medium animate-shake">
              Incorrect master password. Try again.
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !password}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-500 transition-all disabled:opacity-50"
          >
            <span>{isLoading ? "Unlocking..." : "Unlock Vault"}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

