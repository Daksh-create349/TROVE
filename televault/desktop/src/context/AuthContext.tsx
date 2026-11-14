import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AppProfile } from "@shared/types";

interface AuthContextValue {
  isLocked: boolean;
  hasPassword: boolean;
  profile: AppProfile | null;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  setPassword: (password: string) => Promise<boolean>;
  updateProfile: (displayName: string) => Promise<AppProfile | null>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [profile, setProfile] = useState<AppProfile | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      if (!window.televault) return;
      const [hasPass, prof] = await Promise.all([
        window.televault.profile.hasLocalPassword(),
        window.televault.profile.get().catch(() => null),
      ]);
      setHasPassword(hasPass);
      if (hasPass) {
        setIsLocked(true);
      }
      setProfile(prof);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    try {
      if (!window.televault) return false;
      const res = await window.televault.profile.verifyLocalPassword(password);
      if (res.valid) {
        setIsLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const lock = useCallback(() => {
    if (hasPassword) {
      setIsLocked(true);
    }
  }, [hasPassword]);

  const setPassword = useCallback(async (password: string): Promise<boolean> => {
    try {
      if (!window.televault) return false;
      const res = await window.televault.profile.setLocalPassword(password);
      if (res.success) {
        setHasPassword(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const updateProfile = useCallback(async (displayName: string): Promise<AppProfile | null> => {
    try {
      if (!window.televault) return null;
      const updated = await window.televault.profile.save(displayName);
      setProfile(updated);
      return updated;
    } catch {
      return null;
    }
  }, []);

  const value: AuthContextValue = {
    isLocked,
    hasPassword,
    profile,
    unlock,
    lock,
    setPassword,
    updateProfile,
    refreshAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

