import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  formatReturnPct,
  formatSignedUsd,
  formatUsdPlain,
} from "@/components/dashboard/dashboardMetrics";

/** Illustrative values aligned with dashboard metric labels (not live data). */
const ACCOUNT_SNAPSHOT = {
  equity: 284_392.18,
  startCapital: 248_000,
  realizedPnl: 18_240.55,
  realizedReturnPct: 7.35,
  openMtm: 1_120.4,
  openTrades: 9,
  closedTrades: 142,
  winRateClosed: 0.58,
  label1Precision: 0.612,
  label1Sample: 84,
} as const;

export default function Account() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Placeholder - no actual auth
    console.log(isLogin ? "Login" : "Register", { email, password });
  };

  const s = ACCOUNT_SNAPSHOT;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 75% 45% at 50% 18%, rgba(255,255,255,0.06) 0%, transparent 52%)",
          }}
        />
        <div className="absolute right-1/4 top-1/4 h-[min(55vw,480px)] w-[min(55vw,480px)] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.12)_0%,transparent_70%)] opacity-50 blur-3xl" />
      </div>

      <div className="relative pb-24 pt-28 md:pt-32">
        <div className="container-aligned max-w-[100rem]">
          <Link
            to="/"
            className="mb-12 inline-flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-white/90"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>

          <div className="ml-auto mr-0 max-w-md md:mr-12 lg:mr-24 xl:mr-32">
            <p className="marketing-section-label opacity-0 animate-fade-up">Account</p>
            <h1 className="mt-5 text-[clamp(2rem,4vw,2.85rem)] font-extralight tracking-[-0.03em] text-white opacity-0 animate-fade-up">
              {isLogin ? "Welcome back" : "Create account"}
            </h1>
            <p
              className="mb-10 mt-4 text-[clamp(1rem,1.8vw,1.15rem)] text-white/65 opacity-0 animate-fade-up"
              style={{ animationDelay: "100ms" }}
            >
              {isLogin
                ? "Sign in to access your tools and models."
                : "Register to start building visual intelligence."}
            </p>

            {/* Form */}
            <form
              onSubmit={handleSubmit}
              className="space-y-6 opacity-0 animate-fade-up"
              style={{ animationDelay: "200ms" }}
            >
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                  placeholder="Enter your password"
                  required
                />
              </div>

              {!isLogin && (
                <div>
                  <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-md text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                    placeholder="Confirm your password"
                    required
                  />
                </div>
              )}

              <button type="submit" className="w-full px-6 py-2.5 bg-white text-[#0a0a0a] font-medium rounded-lg transition-all duration-200">
                {isLogin ? "Sign in" : "Create account"}
              </button>
            </form>

            {/* Toggle */}
            <div
              className="mt-8 text-center opacity-0 animate-fade-up"
              style={{ animationDelay: "300ms" }}
            >
              <p className="text-sm text-white/55">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-medium text-white underline-offset-4 hover:text-white hover:underline"
                >
                  {isLogin ? "Register" : "Sign in"}
                </button>
              </p>
            </div>

            {/* Illustrative dashboard-style metrics (same labels as live dashboard capital card) */}
            <div
              className="tech-surface mt-14 p-5 opacity-0 animate-fade-up md:p-6"
              style={{ animationDelay: "380ms" }}
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">Account snapshot</p>
              <p className="mt-2 text-[12px] leading-snug text-white/55">
                Illustrative figures — mirrors dashboard metrics when you are signed in.
              </p>
              <p className="mt-4 font-digits text-[clamp(1.65rem,4vw,2.1rem)] font-semibold tabular-nums tracking-tight text-white">
                {formatUsdPlain(s.equity)}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-white/45">Equity</p>

              <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">Start capital</p>
                  <p className="font-digits text-[16px] font-semibold tabular-nums text-white/95 sm:text-[17px]">
                    {formatUsdPlain(s.startCapital)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Realized PnL</p>
                  <p className="font-digits text-[16px] font-semibold tabular-nums text-foreground/95 sm:text-[17px]">
                    {formatSignedUsd(s.realizedPnl)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">Return</p>
                  <p className="font-digits text-[16px] font-semibold tabular-nums text-white/95 sm:text-[17px]">
                    {formatReturnPct(s.realizedReturnPct)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">Open MTM</p>
                  <p className="font-digits text-[16px] font-semibold tabular-nums text-white/95 sm:text-[17px]">
                    {formatSignedUsd(s.openMtm)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Open trades</p>
                  <p className="font-digits text-[16px] font-semibold tabular-nums text-foreground/95 sm:text-[17px]">{s.openTrades}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">Closed trades</p>
                  <p className="font-digits text-[16px] font-semibold tabular-nums text-white/95 sm:text-[17px]">{s.closedTrades}</p>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Win rate (closed)</p>
                      <p className="font-digits text-[16px] font-semibold tabular-nums text-foreground/95 sm:text-[17px]">
                        {(s.winRateClosed * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">Label 1 precision</p>
                      <p className="font-digits text-[16px] font-semibold tabular-nums text-white/95 sm:text-[17px]">
                        {(s.label1Precision * 100).toFixed(1)}% (n={s.label1Sample})
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <Link
                to="/dashboard/demo"
                className="mt-5 inline-block text-[12px] font-medium text-white/80 transition hover:text-white hover:underline"
              >
                View dashboard demo →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
