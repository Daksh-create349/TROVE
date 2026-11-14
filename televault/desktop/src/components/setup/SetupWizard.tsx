import React, { useState, useMemo, useEffect } from "react";
import {
  Send,
  ArrowRight,
  CheckCircle2,
  X,
  ExternalLink,
  ChevronDown,
  Search,
  RefreshCw,
  LogOut,
  Smartphone,
} from "lucide-react";
import { TroveLogo } from "../common/Logo";
import {
  COUNTRY_CODES,
  buildE164PhoneNumber,
  type CountryCodeItem,
} from "../../utils/countryCodes";
import { useApp } from "../../context/AppContext";

type SetupStep =
  | "account_status"
  | "credentials"
  | "phone"
  | "code"
  | "password2fa"
  | "complete";

export function SetupWizard() {
  const {
    isSetupOpen,
    closeSetup,
    telegramStatus,
    telegramProfile,
    refreshTelegram,
    reconnectTelegram,
    isReconnecting,
    refreshAll,
    addToast,
  } = useApp();

  const isConfigured = Boolean(telegramStatus?.configured);
  const isSessionStored = Boolean(telegramStatus?.sessionStored);
  const isConnected = telegramStatus?.state === "connected";

  // Step state
  const [step, setStep] = useState<SetupStep>(() => {
    if (isSessionStored) return "account_status";
    if (!isConfigured) return "credentials";
    return "phone";
  });

  // Whenever modal opens or connection state changes, align step
  useEffect(() => {
    if (!isSetupOpen) return;
    if (isSessionStored) {
      setStep("account_status");
    } else if (!isConfigured) {
      setStep("credentials");
    } else {
      setStep("phone");
    }
    setErrorMessage(null);
  }, [isSetupOpen, isSessionStored, isConfigured]);

  // Credentials
  const [inputApiId, setInputApiId] = useState("");
  const [inputApiHash, setInputApiHash] = useState("");

  // Phone input
  const [selectedCountry, setSelectedCountry] = useState<CountryCodeItem>(
    () => COUNTRY_CODES.find((c) => c.code === "IN") || COUNTRY_CODES[0]!
  );
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const [localNumber, setLocalNumber] = useState("");
  const [formattedPhoneNumber, setFormattedPhoneNumber] = useState("");

  // Verification & 2FA
  const [otpCode, setOtpCode] = useState("");
  const [password2FA, setPassword2FA] = useState("");
  const [isCodeViaApp, setIsCodeViaApp] = useState(true);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Common UI states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Countdown timer for resending
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const filteredCountries = useMemo(() => {
    const q = countrySearchQuery.toLowerCase().trim();
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [countrySearchQuery]);

  if (!isSetupOpen) return null;

  // External link
  const handleOpenTelegramOrg = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.televault?.shell?.openExternal) {
      window.televault.shell.openExternal("https://my.telegram.org");
    } else {
      window.open("https://my.telegram.org", "_blank");
    }
  };

  // Save developer keys
  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputApiId.trim() || !inputApiHash.trim()) {
      setErrorMessage("Please enter both Telegram API ID and API Hash.");
      return;
    }
    const numId = parseInt(inputApiId.trim(), 10);
    if (isNaN(numId) || numId <= 0) {
      setErrorMessage("API ID must be a valid positive integer.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (window.televault?.telegram?.saveCredentials) {
        await window.televault.telegram.saveCredentials(numId, inputApiHash.trim());
      }
      await refreshTelegram();
      addToast({
        type: "success",
        title: "Keys Saved",
        message: "Telegram developer keys stored successfully.",
      });
      setStep("phone");
    } catch (err) {
      setErrorMessage((err as Error).message || "Could not save credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  // Start login flow (phone number)
  const handleStartLogin = async (e?: React.FormEvent, forceSMS = false) => {
    if (e) e.preventDefault();
    if (!localNumber.trim()) {
      setErrorMessage("Please enter your phone number.");
      return;
    }

    const fullPhone = buildE164PhoneNumber(selectedCountry.dialCode, localNumber);
    if (!fullPhone || fullPhone.length < 8) {
      setErrorMessage("Please enter a valid international phone number.");
      return;
    }

    setFormattedPhoneNumber(fullPhone);
    setIsLoading(true);
    setErrorMessage(null);
    try {
      let isViaApp = true;
      if (window.televault?.telegram?.startLogin) {
        const res = await window.televault.telegram.startLogin(fullPhone, forceSMS);
        if (res && typeof res.isCodeViaApp === "boolean") {
          isViaApp = res.isCodeViaApp;
        }
      }
      setIsCodeViaApp(isViaApp);
      setResendCooldown(30);
      addToast({
        type: "info",
        title: isViaApp && !forceSMS ? "Telegram App Code Sent" : "SMS Code Requested",
        message: isViaApp && !forceSMS
          ? "Check your Telegram app (chat with official Telegram)."
          : "Check your phone SMS text messages for the code.",
      });
      setStep("code");
    } catch (err) {
      const msg = (err as Error).message || "Failed to start Telegram login.";
      setErrorMessage(msg);
      if (msg.includes("not configured") || msg.includes("TELEGRAM_API_ID")) {
        setStep("credentials");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Submit OTP Code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      setErrorMessage("Please enter the verification code.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (!window.televault?.telegram) {
        throw new Error("TeleVault backend is unavailable.");
      }
      const res = await window.televault.telegram.verifyCode(otpCode.trim());
      if (res.requiresPassword) {
        setStep("password2fa");
        setIsLoading(false);
        return;
      }
      await refreshTelegram();
      await refreshAll();
      addToast({
        type: "success",
        title: "Telegram Connected",
        message: "Your Telegram Saved Messages vault is active.",
      });
      setStep("complete");
    } catch (err) {
      setErrorMessage((err as Error).message || "Invalid or expired code.");
    } finally {
      setIsLoading(false);
    }
  };

  // Submit 2FA Password
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password2FA.trim()) {
      setErrorMessage("Please enter your Telegram cloud password.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (!window.televault?.telegram) {
        throw new Error("TeleVault backend is unavailable.");
      }
      await window.televault.telegram.verifyPassword(password2FA);
      await refreshTelegram();
      await refreshAll();
      addToast({
        type: "success",
        title: "Telegram Connected",
        message: "Two-step verification completed.",
      });
      setStep("complete");
    } catch (err) {
      setErrorMessage((err as Error).message || "Incorrect cloud password.");
    } finally {
      setIsLoading(false);
    }
  };

  // Disconnect Telegram Account
  const handleDisconnect = async () => {
    if (!window.televault?.telegram?.disconnect) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await window.televault.telegram.disconnect();
      await refreshTelegram();
      await refreshAll();
      addToast({
        type: "info",
        title: "Telegram Disconnected",
        message: "Saved Telegram session has been removed.",
      });
      setStep("phone");
    } catch (err) {
      setErrorMessage((err as Error).message || "Failed to disconnect.");
    } finally {
      setIsLoading(false);
    }
  };

  // Reconnect Telegram
  const handleReconnect = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const ok = await reconnectTelegram();
      if (ok) {
        addToast({
          type: "success",
          title: "Telegram Reconnected",
          message: "Connection to Telegram Saved Messages is active.",
        });
        closeSetup();
      } else {
        setErrorMessage("Could not reconnect to Telegram. Please check your internet or sign in again.");
      }
    } catch (err) {
      setErrorMessage((err as Error).message || "Reconnect failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const accountUser =
    telegramProfile ||
    (telegramStatus?.account
      ? {
          firstName: telegramStatus.account.firstName,
          username: telegramStatus.account.username,
          id: telegramStatus.account.telegramUserId,
        }
      : null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative flex w-full max-w-lg flex-col rounded-3xl border border-slate-200 dark:border-[#202434] bg-white dark:bg-[#0c0e15] shadow-2xl overflow-hidden text-xs transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-[#1a1d29] bg-slate-50/70 dark:bg-[#07090f] px-6 py-4">
          <div className="flex items-center gap-3">
            <TroveLogo size={24} />
            <div>
              <div className="font-bold text-slate-900 dark:text-white text-xs tracking-wide">
                Trove Cloud Connection
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                Telegram MTProto Storage Engine
              </div>
            </div>
          </div>

          <button
            onClick={closeSetup}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {errorMessage && (
            <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300">
              {errorMessage}
            </div>
          )}

          {/* VIEW: ACCOUNT ALREADY STORED (STATUS & RECONNECT) */}
          {step === "account_status" && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-[#1e2333] bg-slate-50/80 dark:bg-[#11141e] p-4">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl text-white shrink-0 ${
                    isConnected ? "bg-emerald-600" : "bg-amber-600 animate-pulse"
                  }`}
                >
                  <Send className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white text-sm truncate">
                      {accountUser?.firstName || "Telegram Account"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                        isConnected
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      }`}
                    >
                      {isConnected ? "Connected" : "Disconnected"}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {accountUser?.username ? `@${accountUser.username}` : `User ID: ${accountUser?.id || "Saved"}`}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-[#1e2333] bg-slate-50/50 dark:bg-[#0e111a] p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Storage Destination:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">Private Saved Messages</span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Connection Engine:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">Direct MTProto Socket</span>
                </div>
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span>Session Storage:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">SQLite Encrypted</span>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                {!isConnected ? (
                  <button
                    type="button"
                    onClick={handleReconnect}
                    disabled={isLoading || isReconnecting}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${isLoading || isReconnecting ? "animate-spin" : ""}`} />
                    <span>{isLoading || isReconnecting ? "Connecting..." : "Reconnect Vault"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={closeSetup}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all cursor-pointer"
                  >
                    <span>Done</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={isLoading}
                  className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 font-medium text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer flex items-center gap-1.5"
                  title="Unlink this Telegram account"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Unlink</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP: CREDENTIALS (API ID & HASH) */}
          {step === "credentials" && (
            <form onSubmit={handleSaveCredentials} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Telegram API Credentials
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Telegram requires a free App API ID and API Hash for desktop clients.
                </p>
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-600 dark:text-blue-400 flex items-center justify-between">
                <span>Get your keys free at my.telegram.org</span>
                <button
                  type="button"
                  onClick={handleOpenTelegramOrg}
                  className="flex items-center gap-1 font-semibold underline cursor-pointer"
                >
                  <span>Open</span>
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                    API ID (Numbers only)
                  </label>
                  <input
                    type="text"
                    required
                    value={inputApiId}
                    onChange={(e) => setInputApiId(e.target.value)}
                    placeholder="e.g. 12345678"
                    className="w-full rounded-xl border border-slate-300 dark:border-[#232736] bg-white dark:bg-[#11141e] px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                    API Hash (32-character string)
                  </label>
                  <input
                    type="text"
                    required
                    value={inputApiHash}
                    onChange={(e) => setInputApiHash(e.target.value)}
                    placeholder="e.g. 0123456789abcdef0123456789abcdef"
                    className="w-full rounded-xl border border-slate-300 dark:border-[#232736] bg-white dark:bg-[#11141e] px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeSetup}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-[#232736] py-2 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161926] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 rounded-xl bg-blue-600 py-2 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all disabled:opacity-50"
                >
                  {isLoading ? "Saving..." : "Save & Continue"}
                </button>
              </div>
            </form>
          )}

          {/* STEP: PHONE NUMBER */}
          {step === "phone" && (
            <form onSubmit={handleStartLogin} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Connect Telegram Account
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Select your country code and enter your Telegram phone number.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Mobile Phone Number
                </label>

                <div className="flex gap-2">
                  {/* Country Selector Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                      className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-300 dark:border-[#232736] bg-white dark:bg-[#11141e] px-3 text-xs text-slate-900 dark:text-white hover:border-blue-500 focus:outline-none cursor-pointer"
                    >
                      <span>{selectedCountry.flag}</span>
                      <span className="font-semibold">{selectedCountry.dialCode}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                    </button>

                    {isCountryDropdownOpen && (
                      <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-2xl border border-slate-200 dark:border-[#232736] bg-white dark:bg-[#11141e] p-2 shadow-2xl">
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Search countries..."
                            value={countrySearchQuery}
                            onChange={(e) => setCountrySearchQuery(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090b10] py-1.5 pl-8 pr-3 text-xs text-slate-900 dark:text-white focus:outline-none"
                          />
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {filteredCountries.map((c) => (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => {
                                setSelectedCountry(c);
                                setIsCountryDropdownOpen(false);
                                setCountrySearchQuery("");
                              }}
                              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1a1e2c] cursor-pointer"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span>{c.flag}</span>
                                <span className="truncate">{c.name}</span>
                              </div>
                              <span className="font-mono text-slate-400">{c.dialCode}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <input
                    type="tel"
                    autoFocus
                    required
                    placeholder="9876543210"
                    value={localNumber}
                    onChange={(e) => setLocalNumber(e.target.value.replace(/\D/g, ""))}
                    className="flex-1 rounded-xl border border-slate-300 dark:border-[#232736] bg-white dark:bg-[#11141e] px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-600 dark:text-blue-400 flex items-start gap-2">
                <Smartphone className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Telegram delivers verification codes directly to your active <strong>Telegram app</strong> chat, not SMS.
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("credentials")}
                  className="rounded-xl border border-slate-200 dark:border-[#232736] px-4 py-2 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161926] transition-colors"
                >
                  API Keys
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !localNumber.trim()}
                  className="flex-1 rounded-xl bg-blue-600 py-2 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all disabled:opacity-50"
                >
                  {isLoading ? "Sending Code..." : "Send Login Code"}
                </button>
              </div>
            </form>
          )}

          {/* STEP: OTP VERIFICATION CODE */}
          {step === "code" && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Enter Verification Code
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {isCodeViaApp
                    ? "Check your official Telegram app (in the chat with 'Telegram')."
                    : "Check your phone SMS text messages."}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-[#202434] bg-slate-50/80 dark:bg-[#11141e] p-3 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-2xs">
                  <span>Sent to {formattedPhoneNumber || localNumber}</span>
                  <button
                    type="button"
                    onClick={() => setStep("phone")}
                    className="text-blue-500 hover:underline font-semibold cursor-pointer"
                  >
                    Edit Phone
                  </button>
                </div>
                <div className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                  <strong>Tip:</strong> If you requested a code a minute ago, that code remains valid on Telegram's servers. You can enter it right now!
                </div>
              </div>

              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                  Telegram Login Code
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  maxLength={8}
                  placeholder="12345"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full h-12 rounded-xl border border-slate-300 dark:border-[#232736] bg-white dark:bg-[#11141e] px-4 text-center text-xl font-mono tracking-[0.3em] text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Resend via SMS */}
              <div className="text-center pt-1">
                {resendCooldown > 0 ? (
                  <span className="text-[11px] text-slate-400">
                    Resend via SMS available in {resendCooldown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleStartLogin(undefined, true)}
                    disabled={isLoading}
                    className="text-[11px] font-semibold text-blue-500 hover:text-blue-600 dark:text-blue-400 underline cursor-pointer"
                  >
                    Didn't receive code in Telegram app? Request via SMS
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("phone")}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-[#232736] py-2 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161926] transition-colors"
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

          {/* STEP: 2FA CLOUD PASSWORD */}
          {step === "password2fa" && (
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Two-Step Verification
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Your Telegram account is protected with a cloud password. Enter it below to unlock your vault.
                </p>
              </div>

              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                  Telegram Cloud Password
                </label>
                <input
                  type="password"
                  autoFocus
                  required
                  placeholder="Enter your 2FA password"
                  value={password2FA}
                  onChange={(e) => setPassword2FA(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-[#232736] bg-white dark:bg-[#11141e] px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep("code")}
                  className="flex-1 rounded-xl border border-slate-200 dark:border-[#232736] py-2 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#161926] transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !password2FA.trim()}
                  className="flex-1 rounded-xl bg-blue-600 py-2 font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-500 transition-all disabled:opacity-50"
                >
                  {isLoading ? "Verifying..." : "Submit Password"}
                </button>
              </div>
            </form>
          )}

          {/* STEP: COMPLETE */}
          {step === "complete" && (
            <div className="space-y-4 text-center py-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <CheckCircle2 className="h-7 w-7" />
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Telegram Connected Successfully!
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Your Telegram Saved Messages vault is active, encrypted, and ready for use.
                </p>
              </div>

              <button
                type="button"
                onClick={closeSetup}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-500 transition-all text-xs cursor-pointer"
              >
                <span>Open Trove Vault</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SetupWizard;
