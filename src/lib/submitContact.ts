/**
 * Delivers contact form without a custom backend:
 * 1. If `VITE_WEB3FORMS_ACCESS_KEY` is set — POST to Web3Forms (free at web3forms.com) → email to your inbox.
 * 2. Else if `VITE_FOUNDER_EMAIL` is set — opens the user's mail client with a prefilled mailto.
 * 3. Else — returns an error (configure at least one).
 */

export type ContactPayload = {
  name: string;
  email: string;
  message: string;
};

export type ContactResult =
  | { ok: true; mode: "web3forms" }
  | { ok: true; mode: "mailto" }
  | { ok: false; error: string };

const WEB3_KEY = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY?.trim();

function getFounderEmail(): string | undefined {
  return import.meta.env.VITE_FOUNDER_EMAIL?.trim() || undefined;
}

export async function submitContact(payload: ContactPayload): Promise<ContactResult> {
  if (WEB3_KEY) {
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3_KEY,
          subject: `Convolve contact — ${payload.name}`,
          name: payload.name,
          email: payload.email,
          replyto: payload.email,
          message: payload.message,
        }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string };
      if (!res.ok || !data.success) {
        return { ok: false, error: data.message || "Could not send message. Try again." };
      }
      return { ok: true, mode: "web3forms" };
    } catch {
      return { ok: false, error: "Network error. Check your connection and try again." };
    }
  }

  const to = getFounderEmail();
  if (!to) {
    return {
      ok: false,
      error:
        "Contact delivery isn’t configured. Add VITE_WEB3FORMS_ACCESS_KEY (web3forms.com) or VITE_FOUNDER_EMAIL in your environment.",
    };
  }

  const body = [
    `From: ${payload.name}`,
    `Reply-to: ${payload.email}`,
    "",
    payload.message,
  ].join("\n");

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    `Convolve contact — ${payload.name}`,
  )}&body=${encodeURIComponent(body)}`;

  window.location.href = mailto;
  return { ok: true, mode: "mailto" };
}
