import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const productInfo: Record<string, { title: string; description: string }> = {
  labeler: {
    title: "Chart Labeler",
    description: "Manually label candlestick charts for training data creation. Coming soon.",
  },
  optimizer: {
    title: "Labeling Optimizer",
    description: "Optimize labeling parameters for better training outcomes. Coming soon.",
  },
};

export default function ProductPlaceholder() {
  const { id } = useParams();
  const product = productInfo[id || ''] || { title: "Product", description: "Coming soon." };

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container-narrow">
        <Link 
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>

        <div className="text-center py-24">
          <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
            {product.title}
          </h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            {product.description}
          </p>
        </div>
      </div>
    </div>
  );
}
