from datetime import datetime

import cv2
import numpy as np
import pandas as pd
import plotly.graph_objects as go
from PIL import Image
import yfinance as yf
from dateutil.relativedelta import relativedelta


def fetch_market_data(symbol: str) -> pd.DataFrame:
    end = datetime.utcnow()
    start = end - relativedelta(months=6)
    data = yf.Ticker(symbol).history(
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        interval="1d",
    )
    return data


def generate_chart_image(data: pd.DataFrame, output_path: str, image_size: int) -> None:
    fig = go.Figure()
    fig.add_trace(
        go.Candlestick(
            x=data.index,
            open=data["Open"],
            high=data["High"],
            low=data["Low"],
            close=data["Close"],
            name="Candlestick",
        )
    )
    fig.update_layout(
        xaxis=dict(visible=False),
        yaxis=dict(visible=False),
        showlegend=False,
        margin=dict(l=0, r=0, t=0, b=0),
        plot_bgcolor="white",
        paper_bgcolor="white",
        xaxis_rangeslider_visible=False,
        width=image_size,
        height=image_size,
    )
    fig.write_image(output_path)


def _normalize_prediction(prediction: np.ndarray) -> float:
    if prediction.ndim == 2 and prediction.shape[0] == 1:
        return float(prediction[0][0])
    if prediction.ndim == 1:
        return float(prediction[0])
    return float(np.ravel(prediction)[0])


def run_model_inference(model, image_path: str, img_size: int) -> float:
    import tensorflow as tf

    img = tf.keras.utils.load_img(image_path, target_size=(img_size, img_size))
    img_arr = tf.keras.utils.img_to_array(img)
    img_arr = np.expand_dims(img_arr, axis=0) / 255.0
    prediction = model.predict(img_arr, verbose=0)
    return _normalize_prediction(prediction)


def generate_gradcam_heatmap(
    model, image_path: str, img_size: int, output_path: str
) -> None:
    import tensorflow as tf

    img = tf.keras.utils.load_img(image_path, target_size=(img_size, img_size))
    img_arr = tf.keras.utils.img_to_array(img)
    img_arr = np.expand_dims(img_arr, axis=0) / 255.0

    conv_layers = [layer for layer in model.layers if isinstance(layer, tf.keras.layers.Conv2D)]
    if not conv_layers:
        raise ValueError("No Conv2D layers found for Grad-CAM")

    last_conv = conv_layers[-1].name

    grad_model = tf.keras.models.Model(
        [model.inputs],
        [model.get_layer(last_conv).output, model.output],
    )

    with tf.GradientTape() as tape:
        conv_outputs, predictions = grad_model(img_arr)
        loss = predictions[:, 0]

    grads = tape.gradient(loss, conv_outputs)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))
    conv_outputs = conv_outputs[0]
    heatmap = tf.reduce_sum(conv_outputs * pooled_grads, axis=-1)
    heatmap = tf.maximum(heatmap, 0) / (tf.reduce_max(heatmap) + 1e-8)
    heatmap = heatmap.numpy()

    heatmap_resized = cv2.resize(heatmap, (img_size, img_size))
    heatmap_u8 = np.uint8(255 * heatmap_resized)
    heatmap_color = cv2.applyColorMap(heatmap_u8, cv2.COLORMAP_JET)
    heatmap_rgb = cv2.cvtColor(heatmap_color, cv2.COLOR_BGR2RGB)

    alpha = np.clip(heatmap_resized * 255, 0, 255).astype(np.uint8)
    rgba = np.dstack([heatmap_rgb, alpha])
    Image.fromarray(rgba, mode="RGBA").save(output_path)


