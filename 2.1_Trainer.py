import os
import numpy as np
import tensorflow as tf
from PIL import Image
from tensorflow.keras import layers, models


# Konfiguration
if input("Use standard configuration: ") == "yes":
    IMG_SIZE = (224, 224)  # Bilddimensionen in Pixel
    BATCH_SIZE = 16  # Bilder pro Trainingsdurchlauf (Standardwert)
    EPOCHS = 30  # Anzahl Verwendungen pro Bild pro Durchlauf (Standardwert)
    VAL_SPLIT = 0.2  # 10% der Trainingsbilder werden für Validierung verwendet (typischer Bereich)
    RANDOM_SEED = 7  # Reproduzierbares Mischen -> gleiches Ergebnis mit gleichen Daten (willkürliche Zahl)
else:  # Möglichkeit für Eigenkonfiguration
    IMG_SIZE = (int(input("Image height: ")), int(input("Image width: ")))
    BATCH_SIZE = int(input("Batch size: "))
    EPOCHS = int(input("Epochs: "))
    VAL_SPLIT = float(input("Value Split: "))
    RANDOM_SEED = 7

folder_name = input("Folder name: ")
model_name = str(input("Model name (needs appendix of '.keras': "))

# Suche alle Files im Ordner mit '_charts' as Endung
DATA_DIRS = [folder_name]


def load_data():
    X, y = [], []  # Liste X mit Bilderwerten, Liste y mit eigentlichen Labels
    total_files = 0
    print("Scanning folders:", DATA_DIRS)
    for folder in DATA_DIRS:
        for file in os.listdir(folder):
            if file.endswith('.png') and 'label' in file:  # falls Datei mit .png endet
                total_files += 1
                label = int(file.split('label')[1][0])  # Extraktion des Labels
                #  xxx_labelX.png -> labelX.png bleibt, das erste Zeichen davon wird behalten
                img_path = os.path.join(folder, file)
                img = Image.open(img_path).convert('RGB').resize(IMG_SIZE) # Laden und Skalierung
                X.append(np.array(img) / 255.0)  # Normalisierung der Pixelwerte (Werte 0-1) und Liste X hinzugefügt
                y.append(label)  # Speichern des zugehörigen Labels und in Liste y hinzugefügt
    print(f"✅ Loaded {len(X)} / {total_files} total images.")
    return np.array(X), np.array(y)

# --- Load + Split
X, y = load_data()

# Mischen der Daten für zufällige Verteilung
np.random.seed(RANDOM_SEED)
indices = np.arange(len(X))  # Liste mit len(X) Indexe (0, 1, 2, 3)
np.random.shuffle(indices)  # Liste wird zufällig durchgemischt (1, 3, 2, 0)
X, y = X[indices], y[indices]  # die Indexe der Listen X & y werden nach derselben Reihenfolge vertauscht

split_index = int(len(X) * (1 - VAL_SPLIT))  # der Index, der bei den Listen zwischen Training und Val_Daten unterscheidet
X_train, X_val = X[:split_index], X[split_index:]  # die Unterteilung bei X
y_train, y_val = y[:split_index], y[split_index:]  # die Unterteilung bei y

print(f"Training samples: {len(X_train)}")
print(f"Validation samples: {len(X_val)}")

# --- Build model
model = models.Sequential([
    layers.Input(shape=(*IMG_SIZE, 3)),  # Pixelfeld auf 3 Ebenen, jeweils für jeden RGB-Kanal
    layers.Conv2D(32, (3, 3), activation='relu'),  # 32 Filter, 3x3 Kernels
    layers.MaxPooling2D(2, 2),  # Reduzierung nach Filter, Dimensionen halbiert
    layers.Conv2D(64, (3, 3), activation='relu'),  # 64 Filter, 3x3 Kernels
    layers.MaxPooling2D(2, 2),
    layers.Conv2D(128, (3, 3), activation='relu'),
    layers.MaxPooling2D(2, 2),
    #layers.Conv2D(256, (3,3), activation='relu'),
    #layers.MaxPooling2D(2, 2),
    layers.Flatten(),
    layers.Dense(128, activation='relu'),  # Dense Layers Aufruf
    layers.Dense(1, activation='sigmoid')  # Flattening (Matrix -> 1D-Vektor)
])

model.compile(optimizer='adam',  # Optimisator
              loss='binary_crossentropy',  # Loss Berechnung
              metrics=['accuracy'])  # Accuracy als Ausgabe

early_stop = tf.keras.callbacks.EarlyStopping(
    monitor='val_loss',  # wenn Val_Loss
    patience=5,  # 5-mal hintereinander nicht kleiner wird
    restore_best_weights=True  # die Filter mit dem kleinsten Val_Loss zurückholen und speichern
)

# class_weights = {0:1.0,1:3.0} # falls Klassengewichte eingefügt werden sollen

# Training
model.fit(X_train, y_train,  # X & y als Trainingsdaten
          epochs=EPOCHS,
          batch_size=BATCH_SIZE,
          validation_data=(X_val, y_val),  # Validierungsdaten
          callbacks=[early_stop]) # Early Stop Funktion
         # class_weight=class_weights) # falls Klassengewichte verwendet werden

print("--- DONE ---")
model.save(f"{model_name}")  # Speichern
print(f"✅ Model saved as {model_name}")
