/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional full API origin (no path). Unset = same-origin + Vite dev proxy. */
  readonly VITE_API_BASE_URL?: string;
  /** Optional: founder inbox for the Founders page email CTA. Unset = link to /contact instead. */
  readonly VITE_FOUNDER_EMAIL?: string;
  /** Optional: Web3Forms access key (web3forms.com) — sends contact form to your email without a backend. */
  readonly VITE_WEB3FORMS_ACCESS_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
