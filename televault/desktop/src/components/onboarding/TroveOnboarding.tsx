import React, { useState, useMemo } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronDown,
  Search,
  KeyRound,
  ExternalLink,
  Lock,
  Unlock,
  Smartphone,
  AlertCircle,
  Minus,
  Square,
  X,
  Loader2,
  Sparkles,
  CheckCircle2,
  Sun,
  Moon,
  Send,
} from "lucide-react";
import { TroveLogo } from "../common/Logo";
import {
  COUNTRY_CODES,
  buildE164PhoneNumber,
  type CountryCodeItem,
} from "../../utils/countryCodes";
import { useApp } from "../../context/AppContext";
import { useAuth } from "../../context/AuthContext";

type Step =
  | "welcome"
  | "name"
  | "theme"
  | "credentials"
  | "phone"
  | "verify"
  | "security"
  | "celebration";

interface TroveOnboardingProps {
  onComplete: () => void;
}

export function TroveOnboarding({ onComplete }: TroveOnboardingProps) {
  const { telegramStatus, refreshTelegram, refreshAll, addToast } = useApp();
  const { setPassword: setLocalAppPassword, updateProfile } = useAuth();

  const [step, setStep] = useState<Step>("welcome");

  // Step 1: User Identity
  const [displayName, setDisplayName] = useState("Daksh");

  // Step 2: Theme Preference
  const [selectedTheme, setSelectedTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("trove_theme") as "light" | "dark") || "dark";
  });

  const isDark = selectedTheme === "dark";

  // Step 3: Telegram Developer API credentials
  const isBackendConfigured = Boolean(telegramStatus?.configured);
  const [inputApiId, setInputApiId] = useState("");
  const [inputApiHash, setInputApiHash] = useState("");
  const [isSavingCreds, setIsSavingCreds] = useState(false);
  const [editingCreds, setEditingCreds] = useState(false);

  // Step 4: Telegram Phone
  const [selectedCountry, setSelectedCountry] = useState<CountryCodeItem>(
    () => COUNTRY_CODES.find((c) => c.code === "IN") || COUNTRY_CODES[0]!
  );
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const [localNumber, setLocalNumber] = useState("");

  // Step 5: Verification Code & 2FA
  const [otpCode, setOtpCode] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);
  const [password2FA, setPassword2FA] = useState("");
  const [show2FAPassword, setShow2FAPassword] = useState(false);
  const [isCodeViaApp, setIsCodeViaApp] = useState(true);
  const [formattedPhoneNumber, setFormattedPhoneNumber] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Step 6: Optional Security Passcode
  const [enablePassword, setEnablePassword] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Common UI states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Connected Telegram Account details
  const [connectedUser, setConnectedUser] = useState<{
    firstName?: string | null;
    username?: string | null;
    phone?: string | null;
    id?: string | null;
  } | null>(null);

  // Window control actions
  const handleWindowMinimize = () => window.televault?.window.minimize();
  const handleWindowMaximize = () => window.televault?.window.maximize();
  const handleWindowClose = () => window.televault?.window.close();

  // Search filter for country codes
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

  // Open Telegram Developer website in external browser
  const handleOpenTelegramOrg = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.televault?.shell?.openExternal) {
      window.televault.shell.openExternal("https://my.telegram.org");
    } else {
      window.open("https://my.telegram.org", "_blank");
    }
  };

  // Step 1 -> Step 2 (Theme)
  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setErrorMessage("Please enter what we should call you.");
      return;
    }
    setErrorMessage(null);
    setStep("theme");
  };

  // Step 2 -> Step 3 (Credentials) - Immediately applies theme live
  const handleThemeSelect = (theme: "light" | "dark") => {
    setSelectedTheme(theme);
    localStorage.setItem("trove_theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleThemeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleThemeSelect(selectedTheme);
    setErrorMessage(null);
    setStep("credentials");
  };

  // Step 3: Save API Credentials
  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputApiId.trim() || !inputApiHash.trim()) {
      setErrorMessage("Please enter both API ID and API Hash.");
      return;
    }

    const numId = parseInt(inputApiId.trim(), 10);
    if (isNaN(numId) || numId <= 0) {
      setErrorMessage("API ID must be a valid positive number.");
      return;
    }

    setIsSavingCreds(true);
    setErrorMessage(null);
    try {
      if (window.televault?.telegram?.saveCredentials) {
        const res = await window.televault.telegram.saveCredentials(
          numId,
          inputApiHash.trim()
        );
        if (res.success) {
          addToast({
            type: "success",
            title: "Credentials Saved",
            message: "Telegram developer keys stored successfully.",
          });
          setEditingCreds(false);
          await refreshTelegram();
          setStep("phone");
        } else {
          throw new Error("Failed to save credentials.");
        }
      } else {
        setStep("phone");
      }
    } catch (err) {
      setErrorMessage((err as Error).message || "Could not save credentials.");
    } finally {
      setIsSavingCreds(false);
    }
  };

  // Step 4: Request OTP Code (supports in-app Telegram code or SMS fallback)
  const handleStartLogin = async (e?: React.FormEvent, forceSMS = false) => {
    if (e) e.preventDefault();
    if (!localNumber.trim()) {
      setErrorMessage("Please enter your mobile phone number.");
      return;
    }

    const fullPhone = buildE164PhoneNumber(selectedCountry.dialCode, localNumber);
    if (!fullPhone || fullPhone.length < 8) {
      setErrorMessage("Please enter a valid mobile phone number.");
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
          ? "Check your Telegram app (in the chat with official Telegram)."
          : "Check your phone SMS text messages for the code.",
      });
      setStep("verify");
    } catch (err) {
      const msg = (err as Error).message || "Failed to start Telegram login.";
      setErrorMessage(msg);
      if (msg.includes("not configured") || msg.includes("TELEGRAM_API_ID")) {
        setEditingCreds(true);
        setStep("credentials");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Step 5: Verify Code & 2FA
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      setErrorMessage("Please enter the verification code.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (window.televault?.telegram) {
        if (needs2FA) {
          if (!password2FA) {
            setErrorMessage("Please enter your Telegram cloud password.");
            setIsLoading(false);
            return;
          }
          const prof = await window.televault.telegram.verifyPassword(password2FA);
          setConnectedUser({
            firstName: prof.firstName,
            username: prof.username,
            phone: prof.phone,
            id: prof.id,
          });
        } else {
          const res = await window.televault.telegram.verifyCode(otpCode.trim());
          if (res.requiresPassword) {
            setNeeds2FA(true);
            setIsLoading(false);
            return;
          }
          if (res.account) {
            setConnectedUser({
              firstName: res.account.firstName,
              username: res.account.username,
              phone: null,
              id: res.account.telegramUserId,
            });
          }
        }
      } else {
        throw new Error("Trove backend is still initializing. Please wait a moment and try again.");
      }

      await refreshTelegram();
      await refreshAll();

      addToast({
        type: "success",
        title: "Telegram Connected",
        message: "Your Telegram Saved Messages vault is ready.",
      });
      setStep("security");
    } catch (err) {
      setErrorMessage((err as Error).message || "Invalid code or password.");
    } finally {
      setIsLoading(false);
    }
  };

  // Step 6: Security / Passcode
  const handleSecuritySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (enablePassword) {
      if (masterPassword.length < 4) {
        setErrorMessage("Master password must be at least 4 characters.");
        return;
      }
      if (masterPassword !== confirmPassword) {
        setErrorMessage("Passwords do not match.");
        return;
      }
    }
    setErrorMessage(null);
    setStep("celebration");
  };

  // Final Step: Launch Trove (Save to SQLite database once only)
  const handleLaunchVault = async () => {
    setIsLoading(true);
    try {
      // 1. Save profile to SQLite database via backend API
      if (updateProfile) {
        await updateProfile(displayName.trim()).catch(() => null);
      } else if (window.televault?.profile?.save) {
        await window.televault.profile.save(displayName.trim()).catch(() => null);
      }

      // 2. Set local master passcode if selected
      if (enablePassword && masterPassword && setLocalAppPassword) {
        await setLocalAppPassword(masterPassword).catch(() => null);
      }

      // 3. Save chosen theme and apply immediately
      localStorage.setItem("trove_theme", selectedTheme);
      if (selectedTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }

      // 4. Mark completed in localStorage
      localStorage.setItem("trove_onboarded", "true");

      // 5. Fire completion callback synchronously so main screen launches instantly
      onComplete();

      // 6. Refresh app state in background
      void refreshAll().catch(() => null);
    } catch (err) {
      setErrorMessage((err as Error).message || "Failed to finalize vault setup.");
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col w-screen h-screen select-none overflow-hidden font-sans transition-colors duration-300 ${
        isDark ? "bg-[#07090e] text-slate-100" : "bg-[#f8fafc] text-slate-800"
      }`}
    >
      {/* Soft ambient gradient illumination */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {isDark ? (
          <>
            <div className="absolute -top-[25%] -left-[10%] w-[60%] h-[60%] rounded-full bg-blue-600/15 blur-[140px]" />
            <div className="absolute top-[30%] -right-[15%] w-[55%] h-[55%] rounded-full bg-indigo-600/15 blur-[150px]" />
            <div className="absolute -bottom-[20%] left-[25%] w-[50%] h-[50%] rounded-full bg-sky-500/10 blur-[130px]" />
          </>
        ) : (
          <>
            <div className="absolute -top-[25%] -left-[10%] w-[60%] h-[60%] rounded-full bg-blue-100/70 blur-[130px]" />
            <div className="absolute top-[30%] -right-[15%] w-[55%] h-[55%] rounded-full bg-sky-100/60 blur-[140px]" />
            <div className="absolute -bottom-[20%] left-[25%] w-[50%] h-[50%] rounded-full bg-indigo-100/50 blur-[130px]" />
          </>
        )}
      </div>

      {/* Top Frameless Titlebar with working window controls */}
      <header
        className={`relative z-30 flex h-11 w-full shrink-0 items-center justify-between px-5 border-b backdrop-blur-md transition-colors duration-300 ${
          isDark
            ? "border-slate-800/80 bg-[#0c1017]/80 text-white"
            : "border-slate-200/70 bg-white/70 text-slate-800"
        }`}
      >
        {/* Brand identity on left */}
        <div className="flex items-center gap-2.5">
          <TroveLogo size={22} />
          <span
            className={`text-xs font-bold tracking-wider ${
              isDark ? "text-white" : "text-slate-800"
            }`}
          >
            TROVE
          </span>
          <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
            Personal Cloud Vault
          </span>
        </div>

        {/* Center Draggable Region (Native Windows/Mac drag area) */}
        <div className="flex-1 h-full app-drag-region select-none" />

        {/* Functional Window Controls on right (Strictly app-no-drag, clickable) */}
        <div
          className="flex items-center gap-1 app-no-drag z-50"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleWindowMinimize();
            }}
            title="Minimize"
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer ${
              isDark
                ? "hover:bg-slate-800 text-slate-400 hover:text-white"
                : "hover:bg-slate-200/80 text-slate-500 hover:text-slate-800"
            }`}
          >
            <Minus className="h-3.5 w-3.5 pointer-events-none" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleWindowMaximize();
            }}
            title="Maximize / Restore"
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer ${
              isDark
                ? "hover:bg-slate-800 text-slate-400 hover:text-white"
                : "hover:bg-slate-200/80 text-slate-500 hover:text-slate-800"
            }`}
          >
            <Square className="h-3 w-3 pointer-events-none" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleWindowClose();
            }}
            title="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-rose-500 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5 pointer-events-none" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-6 sm:p-10 overflow-y-auto">
        {/* ======================================================== */}
        {/* SCREEN 1: WHITE WELCOME HERO SCREEN                      */}
        {/* Left: Welcome to Trove + Continue Button                 */}
        {/* Right: Big Glossy Trove Logo                             */}
        {/* ======================================================== */}
        {step === "welcome" && (
          <div className="w-full max-w-5xl rounded-[32px] border border-slate-200/80 bg-white/90 backdrop-blur-2xl p-8 sm:p-14 shadow-[0_25px_70px_-15px_rgba(0,0,0,0.06)] flex flex-col md:flex-row items-center justify-between gap-10 md:gap-14 animate-in fade-in duration-500">
            {/* Left Column: Heading, Subtitle & Continue Button */}
            <div className="flex-1 text-left space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Private &amp; Limitless Storage</span>
              </div>

              <div className="space-y-3">
                <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.1]">
                  Welcome to Trove
                </h1>
                <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-lg">
                  Transform your personal Telegram into blazing-fast desktop cloud
                  storage. Segmented uploads, byte-for-byte SHA-256 verification,
                  and zero monthly subscriptions.
                </p>
              </div>

              {/* 3 Quick Value Bullets */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-700">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </div>
                  <span>Direct MTProto connection to your private Saved Messages</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-700">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </div>
                  <span>Logical segment chunking for files exceeding single limits</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-700">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </div>
                  <span>Local-first SQLite metadata stored securely on your machine</span>
                </div>
              </div>

              {/* Continue Button */}
              <div className="pt-4">
                <button
                  type="button"
                  onClick={() => setStep("name")}
                  className="inline-flex items-center gap-3 px-8 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold transition-all shadow-lg shadow-blue-500/25 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                >
                  <span>Continue</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Right Column: Big Trove 3D Cloud Logo */}
            <div className="flex-1 flex items-center justify-center relative">
              <div className="relative flex items-center justify-center">
                <div className="absolute -inset-8 rounded-full bg-blue-500/15 blur-2xl pointer-events-none" />
                <div className="relative p-6 rounded-3xl bg-gradient-to-br from-white/95 to-blue-50/50 border border-slate-100 shadow-xl">
                  <TroveLogo
                    size={280}
                    className="drop-shadow-[0_15px_35px_rgba(37,99,235,0.25)] transition-transform duration-500 hover:scale-105"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* INTERACTIVE QUESTIONS (ASKED ONE BY ONE)                 */}
        {/* Clean, centered card with progressive transitions        */}
        {/* ======================================================== */}
        {step !== "welcome" && (
          <div
            className={`w-full max-w-xl rounded-[28px] border p-8 sm:p-10 text-left relative overflow-hidden animate-in fade-in-up duration-300 backdrop-blur-2xl transition-colors duration-300 ${
              isDark
                ? "border-slate-800/80 bg-[#0d121d]/95 text-white shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6)]"
                : "border-slate-200/80 bg-white/95 text-slate-800 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.07)]"
            }`}
          >
            {/* Top Progress Bar & Stepper */}
            {step !== "celebration" && (
              <div className="mb-8 space-y-2">
                <div
                  className={`flex items-center justify-between text-xs font-semibold ${
                    isDark ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  <span>
                    {step === "name" && "Question 1 of 5"}
                    {step === "theme" && "Question 2 of 5"}
                    {step === "credentials" && "Question 3 of 5"}
                    {step === "phone" && "Question 4 of 5"}
                    {step === "verify" && "Question 5 of 5"}
                    {step === "security" && "Device Security"}
                  </span>
                  <span className="text-blue-500 dark:text-blue-400 font-bold">
                    {step === "name" && "20%"}
                    {step === "theme" && "40%"}
                    {step === "credentials" && "60%"}
                    {step === "phone" && "80%"}
                    {step === "verify" && "95%"}
                    {step === "security" && "98%"}
                  </span>
                </div>
                <div
                  className={`h-1.5 w-full rounded-full overflow-hidden ${
                    isDark ? "bg-slate-800" : "bg-slate-100"
                  }`}
                >
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{
                      width:
                        step === "name"
                          ? "20%"
                          : step === "theme"
                          ? "40%"
                          : step === "credentials"
                          ? "60%"
                          : step === "phone"
                          ? "80%"
                          : step === "verify"
                          ? "95%"
                          : step === "security"
                          ? "98%"
                          : "100%",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error Notification Banner */}
            {errorMessage && (
              <div className="mb-6 flex items-start gap-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 p-3.5 text-xs text-rose-500 dark:text-rose-400 animate-in fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500 mt-0.5" />
                <div className="flex-1">{errorMessage}</div>
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* QUESTION 1: WHAT CAN WE CALL YOU?                    */}
            {/* ---------------------------------------------------- */}
            {step === "name" && (
              <form onSubmit={handleNameSubmit} className="space-y-6">
                <div className="space-y-2">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    What can we call you?
                  </h2>
                  <p
                    className={`text-sm ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Choose a display name for your local Trove vault profile.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-slate-700"
                    }`}
                  >
                    Your Name
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Daksh"
                    className={`w-full h-12 rounded-xl border px-4 text-base font-medium transition-all shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                      isDark
                        ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-500"
                        : "border-slate-300 bg-white text-slate-900 placeholder-slate-400"
                    }`}
                  />
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setStep("welcome")}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                  >
                    <span>Continue</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </form>
            )}

            {/* ---------------------------------------------------- */}
            {/* QUESTION 2: CHOOSE INTERFACE THEME (DARK OR WHITE)   */}
            {/* Immediately switches the visual style live on click   */}
            {/* ---------------------------------------------------- */}
            {step === "theme" && (
              <form onSubmit={handleThemeSubmit} className="space-y-6">
                <div className="space-y-2">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Choose your interface theme
                  </h2>
                  <p
                    className={`text-sm ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Select your preferred appearance for the Trove desktop experience.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Dark Theme Card */}
                  <button
                    type="button"
                    onClick={() => handleThemeSelect("dark")}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative ${
                      selectedTheme === "dark"
                        ? "border-blue-500 bg-blue-600/15 text-white shadow-md ring-2 ring-blue-500/40"
                        : isDark
                        ? "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700"
                        : "border-slate-200 bg-slate-900/90 text-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                        <Moon className="h-4 w-4" />
                      </div>
                      {selectedTheme === "dark" && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                          <Check className="h-3 w-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold text-white mb-0.5">Obsidian Dark</div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Deep charcoal dark background with electric blue active highlights.
                    </p>
                  </button>

                  {/* Light Theme Card */}
                  <button
                    type="button"
                    onClick={() => handleThemeSelect("light")}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative ${
                      selectedTheme === "light"
                        ? "border-blue-500 bg-blue-50 text-slate-900 shadow-md ring-2 ring-blue-500/40"
                        : isDark
                        ? "border-slate-800 bg-slate-900/40 text-slate-300 hover:border-slate-700"
                        : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                        <Sun className="h-4 w-4" />
                      </div>
                      {selectedTheme === "light" && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                          <Check className="h-3 w-3 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-sm font-bold mb-0.5 ${
                        selectedTheme === "light" ? "text-slate-900" : isDark ? "text-white" : "text-slate-900"
                      }`}
                    >
                      Pure White
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        isDark ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      Clean, luminous white canvas with soft frosted borders and blue accents.
                    </p>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setStep("name")}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                  >
                    <span>Continue</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </form>
            )}

            {/* ---------------------------------------------------- */}
            {/* QUESTION 3: TELEGRAM DEVELOPER KEYS                  */}
            {/* ---------------------------------------------------- */}
            {step === "credentials" && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Telegram Developer Access
                  </h2>
                  <p
                    className={`text-sm leading-relaxed ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Trove interfaces directly with Telegram MTProto. Telegram requires
                    a free App API ID &amp; API Hash for custom desktop clients.
                  </p>
                </div>

                {isBackendConfigured && !editingCreds ? (
                  <div className="space-y-4">
                    <div
                      className={`flex items-center justify-between p-4 rounded-2xl border ${
                        isDark
                          ? "bg-emerald-950/30 border-emerald-800/60 text-emerald-300"
                          : "bg-emerald-50 border-emerald-200 text-emerald-800"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white shrink-0">
                          <Check className="h-4 w-4 stroke-[3]" />
                        </div>
                        <div>
                          <div className="text-sm font-bold">API Credentials Active</div>
                          <div
                            className={`text-xs ${
                              isDark ? "text-emerald-400" : "text-emerald-700"
                            }`}
                          >
                            Telegram API ID &amp; Hash are configured and ready.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingCreds(true)}
                        className="text-xs font-semibold text-emerald-500 hover:underline cursor-pointer"
                      >
                        Change Keys
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-4">
                      <button
                        type="button"
                        onClick={() => setStep("theme")}
                        className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                          isDark
                            ? "text-slate-400 hover:text-white hover:bg-slate-800"
                            : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                        }`}
                      >
                        <ArrowLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep("phone")}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                      >
                        <span>Continue</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSaveCredentials} className="space-y-5">
                    <div
                      className={`rounded-2xl border p-4 space-y-2.5 text-xs ${
                        isDark
                          ? "bg-amber-950/30 border-amber-800/60 text-amber-200"
                          : "bg-amber-50/80 border-amber-200 text-amber-900"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold flex items-center gap-1.5">
                          <KeyRound className="h-4 w-4 text-amber-500" />
                          <span>Get your free Telegram keys in 30 seconds:</span>
                        </span>
                        <button
                          type="button"
                          onClick={handleOpenTelegramOrg}
                          className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-400 font-bold cursor-pointer underline"
                        >
                          <span>Open my.telegram.org</span>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                      <p
                        className={`leading-relaxed ${
                          isDark ? "text-slate-300" : "text-slate-600"
                        }`}
                      >
                        1. Sign in to <strong>my.telegram.org</strong> with your Telegram phone number.
                        <br />
                        2. Click <strong>API development tools</strong> and copy your App api_id &amp; api_hash.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label
                          className={`text-xs font-bold uppercase tracking-wider ${
                            isDark ? "text-slate-300" : "text-slate-700"
                          }`}
                        >
                          App api_id
                        </label>
                        <input
                          type="text"
                          required
                          value={inputApiId}
                          onChange={(e) => setInputApiId(e.target.value)}
                          placeholder="e.g. 12345678"
                          className={`w-full h-11 rounded-xl border px-3.5 text-sm font-medium transition-all shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                            isDark
                              ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-500"
                              : "border-slate-300 bg-white text-slate-900 placeholder-slate-400"
                          }`}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          className={`text-xs font-bold uppercase tracking-wider ${
                            isDark ? "text-slate-300" : "text-slate-700"
                          }`}
                        >
                          App api_hash
                        </label>
                        <input
                          type="text"
                          required
                          value={inputApiHash}
                          onChange={(e) => setInputApiHash(e.target.value)}
                          placeholder="32 character hash"
                          className={`w-full h-11 rounded-xl border px-3.5 text-sm font-medium transition-all shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                            isDark
                              ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-500"
                              : "border-slate-300 bg-white text-slate-900 placeholder-slate-400"
                          }`}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          if (isBackendConfigured) {
                            setEditingCreds(false);
                          } else {
                            setStep("theme");
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                          isDark
                            ? "text-slate-400 hover:text-white hover:bg-slate-800"
                            : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                        }`}
                      >
                        <ArrowLeft className="h-4 w-4" />
                        <span>Back</span>
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingCreds || !inputApiId.trim() || !inputApiHash.trim()}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                      >
                        {isSavingCreds ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Saving...</span>
                          </>
                        ) : (
                          <>
                            <span>Save &amp; Continue</span>
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* QUESTION 4: CONNECT TELEGRAM PHONE NUMBER            */}
            {/* ---------------------------------------------------- */}
            {step === "phone" && (
              <form onSubmit={handleStartLogin} className="space-y-6">
                <div className="space-y-2">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Connect Telegram Account
                  </h2>
                  <p
                    className={`text-sm ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Enter the mobile phone number associated with your Telegram account.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isDark ? "text-slate-300" : "text-slate-700"
                    }`}
                  >
                    Mobile Phone Number
                  </label>

                  <div className="flex items-center gap-2">
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                        className={`h-12 px-3.5 rounded-xl border flex items-center gap-2 text-sm font-semibold transition-all cursor-pointer shadow-sm ${
                          isDark
                            ? "border-slate-700 bg-[#131a29] text-white hover:bg-slate-800"
                            : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                        }`}
                      >
                        <span>{selectedCountry.flag}</span>
                        <span>{selectedCountry.dialCode}</span>
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                      </button>

                      {isCountryDropdownOpen && (
                        <div
                          className={`absolute left-0 top-full mt-2 w-72 rounded-2xl border p-2 z-50 animate-in fade-in shadow-2xl ${
                            isDark
                              ? "border-slate-700 bg-[#0d121d] text-white"
                              : "border-slate-200 bg-white text-slate-800"
                          }`}
                        >
                          <div className="relative mb-2">
                            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            <input
                              type="text"
                              autoFocus
                              value={countrySearchQuery}
                              onChange={(e) => setCountrySearchQuery(e.target.value)}
                              placeholder="Search country or code..."
                              className={`w-full h-8 pl-8 pr-3 text-xs rounded-lg border focus:outline-none focus:border-blue-500 ${
                                isDark
                                  ? "border-slate-700 bg-slate-800 text-white placeholder-slate-400"
                                  : "border-slate-200 bg-white text-slate-800 placeholder-slate-400"
                              }`}
                            />
                          </div>
                          <div className="max-h-52 overflow-y-auto space-y-0.5">
                            {filteredCountries.map((c) => (
                              <button
                                key={c.code}
                                type="button"
                                onClick={() => {
                                  setSelectedCountry(c);
                                  setIsCountryDropdownOpen(false);
                                  setCountrySearchQuery("");
                                }}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-left cursor-pointer ${
                                  isDark
                                    ? "hover:bg-slate-800/80 text-slate-200"
                                    : "hover:bg-blue-50 text-slate-700"
                                }`}
                              >
                                <span className="flex items-center gap-2 truncate">
                                  <span>{c.flag}</span>
                                  <span className="truncate">{c.name}</span>
                                </span>
                                <span className="font-mono text-slate-400 font-semibold ml-2">
                                  {c.dialCode}
                                </span>
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
                      value={localNumber}
                      onChange={(e) => setLocalNumber(e.target.value)}
                      placeholder="e.g. 98765 43210"
                      className={`flex-1 h-12 rounded-xl border px-4 text-base font-medium transition-all shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                        isDark
                          ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-500"
                          : "border-slate-300 bg-white text-slate-900 placeholder-slate-400"
                      }`}
                    />
                  </div>
                </div>

                <div
                  className={`flex items-start gap-3 p-4 rounded-2xl border text-xs leading-relaxed ${
                    isDark
                      ? "bg-blue-950/30 border-blue-800/60 text-blue-200"
                      : "bg-blue-50 border-blue-200/70 text-blue-900"
                  }`}
                >
                  <Smartphone className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  <p>
                    Telegram will deliver your login verification code directly inside your
                    active <strong>Telegram app</strong> (Telegram Service Notifications), not via SMS.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setStep("credentials")}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || !localNumber.trim()}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Sending Code...</span>
                      </>
                    ) : (
                      <>
                        <span>Send Login Code</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* ---------------------------------------------------- */}
            {/* QUESTION 5: VERIFICATION CODE & 2FA                  */}
            {/* ---------------------------------------------------- */}
            {step === "verify" && (
              <form onSubmit={handleVerifyCode} className="space-y-5">
                <div className="space-y-1.5">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    {needs2FA ? "Two-Step Verification" : "Enter Verification Code"}
                  </h2>
                  <p
                    className={`text-sm ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    {needs2FA
                      ? "Your Telegram account is protected by Two-Step Verification. Enter your cloud password."
                      : isCodeViaApp
                      ? "Telegram sent your login code to the official Telegram app on your phone or PC."
                      : "Telegram sent your login code via SMS text message."}
                  </p>
                </div>

                {!needs2FA ? (
                  <div className="space-y-4">
                    {/* Visual Telegram App Delivery Explainer Banner */}
                    <div
                      className={`p-4 rounded-2xl border transition-colors ${
                        isDark
                          ? "bg-blue-950/30 border-blue-800/40 text-blue-200"
                          : "bg-blue-50/80 border-blue-200/80 text-blue-900"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20 text-blue-500 shrink-0 mt-0.5">
                          <Send className="h-4 w-4" />
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="font-bold text-sm">
                              {isCodeViaApp ? "Check Telegram App (NOT SMS)" : "Check SMS Messages"}
                            </span>
                            <div className="flex items-center gap-1.5 text-[11px]">
                              <span className={isDark ? "text-slate-400" : "text-slate-500"}>
                                Sent to: <strong className={isDark ? "text-white" : "text-slate-800"}>{formattedPhoneNumber || localNumber}</strong>
                              </span>
                              <button
                                type="button"
                                onClick={() => setStep("phone")}
                                className="text-blue-500 hover:text-blue-600 underline font-semibold cursor-pointer"
                              >
                                Edit
                              </button>
                            </div>
                          </div>

                          {isCodeViaApp ? (
                            <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-300 pt-0.5">
                              <li>Open the official <strong>Telegram app</strong> on your phone or PC.</li>
                              <li>Look for the chat with <strong>"Telegram"</strong> (blue verified badge).</li>
                              <li>Copy the 5-digit code and enter it below.</li>
                            </ol>
                          ) : (
                            <p className="text-slate-600 dark:text-slate-300">
                              Please check your phone carrier's SMS inbox for the 5-digit verification code.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label
                        className={`text-xs font-bold uppercase tracking-wider ${
                          isDark ? "text-slate-300" : "text-slate-700"
                        }`}
                      >
                        5-Digit Telegram Code
                      </label>
                      <input
                        type="text"
                        autoFocus
                        required
                        maxLength={8}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="12345"
                        className={`w-full h-14 rounded-xl border px-4 text-center text-2xl font-mono tracking-[0.3em] transition-all shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                          isDark
                            ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-600"
                            : "border-slate-300 bg-white text-slate-900 placeholder-slate-300"
                        }`}
                      />
                    </div>

                    {/* Fallback to SMS Button with Cooldown */}
                    <div className="flex items-center justify-center pt-1">
                      {resendCooldown > 0 ? (
                        <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                          Didn't receive code in your Telegram app? Request via SMS in {resendCooldown}s
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartLogin(undefined, true)}
                          disabled={isLoading}
                          className="text-xs font-semibold text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors underline cursor-pointer"
                        >
                          Didn't receive code in your Telegram app? Send via SMS
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isDark ? "text-slate-300" : "text-slate-700"
                      }`}
                    >
                      Telegram 2FA Cloud Password
                    </label>
                    <div className="relative">
                      <input
                        type={show2FAPassword ? "text" : "password"}
                        autoFocus
                        required
                        value={password2FA}
                        onChange={(e) => setPassword2FA(e.target.value)}
                        placeholder="Enter your 2FA password"
                        className={`w-full h-12 rounded-xl border pl-4 pr-11 text-base font-medium transition-all shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                          isDark
                            ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-500"
                            : "border-slate-300 bg-white text-slate-900 placeholder-slate-400"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShow2FAPassword(!show2FAPassword)}
                        className="absolute right-3.5 top-3.5 text-xs text-blue-500 hover:text-blue-400 font-semibold cursor-pointer"
                      >
                        {show2FAPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (needs2FA) {
                        setNeeds2FA(false);
                      } else {
                        setStep("phone");
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading || (!needs2FA ? !otpCode.trim() : !password2FA.trim())}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <span>Verify &amp; Connect</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* ---------------------------------------------------- */}
            {/* QUESTION 6: DEVICE SECURITY & PASSCODE (OPTIONAL)    */}
            {/* ---------------------------------------------------- */}
            {step === "security" && (
              <form onSubmit={handleSecuritySubmit} className="space-y-6">
                <div className="space-y-2">
                  <h2
                    className={`text-2xl sm:text-3xl font-bold tracking-tight ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Device Security
                  </h2>
                  <p
                    className={`text-sm ${
                      isDark ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Choose whether you would like to require a master passcode when
                    opening Trove on this device.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEnablePassword(false)}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                      !enablePassword
                        ? "border-blue-500 bg-blue-600/15 text-white shadow-sm ring-1 ring-blue-500/40"
                        : isDark
                        ? "border-slate-800 bg-[#131a29]/60 hover:bg-slate-800/80"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div
                      className={`flex items-center gap-2 text-sm font-bold mb-1 ${
                        isDark ? "text-white" : "text-slate-900"
                      }`}
                    >
                      <Unlock className="h-4 w-4 text-blue-500" />
                      <span>Quick Access</span>
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        isDark ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      No password required on this machine. Trove opens straight to your vault.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEnablePassword(true)}
                    className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                      enablePassword
                        ? "border-blue-500 bg-blue-600/15 text-white shadow-sm ring-1 ring-blue-500/40"
                        : isDark
                        ? "border-slate-800 bg-[#131a29]/60 hover:bg-slate-800/80"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div
                      className={`flex items-center gap-2 text-sm font-bold mb-1 ${
                        isDark ? "text-white" : "text-slate-900"
                      }`}
                    >
                      <Lock className="h-4 w-4 text-blue-500" />
                      <span>Master Passcode</span>
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        isDark ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      Encrypt local session with Argon2id. Require passcode on app launch.
                    </p>
                  </button>
                </div>

                {enablePassword && (
                  <div className="space-y-3 pt-2 animate-in fade-in">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label
                          className={`text-xs font-bold ${
                            isDark ? "text-slate-300" : "text-slate-700"
                          }`}
                        >
                          Master Passcode
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="text-2xs text-blue-500 hover:text-blue-400 font-semibold cursor-pointer"
                        >
                          {showPassword ? "Hide" : "Show"}
                        </button>
                      </div>
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        value={masterPassword}
                        onChange={(e) => setMasterPassword(e.target.value)}
                        placeholder="At least 4 characters"
                        className={`w-full h-11 rounded-xl border px-3.5 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                          isDark
                            ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-500"
                            : "border-slate-300 bg-white text-slate-900 placeholder-slate-400"
                        }`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        className={`text-xs font-bold ${
                          isDark ? "text-slate-300" : "text-slate-700"
                        }`}
                      >
                        Confirm Passcode
                      </label>
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter passcode"
                        className={`w-full h-11 rounded-xl border px-3.5 text-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                          isDark
                            ? "border-slate-700 bg-[#131a29] text-white placeholder-slate-500"
                            : "border-slate-300 bg-white text-slate-900 placeholder-slate-400"
                        }`}
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setStep("verify")}
                    className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-400 hover:text-white hover:bg-slate-800"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Back</span>
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                  >
                    <span>Finalize Setup</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </form>
            )}

            {/* ---------------------------------------------------- */}
            {/* STEP 7: CELEBRATION & DATABASE SAVE                  */}
            {/* ---------------------------------------------------- */}
            {step === "celebration" && (
              <div className="text-center space-y-6 animate-in zoom-in-95 duration-400">
                <div className="inline-flex items-center justify-center p-3 rounded-full bg-emerald-500/15 text-emerald-500">
                  <CheckCircle2 className="h-12 w-12" />
                </div>

                <div className="space-y-2">
                  <h2
                    className={`text-3xl font-extrabold tracking-tight ${
                      isDark ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Welcome to Trove, {displayName}!
                  </h2>
                  <p
                    className={`text-sm max-w-md mx-auto ${
                      isDark ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    Your personal cloud vault is now live and synchronized with Telegram Saved Messages.
                  </p>
                </div>

                <div
                  className={`p-4 rounded-2xl border text-left space-y-2 text-xs transition-colors ${
                    isDark
                      ? "bg-[#111726]/80 border-slate-800 text-slate-300"
                      : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-slate-500"}>Vault Owner</span>
                    <span className={`font-bold ${isDark ? "text-white" : "text-slate-800"}`}>{displayName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-slate-500"}>Connected Telegram</span>
                    <span className="font-bold text-blue-500 dark:text-blue-400">
                      @{connectedUser?.username || "Saved Messages"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-slate-500"}>Theme</span>
                    <span className={`font-semibold capitalize ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                      {selectedTheme} Mode
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-slate-500"}>Local Database</span>
                    <span className="font-semibold text-emerald-500 dark:text-emerald-400">SQLite Active</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? "text-slate-400" : "text-slate-500"}>Integrity Protocol</span>
                    <span className={`font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>SHA-256 Chunking</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLaunchVault}
                  disabled={isLoading}
                  className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Launching Trove Vault...</span>
                    </>
                  ) : (
                    <>
                      <span>Launch Trove Vault</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default TroveOnboarding;
