"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "./types";
import { createSessionRestorer } from "./session-restorer";

export function useAuthSession(api: <T>(url: string, options?: RequestInit) => Promise<T>, expiredEvent: string) {
  const [user, assignUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authError, setAuthError] = useState("");
  const [invitation, setInvitation] = useState(false);
  const restore = useRef<ReturnType<typeof createSessionRestorer> | null>(null);
  const setUser = useCallback((value: User | null) => {
    restore.current?.setUser(value);
    assignUser(value);
    setAuthLoaded(true);
    setAuthError("");
  }, []);
  useEffect(() => {
    const session = createSessionRestorer(api, {
      onSession(response) {
        assignUser(response.user);
        setInvitation(response.invitationRequired);
        setAuthError("");
        setAuthLoaded(true);
      },
      onFailure(message) {
        setAuthLoaded(true);
        setAuthError(message);
      },
      onExpired() { window.dispatchEvent(new Event(expiredEvent)); },
    });
    restore.current = session;
    const resume = () => { if (document.visibilityState !== "hidden") void session.refresh(); };
    const online = () => { if (document.visibilityState !== "hidden") session.reconnect(); };
    window.addEventListener("online", online);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    const interval = setInterval(resume, 5 * 60 * 1000);
    void session.refresh();
    return () => {
      session.dispose();
      if (restore.current === session) restore.current = null;
      clearInterval(interval);
      window.removeEventListener("online", online);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [api, expiredEvent]);
  const reconnect = useCallback(() => restore.current?.reconnect(), []);
  return { user, setUser, authLoaded, authError, invitation, reconnect };
}
