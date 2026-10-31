/**
 * Sends the contact form to the Convolve API, which stores every accepted message and
 * notifies the founder by email when configured. ``website`` is a honeypot that people
 * never see; ``elapsedMs`` is the time since the form was shown (bots submit instantly).
 */
import { fetchApi } from "@/lib/api";

export type ContactPayload = {
  name: string;
  email: string;
  message: string;
  website: string;
  elapsedMs: number;
};

export type ContactResult = { ok: true } | { ok: false; error: string };

export async function submitContact(payload: ContactPayload): Promise<ContactResult> {
  try {
    const res = await fetchApi("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.name,
        email: payload.email,
        message: payload.message,
        website: payload.website,
        elapsed_ms: Math.max(0, Math.round(payload.elapsedMs)),
      }),
    });
    if (res.ok) return { ok: true };
    let error = "Could not send your message. Please try again.";
    try {
      const body = (await res.json()) as { detail?: { message?: string } | string };
      if (typeof body.detail === "string") error = body.detail;
      else if (body.detail?.message) error = body.detail.message;
    } catch {
      /* not JSON */
    }
    return { ok: false, error };
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }
}
