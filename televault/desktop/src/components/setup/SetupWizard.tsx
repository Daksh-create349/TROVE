import React, { useState } from "react";
import {
  Shield,
  Send,
  Lock,
  User,
  ArrowRight,
  CheckCircle2,
  X,
  Layers,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";

type SetupStep = "welcome" | "phone" | "code" | "password2fa" | "profile" | "complete";

export function SetupWizard() {
  const { isSetupOpen, closeSetup, refreshTelegram, refreshAll, addToast } = useApp();
  const { setPassword: setLocalAppPassword, updateProfile } = useAuth();

  const [step, setStep] = useState<SetupStep>("welcome");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [password2FA, setPassword2FA] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCodeViaApp, setIsCodeViaApp] = useState(true);
  const [resendCooldown, setResendCooldown] = useState(0);

  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  if (!isSetupOpen) return null;

  // Step 2: Request Login Code
  const handleStartLogin = async (e?: React.FormEvent, forceSMS = false) => {
    if (e) e.preventDefault();
    if (!phoneNumber.trim() || !window.televault) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await window.televault.telegram.startLogin(phoneNumber.trim(), forceSMS);
      setIsCodeViaApp(res?.isCodeViaApp ?? !forceSMS);
      setResendCooldown(30);
      setStep("code");
      addToast({
        type: "info",
        title: res?.isCodeViaApp && !forceSMS ? "Telegram App Code Sent" : "SMS Code Requested",
        message: res?.isCodeViaApp && !forceSMS
          ? "Check your Telegram app (chat with official Telegram)."
          : "Check your phone SMS text messages for the code.",
      });
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 3: Verify OTP Code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || !window.televault) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await window.televault.telegram.verifyCode(otpCode.trim());

      if (res.requiresPassword) {
        setStep("password2fa");
      } else {
        await refreshTelegram();
        setStep("profile");
      }
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 4: Verify 2FA Password if enabled
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password2FA || !window.televault) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      await window.televault.telegram.verifyPassword(password2FA);
      await refreshTelegram();
      setStep("profile");
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 5: Setup Local Profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const name = displayName.trim() || "Vault Owner";
      await updateProfile(name);

      if (localPassword.trim().length >= 4) {
        await setLocalAppPassword(localPassword.trim());
      }

      await refreshAll();
      setStep("complete");
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl border border-[#232634] bg-[#0d0e14] shadow-2xl overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1c1e27] bg-[#08090d] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 shadow-md shadow-blue-500/25">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="font-bold text-white text-xs">TeleVault Setup</div>
              <div className="text-[10px] text-slate-400">Telegram MTProto Connection</div>
            </div>
          </div>

          <button
            onClick={closeSetup}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step Content */}
        <div className="p-6">
          {errorMessage && (
            <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {errorMessage}
            </div>
          )}

          {/* STEP 1: WELCOME */}
          {step === "welcome" && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <Send className="h-7 w-7" />
              </div>

              <div>
                <h2 className="text-base font-bold text-white">Welcome to TeleVault</h2>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  TeleVault turns your personal Telegram Saved Messages into an encrypted,
                  high-speed local-first cloud drive.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-left pt-2">
                <div className="rounded-xl border border-[#1e202a] bg-[#12141c] p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-blue-400 font-semibold text-2xs">
                    <Shield className="h-3 w-3" />
                    <span>Zero Bots Needed</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Connects directly via MTProto to your personal Saved Messages.
                  </div>
                </div>

                <div className="rounded-xl border border-[#1e202a] bg-[#12141c] p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-purple-400 font-semibold text-2xs">
                    <Layers className="h-3 w-3" />
                    <span>Large File Slicing</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Upload massive files safely with 2-level chunking and SHA-256 checks.
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep("phone")}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-500 transition-all text-xs"
              >
                <span>Get Started</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* STEP 2: PHONE INPUT */}
          {step === "phone" && (
            <form onSubmit={handleStartLogin} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-white">Connect Telegram Account</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Enter your international phone number with country code (e.g. +1 555 123 4567).
                </p>
              </div>

              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Phone Number
                </label>
                <input
                  type="tel"
                  autoFocus
                  required
                  placeholder="+15551234567"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full rounded-xl border border-[#232634] bg-[#12141c] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("welcome")}
                  className="flex-1 rounded-xl border border-[#232634] bg-[#141620] py-2 font-medium text-slate-300 hover:bg-[#1a1e2c] transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !phoneNumber.trim()}
                  className="flex-1 rounded-xl bg-blue-600 py-2 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all disabled:opacity-50"
                >
                  {isLoading ? "Sending..." : "Send Login Code"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: OTP CODE */}
          {step === "code" && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-white">Enter Login Code</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {isCodeViaApp
                    ? "Check your official Telegram app (chat with blue verified Telegram checkmark)."
                    : "Check your phone SMS inbox for the carrier text message."}
                </p>
              </div>

              {/* Telegram In-App Instruction Banner */}
              {isCodeViaApp && (
                <div className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-3 text-xs text-blue-200">
                  <div className="font-semibold mb-1">Check Telegram App (NOT SMS)</div>
                  <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-slate-300">
                    <li>Open Telegram on your phone or PC</li>
                    <li>Look for the chat with <strong>"Telegram"</strong></li>
                    <li>Enter the 5-digit code sent to <strong>{phoneNumber}</strong></li>
                  </ol>
                </div>
              )}

              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  Telegram Login Code
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="12345"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full rounded-xl border border-[#232634] bg-[#12141c] px-3 py-2 text-center text-sm font-mono tracking-widest text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* SMS Fallback Button */}
              <div className="text-center pt-0.5">
                {resendCooldown > 0 ? (
                  <span className="text-[11px] text-slate-500">
                    Didn't receive code in Telegram? Request SMS in {resendCooldown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleStartLogin(undefined, true)}
                    disabled={isLoading}
                    className="text-[11px] text-blue-400 hover:text-blue-300 underline font-medium cursor-pointer"
                  >
                    Didn't receive code in your Telegram app? Send via SMS
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("phone")}
                  className="flex-1 rounded-xl border border-[#232634] bg-[#141620] py-2 font-medium text-slate-300 hover:bg-[#1a1e2c] transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !otpCode.trim()}
                  className="flex-1 rounded-xl bg-blue-600 py-2 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Verify Code"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 4: 2FA PASSWORD */}
          {step === "password2fa" && (
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-white">Two-Step Verification (2FA)</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Your Telegram account has Two-Step Verification enabled. Enter your 2FA cloud password.
                </p>
              </div>

              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  2FA Password
                </label>
                <input
                  type="password"
                  autoFocus
                  required
                  placeholder="••••••••"
                  value={password2FA}
                  onChange={(e) => setPassword2FA(e.target.value)}
                  className="w-full rounded-xl border border-[#232634] bg-[#12141c] px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isLoading || !password2FA}
                  className="w-full rounded-xl bg-blue-600 py-2 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Submit Password"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 5: LOCAL PROFILE */}
          {step === "profile" && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-white">Configure Local Profile</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Customize your local TeleVault profile and optionally protect it with a local desktop password.
                </p>
              </div>

              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Display Name
                </label>
                <div className="relative flex items-center">
                  <User className="absolute left-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="My Vault"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-[#232634] bg-[#12141c] py-2 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Local Master Password (Optional)
                </label>
                <div className="relative flex items-center">
                  <Lock className="absolute left-2.5 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="password"
                    placeholder="Leave empty for no lock screen"
                    value={localPassword}
                    onChange={(e) => setLocalPassword(e.target.value)}
                    className="w-full rounded-xl border border-[#232634] bg-[#12141c] py-2 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  This locks the app locally on your computer. It does NOT change your Telegram password.
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-xl bg-blue-600 py-2.5 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all text-xs"
              >
                {isLoading ? "Saving..." : "Finish Setup"}
              </button>
            </form>
          )}

          {/* STEP 6: COMPLETE */}
          {step === "complete" && (
            <div className="space-y-4 text-center py-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div>
                <h2 className="text-base font-bold text-white">Vault Connected!</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Your Telegram account is authenticated. Saved Messages is ready to store and retrieve your files safely.
                </p>
              </div>

              <button
                onClick={closeSetup}
                className="w-full rounded-xl bg-blue-600 py-2.5 font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-500 transition-all text-xs"
              >
                Open Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
