import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("rounded-md bg-white/[0.06] motion-safe:animate-skeleton", className)} {...props} />;
}

export { Skeleton };
