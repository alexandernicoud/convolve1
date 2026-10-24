from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import pandas as pd
from PIL import Image
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
import yfinance as yf
from dateutil.relativedelta import relativedelta

# Same palette / DPI as training generator `1.3_Adj_TrL.py`.
_RENDER_DPI = 100.0
_LINE_COLOR = "#1a1a1a"
_WICK_COLOR = "#1a1a1a"
_BULL_BODY = "#0d8f4a"
_BEAR_BODY = "#c41e1e"


def fetch_market_data(symbol: str, interval: str = "1d", start: Optional[date] = None) -> pd.DataFrame:
    """Adjusted OHLCV bars up to today. The last bar may still be forming; callers that
    decide or settle trades must drop it (bot_schedule.completed_bars)."""
    end = datetime.now(timezone.utc).date() + timedelta(days=1)  # yfinance's end is exclusive
    start = start or (end - relativedelta(months=6))
    return yf.Ticker(symbol).history(
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        interval=interval,
        auto_adjust=True,
    )


def _make_figure_pair(img_dim: int):
    fig = plt.figure(
        figsize=(img_dim / _RENDER_DPI, img_dim / _RENDER_DPI),
        dpi=_RENDER_DPI,
        facecolor="none",
    )
    fig.patch.set_alpha(0.0)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_facecolor("none")
    ax.patch.set_alpha(0.0)
    ax.axis("off")
    for spine in ax.spines.values():
        spine.set_visible(False)
    return fig, ax


def _savefig_transparent(fig, path: str) -> None:
    fig.savefig(
        path,
        format="png",
        dpi=_RENDER_DPI,
        facecolor="none",
        edgecolor="none",
        transparent=True,
        bbox_inches=None,
        pad_inches=0,
    )
    plt.close(fig)


def generate_chart_image(data: pd.DataFrame, output_path: str, image_size: int) -> None:
    """Training-identical square chart: transparent, no title/axes, candlesticks when OHLC exists."""
    if data is None or data.empty or "Close" not in data.columns:
        raise ValueError("chart data needs a Close column")
    dim = max(64, min(int(image_size or 224), 1024))
    fig, ax = _make_figure_pair(dim)
    use_candles = all(c in data.columns for c in ("Open", "High", "Low", "Close"))
    if use_candles:
        o = data["Open"].to_numpy(dtype=np.float64, copy=False)
        h = data["High"].to_numpy(dtype=np.float64, copy=False)
        l = data["Low"].to_numpy(dtype=np.float64, copy=False)
        c = data["Close"].to_numpy(dtype=np.float64, copy=False)
        n = len(c)
        if n < 2:
            plt.close(fig)
            raise ValueError("candlestick needs at least 2 bars")
        ymin = float(np.min(l))
        ymax = float(np.max(h))
        span = ymax - ymin
        pad = max(span * 0.02, 1e-9) if span > 0 else 1.0
        ax.set_xlim(-0.5, n - 0.5)
        ax.set_ylim(ymin - pad, ymax + pad)
        half_w = 0.35
        min_body = max((ymax - ymin) * 0.0015, 1e-9)
        for i in range(n):
            oi, hi, li, ci = o[i], h[i], l[i], c[i]
            ax.add_line(
                Line2D([i, i], [li, hi], color=_WICK_COLOR, linewidth=1.0, zorder=1, antialiased=False)
            )
            top = max(oi, ci)
            bot = min(oi, ci)
            body_h = abs(ci - oi)
            if body_h < min_body:
                mid = 0.5 * (oi + ci)
                bot = mid - min_body * 0.5
                top = mid + min_body * 0.5
            color = _BULL_BODY if ci >= oi else _BEAR_BODY
            ax.add_patch(
                Rectangle(
                    (i - half_w, bot),
                    2 * half_w,
                    top - bot,
                    facecolor=color,
                    edgecolor=color,
                    linewidth=0.5,
                    zorder=2,
                    antialiased=False,
                )
            )
    else:
        y = data["Close"].to_numpy(dtype=np.float64, copy=False)
        n = len(y)
        if n < 2:
            plt.close(fig)
            raise ValueError("line chart needs at least 2 points")
        x = np.arange(n, dtype=np.float64)
        ymin = float(np.min(y))
        ymax = float(np.max(y))
        span = ymax - ymin
        pad = max(span * 0.02, 1e-9) if span > 0 else 1.0
        ax.set_xlim(-0.5, n - 0.5)
        ax.set_ylim(ymin - pad, ymax + pad)
        ax.plot(
            x,
            y,
            color=_LINE_COLOR,
            linewidth=1.0,
            solid_capstyle="butt",
            solid_joinstyle="miter",
            antialiased=False,
        )
    ax.set_aspect("auto")
    _savefig_transparent(fig, output_path)


def run_model_inference(model, image_path: str, img_size: Optional[int] = None) -> float:
    """P(label 1) for one chart through the shared Trainer/Backtester contract (cnn_inference):
    the model's own input size, and column 1 of a 2-unit softmax head. ``img_size`` is unused
    and kept for callers that still pass it."""
    import tensorflow as tf

    from app.services.cnn_inference import model_io, positive_probability, preprocess_tensor

    io = model_io(model)
    batch = tf.expand_dims(preprocess_tensor(image_path, io.input_size), axis=0)
    raw = model(batch, training=False)
    return float(positive_probability(np.asarray(raw), io.head)[0])


def _prediction_loss(predictions):
    # Explain P(label 1): the sigmoid unit, or column 1 of a 2-unit softmax.
    if predictions.shape[-1] == 1:
        return predictions[:, 0]
    return predictions[:, 1]


def _normalize_cam(heat: np.ndarray, img_size: int) -> np.ndarray:
    heat = np.asarray(heat, dtype=np.float32)
    heat = np.maximum(heat, 0.0)
    heat = heat / (float(heat.max()) + 1e-8)
    return cv2.resize(heat, (img_size, img_size))


def _save_heatmap_overlay(image_path: str, heat: np.ndarray, img_size: int, output_path: str) -> None:
    heatmap_u8 = np.uint8(255 * np.clip(heat, 0.0, 1.0))
    heatmap_color = cv2.applyColorMap(heatmap_u8, cv2.COLORMAP_JET)
    heatmap_rgb = cv2.cvtColor(heatmap_color, cv2.COLOR_BGR2RGB)
    base = Image.open(image_path).convert("RGB").resize((img_size, img_size))
    overlay = Image.blend(base, Image.fromarray(heatmap_rgb), 0.45)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    overlay.save(output_path)


def generate_gradcam_heatmap(
    model, image_path: str, img_size: int, output_path: str
) -> None:
    """Always write a chart overlay. Prefer Grad-CAM; fall back to input-gradient saliency."""
    import tensorflow as tf

    from app.services.cnn_inference import model_io, preprocess_tensor

    img_size = model_io(model).input_size[0]
    img_arr = tf.expand_dims(preprocess_tensor(image_path, model_io(model).input_size), axis=0)

    # Keras 3 Sequential has no .output until it has been called.
    _ = model(img_arr, training=False)

    heat = None
    conv_layers = [layer for layer in model.layers if isinstance(layer, tf.keras.layers.Conv2D)]
    last_conv_name = conv_layers[-1].name if conv_layers else None

    if last_conv_name:
        try:
            last_conv = model.get_layer(last_conv_name)
            grad_model = tf.keras.Model(
                inputs=model.inputs,
                outputs=[last_conv.output, model.output],
            )
            with tf.GradientTape() as tape:
                conv_outputs, predictions = grad_model(img_arr, training=False)
                loss = _prediction_loss(predictions)
            grads = tape.gradient(loss, conv_outputs)
            if grads is not None:
                pooled = tf.reduce_mean(grads, axis=(0, 1, 2))
                cam = tf.reduce_sum(conv_outputs[0] * pooled, axis=-1).numpy()
                heat = _normalize_cam(cam, img_size)
        except Exception:
            heat = None

        if heat is None:
            try:
                inp = tf.keras.Input(shape=(int(img_size), int(img_size), 3))
                x = inp
                conv_out = None
                for layer in model.layers:
                    x = layer(x)
                    if layer.name == last_conv_name:
                        conv_out = x
                if conv_out is None:
                    raise ValueError(f"Conv layer {last_conv_name} not found")
                rebuilt = tf.keras.Model(inp, [conv_out, x])
                with tf.GradientTape() as tape:
                    conv_outputs, predictions = rebuilt(img_arr, training=False)
                    loss = _prediction_loss(predictions)
                grads = tape.gradient(loss, conv_outputs)
                if grads is not None:
                    pooled = tf.reduce_mean(grads, axis=(0, 1, 2))
                    cam = tf.reduce_sum(conv_outputs[0] * pooled, axis=-1).numpy()
                    heat = _normalize_cam(cam, img_size)
            except Exception:
                heat = None

    if heat is None:
        watched = tf.identity(img_arr)
        with tf.GradientTape() as tape:
            tape.watch(watched)
            predictions = model(watched, training=False)
            loss = _prediction_loss(predictions)
        grads = tape.gradient(loss, watched)
        if grads is None:
            raise ValueError("Could not compute a heatmap (Grad-CAM and saliency both failed)")
        sal = tf.reduce_mean(tf.abs(grads[0]), axis=-1).numpy()
        heat = _normalize_cam(sal, img_size)

    _save_heatmap_overlay(image_path, heat, img_size, output_path)
