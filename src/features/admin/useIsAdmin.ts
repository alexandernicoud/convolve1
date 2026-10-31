import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchApi } from "@/lib/api";

const cache = new Map<string, Promise<boolean>>();

function loadIsAdmin(userId: string): Promise<boolean> {
  let p = cache.get(userId);
  if (!p) {
    p = fetchApi("/api/me")
      .then((r) => (r.ok ? (r.json() as Promise<{ is_admin?: boolean }>) : null))
      .then((me) => me?.is_admin === true)
      .catch(() => false);
    cache.set(userId, p);
  }
  return p;
}

/** Whether the signed-in account may open the admin console. The server decides; this only hides links. */
export function useIsAdmin(): boolean {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    if (!userId) {
      setAdmin(false);
      return;
    }
    void loadIsAdmin(userId).then((v) => live && setAdmin(v));
    return () => {
      live = false;
    };
  }, [userId]);
  return admin;
}
