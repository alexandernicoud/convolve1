import { useParams } from "react-router-dom";
import BacktestWorkspace from "@/features/backtest/BacktestWorkspace";

export default function BacktesterResults() {
  const { runId } = useParams();
  return <BacktestWorkspace key={runId} />;
}
