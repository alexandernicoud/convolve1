import os
import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import cv2
import tensorflow as tf
from tensorflow.keras import Model

# ========= UNIFIED COLORMAP =========
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

# ========= STYLING =========
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

def save_fig_png(path_png: str, fig=None):
    if fig is None:
        fig = plt.gcf()

    # Ensure transparent background
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

    # Clean export with no margins
    plt.tight_layout(pad=0.1)
    fig.savefig(
        path_png,
        format="png",
        transparent=True,
        bbox_inches="tight",
        pad_inches=0.05,
        dpi=250
    )

# Apply dark style globally
apply_dark_style()

# ========= EINSTELLUNGEN =========
MODEL_PATH = "msft_xbg.keras"
IMG_PATH   = "MSFT_2024-05-15_to_2024-11-15_label0.png"
IMG_SIZE   = (224, 224)
OUT_DIR    = "cnn_analysis"

MAX_FILTERS_TO_SHOW = 8          # für Filter-2x4
MAX_MAPS_TO_SHOW    = 8          # für Aktivierungen (ab Schicht 2)
ACTIVATION_CAP      = 1.0        # Aktivierungen 0..1.0
WHITE_MASK_THRESH   = 0.96       # Grad-CAM: weißen Hintergrund maskieren

os.makedirs(OUT_DIR, exist_ok=True)

# ========= Hilfsfunktionen =========
def save_fig(fig, name):
    path = os.path.join(OUT_DIR, name)
    save_fig_png(path, fig)
    plt.close(fig)
    print(f"💾 Gespeichert: {path}")

def get_seq_or_inner(model):
    if isinstance(model, tf.keras.Sequential):
        return model
    try:
        return model.get_layer("sequential")
    except Exception:
        return model

def list_conv_layers(seq):
    return [lyr for lyr in seq.layers if isinstance(lyr, tf.keras.layers.Conv2D)]

def build_forward_upto(seq, target_layer_name, img_shape):
    inp = tf.keras.Input(shape=(img_shape[0], img_shape[1], 3))
    x = inp
    for lyr in seq.layers:
        x = lyr(x)
        if lyr.name == target_layer_name:
            break
    return Model(inputs=inp, outputs=x)

def grid_shape(n, prefer_cols=8):
    cols = min(prefer_cols, max(1, n))
    rows = int(np.ceil(n / cols))
    return rows, cols

# ========= Modell & Bild laden =========
model = tf.keras.models.load_model(MODEL_PATH)
seq   = get_seq_or_inner(model)
print(f"✅ Modell geladen: {MODEL_PATH}")

img = tf.keras.utils.load_img(IMG_PATH, target_size=IMG_SIZE)
img_arr = tf.keras.utils.img_to_array(img)
img_arr = np.expand_dims(img_arr, axis=0) / 255.0

conv_layers = list_conv_layers(seq)

# ========= 1) Filter =========
all_w = []
for L in conv_layers:
    w,_ = L.get_weights()
    all_w.append(w.flatten())
all_w_flat = np.concatenate(all_w)
global_wmin, global_wmax = all_w_flat.min(), all_w_flat.max()

for L in conv_layers:
    w,_ = L.get_weights()
    n = min(w.shape[-1], MAX_FILTERS_TO_SHOW)
    fig, axes = plt.subplots(2, 4, figsize=(12, 6))
    axes = axes.flatten()
    for i in range(n):
        f = np.mean(w[:, :, :, i], axis=-1)
        im = axes[i].imshow(f, cmap=CONVOLVE_CMAP, vmin=global_wmin, vmax=global_wmax)
        axes[i].set_title(f"Filter {i+1}", fontsize=9)
        axes[i].axis("off")
        plt.colorbar(im, ax=axes[i], fraction=0.046, pad=0.04, label="Gewichte")
    for j in range(n, len(axes)):
        axes[j].axis("off")
    fig.suptitle(f"Filter – {L.name}", fontsize=14)
    plt.subplots_adjust(wspace=0.5, hspace=0.5)
    save_fig(fig, f"filter_{L.name}.png")

# ========= 2) Aktivierungen =========
for idx, L in enumerate(conv_layers):
    act_model = build_forward_upto(seq, L.name, IMG_SIZE)
    acts = act_model.predict(img_arr, verbose=0)
    Fmaps = acts.shape[-1]

    mean_act = np.mean(acts[0], axis=-1)
    fig, ax = plt.subplots(figsize=(5,4))
    im = ax.imshow(mean_act, cmap=CONVOLVE_CMAP, vmin=0, vmax=np.percentile(mean_act, 99))
    ax.set_title(f"Mittelwert-Aktivierung – {L.name}")
    ax.axis("off")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="Aktivierung")
    save_fig(fig, f"mean_activation_{L.name}.png")

    if idx == 0:
        rows, cols = grid_shape(Fmaps, prefer_cols=8)
        fig, axes = plt.subplots(rows, cols, figsize=(3*cols, 3*rows))
        axes = axes.flatten()
        for i in range(Fmaps):
            a = acts[0,:,:,i]
            im = axes[i].imshow(a, cmap=CONVOLVE_CMAP, vmin=0, vmax=np.percentile(a, 99))
            axes[i].set_title(f"Map {i+1}", fontsize=8)
            axes[i].axis("off")
            plt.colorbar(im, ax=axes[i], fraction=0.046, pad=0.04)
        for j in range(Fmaps, len(axes)):
            axes[j].axis("off")
        fig.suptitle(f"Aktivierungen – {L.name} (alle Maps)", fontsize=14)
        plt.subplots_adjust(wspace=0.4, hspace=0.4)
        save_fig(fig, f"activations_{L.name}.png")
    else:
        n_show = min(Fmaps, MAX_MAPS_TO_SHOW)
        fig, axes = plt.subplots(2, 4, figsize=(12,6))
        axes = axes.flatten()
        for i in range(n_show):
            a = acts[0,:,:,i]
            im = axes[i].imshow(a, cmap=CONVOLVE_CMAP, vmin=0, vmax=np.percentile(a, 99))
            axes[i].set_title(f"Map {i+1}", fontsize=8)
            axes[i].axis("off")
            plt.colorbar(im, ax=axes[i], fraction=0.046, pad=0.04)
        for j in range(n_show, len(axes)):
            axes[j].axis("off")
        fig.suptitle(f"Aktivierungen – {L.name}", fontsize=14)
        plt.subplots_adjust(wspace=0.4, hspace=0.4)
        save_fig(fig, f"activations_{L.name}.png")

# ========= 3) Grad-CAM =========
last_conv = conv_layers[-1].name
print(f"Letzte Conv-Schicht: {last_conv}")

inp_gc = tf.convert_to_tensor(img_arr, dtype=tf.float32)
grad_model = build_forward_upto(seq, last_conv, IMG_SIZE)

with tf.GradientTape() as tape:
    tape.watch(inp_gc)
    conv_out = grad_model(inp_gc)
    x = conv_out
    passed = False
    for lyr in seq.layers:
        if lyr.name == last_conv:
            passed = True
            continue
        if passed:
            x = lyr(x)
    preds = x
    loss = tf.reduce_sum(preds)

grads  = tape.gradient(loss, conv_out)
pooled = tf.reduce_mean(grads, axis=(0,1,2))
heat   = tf.reduce_mean(conv_out * pooled, axis=-1)[0].numpy()
heat   = (heat - heat.min()) / (heat.max() - heat.min() + 1e-8)

extent = [0, IMG_SIZE[1], IMG_SIZE[0], 0]
fig, ax = plt.subplots()
im = ax.imshow(heat, cmap=CONVOLVE_CMAP, extent=extent, aspect="auto", vmin=0, vmax=np.percentile(heat, 99))
ax.set_title(f"Grad-CAM Rohdaten – {last_conv}")
cbar = fig.colorbar(im, ax=ax); cbar.set_label("Wichtigkeit")
ax.axis("off")
save_fig(fig, "gradcam_rohdaten.png")

heat_nn  = tf.image.resize(heat[...,np.newaxis], IMG_SIZE, method="nearest").numpy().squeeze()
heat_u8  = np.uint8(255*heat_nn)
heatmap  = cv2.applyColorMap(heat_u8, cv2.COLORMAP_JET)
if WHITE_MASK_THRESH is not None:
    mask_bg = (img_arr[0] > WHITE_MASK_THRESH).all(axis=-1)
    heatmap[mask_bg] = (0,0,0)

base_rgb = np.uint8(img_arr[0]*255)
base_bgr = cv2.cvtColor(base_rgb, cv2.COLOR_RGB2BGR)

# Overlay 1: mit Chart
overlay  = cv2.addWeighted(base_bgr, 0.6, heatmap, 0.4, 0)

# Overlay 2: neutraler Hintergrund
white_bg = np.ones_like(base_bgr) * 255
overlay_white = cv2.addWeighted(white_bg, 0.6, heatmap, 0.4, 0)

fig, ax = plt.subplots(1,2, figsize=(11,5))
ax[0].imshow(cv2.cvtColor(overlay, cv2.COLOR_BGR2RGB))
ax[0].set_title("Grad-CAM Overlay mit Chart")
ax[1].imshow(cv2.cvtColor(overlay_white, cv2.COLOR_BGR2RGB))
ax[1].set_title("Grad-CAM Overlay neutral")
for a in ax: a.axis("off")

fig.subplots_adjust(right=0.85)
cbar_ax = fig.add_axes([0.9, 0.15, 0.02, 0.7])
norm = plt.Normalize(vmin=0, vmax=1)
plt.colorbar(plt.cm.ScalarMappable(norm=norm, cmap="jet"), cax=cbar_ax, label="Wichtigkeit")
save_fig(fig, "gradcam_overlay_comparison.png")

# ========= 4) Saliency =========
inp_tensor = tf.convert_to_tensor(img_arr, dtype=tf.float32)
with tf.GradientTape() as tape:
    tape.watch(inp_tensor)
    out = model(inp_tensor)
    loss = tf.reduce_sum(out)
grads_in = tape.gradient(loss, inp_tensor)
sal = tf.reduce_max(tf.abs(grads_in[0]), axis=-1).numpy()
if sal.max() > 0: sal = sal / (sal.max() + 1e-8)
sal = np.power(sal, 0.5)

fig, ax = plt.subplots(1,2, figsize=(11,5))
ax[0].imshow(img_arr[0]); ax[0].set_title("Original")
im = ax[1].imshow(sal, cmap=CONVOLVE_CMAP, vmin=0, vmax=np.percentile(sal, 99))
ax[1].set_title("Saliency Map")
for a in ax: a.axis("off")
fig.colorbar(im, ax=ax[1], fraction=0.046, pad=0.04, label="Sensitivität")
save_fig(fig, "saliency.png")

print("✅ FERTIG – alle Ergebnisse in:", OUT_DIR)
