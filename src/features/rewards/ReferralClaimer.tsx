import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { claimReferral } from "./api";
import { REFERRAL_STORAGE_KEY, pendingReferral, shouldForgetAfter } from "./model";

/** Once someone who arrived through an invite link is signed in, links their account to the ambassador. */
export function ReferralClaimer() {
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    let code: string | null = null;
    try {
      code = pendingReferral(localStorage);
    } catch {
      return;
    }
    if (!code) return;
    void claimReferral(code)
      .then((status) => {
        if (shouldForgetAfter(status)) localStorage.removeItem(REFERRAL_STORAGE_KEY);
      })
      .catch(() => undefined);
  }, [uid]);
  return null;
}
