/** Title shown in the pipeline top bar (matches Dashboard “Overview” strip). */
export function getPipelineTitle(pathname: string): string {
  if (pathname === "/dashboard") return "Overview";
  if (pathname === "/dashboard/portfolio") return "My Portfolio";
  if (pathname === "/dashboard/trade-history") return "Trade history";
  if (pathname === "/dashboard/community-ranking") return "Community ranking";
  if (pathname === "/dashboard/bots") return "All bots";
  if (pathname.startsWith("/tools/generator")) return "Generator";
  if (pathname.startsWith("/tools/analysis")) return "Analysis";
  if (pathname.startsWith("/tools/trainer")) return "Trainer";
  if (pathname.startsWith("/tools/backtester")) return "Backtester";
  if (pathname.startsWith("/tools/deploy")) return "Deploy";
  if (pathname.startsWith("/tools/run-log")) return "Run history";
  if (pathname.startsWith("/products/labeling-optimizer")) return "Labeling optimizer";
  if (pathname.startsWith("/products/trainer/analysis")) return "Analysis";
  return "Workspace";
}
