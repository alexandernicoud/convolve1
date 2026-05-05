import os
import sys
import json
import time
from pathlib import Path
from typing import Dict, Any, Callable
import subprocess

# ========= STYLING =========
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

CONVOLVE_CMAP = LinearSegmentedColormap.from_list(
    "convolve_cmap",
    [
        (0.00, "#05040D"),  # near-black indigo
        (0.18, "#1B1464"),  # deep indigo
        (0.40, "#2E3AEE"),  # electric blue
        (0.62, "#8B5CF6"),  # vivid purple
        (0.82, "#EC4899"),  # hot pink
        (1.00, "#FFD1F2"),  # soft pink highlight
    ],
    N=256
)

PALETTE = {
    "fg": "#E7E9FF",
    "muted": "#9AA3C7",
    "purple": "#8B5CF6",
    "blue": "#3B82F6",
    "pink": "#EC4899",
}

def apply_dark_style():
    plt.style.use("dark_background")
    mpl.rcParams.update({
        "figure.facecolor": "none",
        "axes.facecolor": "none",
        "savefig.facecolor": "none",
        "text.color": PALETTE["fg"],
        "axes.labelcolor": PALETTE["muted"],
        "xtick.color": PALETTE["muted"],
        "ytick.color": PALETTE["muted"],
        "axes.edgecolor": "none",
        "grid.color": PALETTE["muted"],
        "grid.alpha": 0.15,
        "font.family": "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    })

def save_fig_svg(path_svg: str, fig=None):
    if fig is None:
        fig = plt.gcf()

    # Ensure transparent background and clean styling
    fig.patch.set_alpha(0.0)
    for ax in fig.axes:
        ax.set_facecolor("none")
        ax.axis("off")  # Remove axes completely
        # Remove all spines
        for spine in ax.spines.values():
            spine.set_visible(False)
        # Remove ticks and labels
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_xlabel("")
        ax.set_ylabel("")

    # Clean export with minimal margins
    plt.tight_layout(pad=0.2)
    fig.savefig(
        path_svg,
        format="svg",
        transparent=True,
        bbox_inches="tight",
        pad_inches=0.05,
        dpi=150
    )
    plt.close(fig)

def run_backtester(config: Dict[str, Any], run_dir: Path, progress_cb: Callable):
    """Run the backtester script"""

    model_path = config['model_path']
    dataset_path = config.get('dataset_path')
    sample_size = config.get('sample_size', 'all')
    confidence_threshold = config.get('confidence_threshold', 0.5)
    tp_pct = config.get('tp_pct', 2.0)
    sl_pct = config.get('sl_pct', 2.0)
    img_size = config.get('img_size', 224)

    # Apply dark styling globally
    apply_dark_style()

    progress_cb("starting", 0.05, {"message": "Initializing backtester..."})

    # Create output directory
    output_dir = run_dir / "backtest_output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find the backtester script
    script_path = Path(__file__).parent.parent.parent / "3.2_Tester_Pro_v2.py"
    if not script_path.exists():
        raise FileNotFoundError(f"Backtester script not found at {script_path}")

    progress_cb("loading", 0.1, {"message": "Loading model and data..."})

    # Prepare command arguments
    cmd = [
        sys.executable,
        str(script_path),
        "--model_path", model_path,
        "--dataset_path", dataset_path,
        "--sample_size", str(sample_size),
        "--confidence_threshold", str(confidence_threshold),
        "--tp_pct", str(tp_pct),
        "--sl_pct", str(sl_pct),
        "--img_size", str(img_size),
        "--output_dir", str(output_dir)
    ]

    progress_cb("running", 0.2, {"message": "Running backtest analysis..."})

    print(f"Running backtester command: {' '.join(cmd)}")
    print(f"Working directory: {script_path.parent}")
    print(f"Model path: {model_path}")
    print(f"Dataset path: {dataset_path}")

    try:
        # Run the backtester script
        result = subprocess.run(
            cmd,
            cwd=str(script_path.parent),
            capture_output=True,
            text=True,
            timeout=1800  # 30 minutes timeout
        )

        if result.returncode != 0:
            error_msg = result.stderr[:500] if result.stderr else "Unknown error"
            progress_cb("error", 0.0, {"message": f"Backtest failed: {error_msg}"})
            return

        progress_cb("processing", 0.8, {"message": "Processing results..."})

        # Generate additional SVG charts from the output
        results_file = output_dir / "backtest_results.json"
        if results_file.exists():
            with open(results_file, 'r') as f:
                results = json.load(f)

            # Generate equity curve SVG
            if 'equity_curve' in results:
                plt.figure(figsize=(10, 6))
                equity = results['equity_curve']
                plt.plot(equity, color=PALETTE["blue"], linewidth=2)
                plt.title("Equity Curve", fontsize=14, color=PALETTE["fg"])
                plt.grid(True, alpha=0.15)
                save_fig_svg(str(output_dir / "equity_curve.svg"))

            # Generate threshold scan if available
            if 'threshold_scan' in results:
                plt.figure(figsize=(8, 6))
                scan_data = results['threshold_scan']
                plt.plot(scan_data['thresholds'], scan_data['accuracies'],
                        color=PALETTE["purple"], linewidth=2, label='Accuracy')
                plt.plot(scan_data['thresholds'], scan_data['precisions'],
                        color=PALETTE["pink"], linewidth=2, label='Precision')
                plt.xlabel("Confidence Threshold", color=PALETTE["muted"])
                plt.ylabel("Score", color=PALETTE["muted"])
                plt.legend(loc='lower center', bbox_to_anchor=(0.5, -0.15), ncol=2)
                plt.grid(True, alpha=0.15)
                save_fig_svg(str(output_dir / "threshold_scan.svg"))

        progress_cb("done", 1.0, {
            "message": "Backtest completed successfully!",
            "charts": {
                "equity_curve": f"/runs/backtester/{run_dir.name}/charts/equity_curve.svg",
                "threshold_scan": f"/runs/backtester/{run_dir.name}/charts/threshold_scan.svg"
            }
        })

    except subprocess.TimeoutExpired:
        progress_cb("error", 0.0, {"message": "Backtest timed out after 30 minutes"})
    except Exception as e:
        progress_cb("error", 0.0, {"message": f"Backtest failed: {str(e)[:200]}"})
        raise

