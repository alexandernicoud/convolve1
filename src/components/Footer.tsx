import { Link } from "react-router-dom";
import logoMark from "@/assets/convolve-mark.png";

const links = [
  { label: "Home", href: "/" },
  { label: "Vision", href: "/vision" },
  { label: "Home 2", href: "/home2" },
  { label: "Home 3", href: "/home3" },
  { label: "Products", href: "/products" },
  { label: "Contact", href: "/contact" },
  { label: "Account", href: "/account" },
];

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-background/90 backdrop-blur-md">
      <div className="container-aligned py-12 md:py-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
          <Link to="/" className="flex items-center gap-3 shrink-0">
            <img src={logoMark} alt="" className="h-8 w-8 object-contain" width={32} height={32} />
            <span className="font-sans text-lg font-normal tracking-tight text-foreground">convolve.</span>
          </Link>
          <nav className="flex flex-wrap gap-x-8 gap-y-3">
            {links.map(({ label, href }) => (
              <Link
                key={href}
                to={href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="mt-10 text-center text-xs text-muted-foreground/80 md:text-left">
          © {new Date().getFullYear()} Convolve. Visual AI for trading research.
        </p>
      </div>
    </footer>
  );
}
