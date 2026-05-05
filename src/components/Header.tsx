import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import logoMark from "@/assets/convolve-mark.png";
import { isCompactHeaderPathname, useHeaderReveal } from "@/context/HeaderRevealContext";
import { cn } from "@/lib/utils";
import { PRODUCT_PIPELINE_ITEMS } from "@/components/products/productPipelineLinks";

function MainNav({
  productsOpen,
  setProductsOpen,
}: {
  productsOpen: boolean;
  setProductsOpen: (v: boolean) => void;
}) {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const isProductsActive =
    location.pathname === "/products" ||
    location.pathname.startsWith("/products/") ||
    location.pathname.startsWith("/tools/generator") ||
    location.pathname.startsWith("/tools/trainer") ||
    location.pathname.startsWith("/tools/backtester") ||
    location.pathname.startsWith("/tools/deploy") ||
    location.pathname.startsWith("/tools/analysis") ||
    location.pathname.startsWith("/dashboard");
  const isHomeLanding =
    location.pathname === "/" ||
    location.pathname === "/vision" ||
    location.pathname === "/home2" ||
    location.pathname === "/home3";

  return (
    <nav className="flex h-20 w-full items-center justify-between gap-3 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4">
      <div className="flex min-w-0 items-center md:justify-self-start">
        <Link to="/" className="group flex shrink-0 items-center gap-1.5">
          <img src={logoMark} alt="" className="h-11 w-11 object-contain" />
          <span className="font-sans text-xl font-bold tracking-tight text-white">convolve.</span>
        </Link>
      </div>

      <div className="hidden min-w-0 md:flex md:justify-center md:justify-self-center">
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 lg:gap-x-8",
            "rounded-full border border-white/[0.1] bg-white/[0.06] px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md lg:px-5"
          )}
        >
          <Link
            to="/"
            className={cn(
              "whitespace-nowrap text-sm transition-colors",
              isHomeLanding ?
                isActive("/") || isActive("/vision") ?
                  "text-white"
                : "text-white/55 hover:text-white/90"
              : isActive("/") || isActive("/vision") ?
                "text-foreground"
              : "text-muted-foreground hover:text-foreground"
            )}
          >
            Home
          </Link>

          <div
            className="relative"
            onMouseEnter={() => setProductsOpen(true)}
            onMouseLeave={() => setProductsOpen(false)}
          >
            <div className="flex items-center gap-0.5">
              <Link
                to="/products"
                className={cn(
                  "whitespace-nowrap text-sm transition-colors",
                  isHomeLanding ?
                    isProductsActive ?
                      "text-white"
                    : "text-white/55 hover:text-white/90"
                  : isProductsActive ?
                    "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
                )}
              >
                Products
              </Link>
              <span className={cn(isHomeLanding ? "text-white/40" : "text-muted-foreground/80")} aria-hidden>
                <ChevronDown className={`h-4 w-4 transition-transform ${productsOpen ? "rotate-180" : ""}`} />
              </span>
            </div>

            {productsOpen && (
              <div className="absolute left-1/2 top-full z-[100] w-max max-w-[min(100vw-1rem,17rem)] -translate-x-1/2 pt-2 animate-fade-in">
                <div className="w-max min-w-0 rounded-lg border border-border bg-card py-1.5 shadow-xl">
                  <div className="group/hub relative">
                    <Link
                      to="/products"
                      className="flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
                    >
                      Product hub
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
                    </Link>
                    <div
                      className="pointer-events-none invisible absolute left-[calc(100%-1px)] top-0 z-[110] ml-0 w-max max-w-[min(100vw-1rem,15rem)] rounded-lg border border-border bg-card py-1.5 pl-1.5 pr-1.5 shadow-xl opacity-0 transition-[opacity,visibility] duration-150 before:absolute before:-left-2 before:top-0 before:h-full before:w-2 group-hover/hub:pointer-events-auto group-hover/hub:visible group-hover/hub:opacity-100"
                    >
                      <div className="px-1.5 pb-1 pt-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                        Pipeline
                      </div>
                      <div className="flex max-h-[min(60vh,22rem)] flex-col gap-0 overflow-y-auto pb-0.5">
                        {PRODUCT_PIPELINE_ITEMS.map((item) => (
                          <Link
                            key={item.href}
                            to={item.href}
                            className="rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/80"
                          >
                            <span className="block text-[11px] font-semibold leading-tight text-foreground">{item.label}</span>
                            <span className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                              {item.description}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border/60">
                    <Link
                      to="/dashboard"
                      className="block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
                    >
                      Dashboard
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Link
            to="/about"
            className={cn(
              "whitespace-nowrap text-sm transition-colors",
              isHomeLanding ?
                isActive("/about") ?
                  "text-white"
                : "text-white/55 hover:text-white/90"
              : isActive("/about") ?
                "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground"
            )}
          >
            About
          </Link>
          <Link
            to="/contact"
            className={cn(
              "whitespace-nowrap text-sm transition-colors",
              isHomeLanding ? "text-white/55 hover:text-white/90" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Contact
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 sm:gap-3 md:justify-self-end">
        <Link
          to={isHomeLanding ? "/contact" : "/products"}
          className={cn(
            "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs transition-all duration-200 sm:px-4 sm:py-2 sm:text-sm",
            isHomeLanding ?
              "border-white/20 bg-transparent text-white/85 hover:border-white/35 hover:text-white"
            : "border-white/25 bg-white/[0.06] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-sm hover:border-white/40 hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-white/20"
          )}
        >
          {isHomeLanding ? "Get early access" : "Free trial"}
        </Link>
      </div>
    </nav>
  );
}

export default function Header() {
  const [productsOpen, setProductsOpen] = useState(false);
  const location = useLocation();
  const { headerRevealed, setHeaderRevealed, revealMode } = useHeaderReveal();

  const compact = isCompactHeaderPathname(location.pathname);
  const expanded = !revealMode || headerRevealed;
  const seamlessUnderHeader = location.pathname === "/dashboard";

  const nav = (
    <MainNav productsOpen={productsOpen} setProductsOpen={setProductsOpen} />
  );

  if (compact) {
    return (
      <div className="pointer-events-none fixed left-0 right-0 top-0 z-50 p-2.5">
        <div
          className={cn(
            "pointer-events-auto rounded-2xl border border-transparent bg-transparent shadow-none transition-[height] duration-200 ease-out",
            expanded ? "h-20 overflow-visible" : "h-3 overflow-hidden"
          )}
          onMouseEnter={() => revealMode && setHeaderRevealed(true)}
          onMouseLeave={() => revealMode && setHeaderRevealed(false)}
        >
          <div className="h-20 px-4 sm:px-6 lg:px-8">{nav}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fixed left-0 right-0 top-0 z-50 bg-transparent transition-[height] duration-200 ease-out",
        seamlessUnderHeader ? "border-b-0" : "border-b border-transparent",
        expanded ? "h-20 overflow-visible" : "h-3 overflow-hidden"
      )}
      onMouseEnter={() => revealMode && setHeaderRevealed(true)}
      onMouseLeave={() => revealMode && setHeaderRevealed(false)}
    >
      <div className="container-aligned h-20">{nav}</div>
    </div>
  );
}
