import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

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

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-card/20 to-background" />
        <div className="absolute top-1/3 right-1/3 w-[500px] h-[300px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative pt-32 pb-24">
        <div className="container-wide">
          {/* Back link */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-12"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>

          {/* Page Content - Right Shifted */}
          <div className="max-w-md ml-auto mr-0 md:mr-12 lg:mr-24 xl:mr-32">
            <h1 className="text-4xl md:text-5xl font-semibold text-foreground mb-6 opacity-0 animate-fade-up tracking-tight">
              {isLogin ? "Welcome back" : "Create account"}
            </h1>
            <p
              className="text-lg text-muted-foreground mb-10 opacity-0 animate-fade-up"
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
                <label className="block text-sm font-medium text-foreground mb-2">
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
                  <label className="block text-sm font-medium text-foreground mb-2">
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

              <button type="submit" className="w-full btn-primary">
                {isLogin ? "Sign in" : "Create account"}
              </button>
            </form>

            {/* Toggle */}
            <div
              className="mt-8 text-center opacity-0 animate-fade-up"
              style={{ animationDelay: "300ms" }}
            >
              <p className="text-sm text-muted-foreground">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-primary hover:underline font-medium"
                >
                  {isLogin ? "Register" : "Sign in"}
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
