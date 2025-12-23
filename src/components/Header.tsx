import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

const products = [
  { name: "Chart Labeler", href: "/products/labeler" },
  { name: "Labeling Optimizer", href: "/products/optimizer" },
  { name: "Generator", href: "/products/generator" },
  { name: "Trainer", href: "/products/trainer" },
  { name: "Backtester", href: "/products/backtester" },
];

export default function Header() {
  const [productsOpen, setProductsOpen] = useState(false);
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
      <div className="container-wide">
        <nav className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link 
            to="/" 
            className="flex items-center gap-2 group"
          >
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">c</span>
            </div>
            <span className="text-foreground font-medium text-lg tracking-tight">
              convolve.
            </span>
          </Link>

          {/* Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <Link 
              to="/" 
              className={`text-sm transition-colors ${
                isActive('/') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Home
            </Link>
            <Link 
              to="/vision" 
              className={`text-sm transition-colors ${
                isActive('/vision') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Vision
            </Link>
            
            {/* Products Dropdown */}
            <div 
              className="relative"
              onMouseEnter={() => setProductsOpen(true)}
              onMouseLeave={() => setProductsOpen(false)}
            >
              <button 
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Products
                <ChevronDown className={`w-4 h-4 transition-transform ${productsOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {productsOpen && (
                <div className="absolute top-full left-0 pt-2 animate-fade-in">
                  <div className="bg-card border border-border rounded-lg py-2 min-w-[200px] shadow-xl">
                    {products.map((product) => (
                      <Link
                        key={product.href}
                        to={product.href}
                        className="block px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      >
                        {product.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Link 
              to="/founder" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Founder
            </Link>
            <Link 
              to="/contact" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Contact
            </Link>
          </div>

          {/* CTA */}
          <Link 
            to="/account" 
            className="btn-secondary text-sm"
          >
            My Account
          </Link>
        </nav>
      </div>
    </header>
  );
}
