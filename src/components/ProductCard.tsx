import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

interface ProductCardProps {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  delay?: number;
}

export default function ProductCard({ title, description, href, icon, delay = 0 }: ProductCardProps) {
  return (
    <Link
      to={href}
      className="group surface-card p-8 card-hover opacity-0 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex flex-col h-full">
        {/* Icon */}
        <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center mb-6 
                        group-hover:bg-primary/10 transition-colors">
          <div className="text-primary">
            {icon}
          </div>
        </div>

        {/* Content */}
        <h3 className="text-xl font-medium text-foreground mb-3">
          {title}
        </h3>
        <p className="text-muted-foreground text-sm leading-relaxed mb-6 flex-1">
          {description}
        </p>

        {/* Action */}
        <div className="flex items-center gap-2 text-sm text-primary opacity-0 group-hover:opacity-100 
                        transform translate-x-0 group-hover:translate-x-1 transition-all">
          <span>Open tool</span>
          <ArrowRight className="w-4 h-4" />
        </div>
      </div>
    </Link>
  );
}
