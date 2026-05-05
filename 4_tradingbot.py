import os
import datetime
import time
import numpy as np
import yfinance as yf
from PIL import Image
import tensorflow as tf
import plotly.graph_objects as go
from dateutil.relativedelta import relativedelta
import requests

# Wichtig: Programm MUSS nach Marktschluss (22:30 Uhr) ausgeführt werden.
# Dieses Programm ist nur für eine bestimmte Konfiguration der Charts angepasst,
# sie wird nicht per Input bestimmt.

# Telegram "Adresse"
bot_token = "7973941666:AAGBnT-VBpxXlHlgbayrSHeAsuYy9edOPmo"
chat_id = "7848296555"

# bot_token = input("Bot Token: ")
# chat_id = input ("Chat ID: ")


def send_telegram_message(message):  # comment
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {"chat_id": chat_id, "text": message}
    requests.post(url, data=payload)


def livechart_analyst():
    symbols = input("Symbols (comma separated): ").upper().replace(" ", "").split(",")
    model_name = input("Model name (.keras): ")  # Welches Modell?
    runtime_days = int(input("Runtime (days): "))  # Wie lange soll das Programm laufen?
    image_dim = int(input("Image dimensions: "))  # gleich wie bei Training

    model = tf.keras.models.load_model(model_name)  # Keras Modell laden
    os.makedirs("live_charts", exist_ok=True)

    for day in range(runtime_days):  # jeden Tag wiederholen
        print(f"\n📅 RUNTIME TAG {day + 1}/{runtime_days}")  #

        for symbol in symbols:
            print(f"🔍 Analyzing {symbol}...")

            # --- DATUMSBEREICH: 1 Jahr zurück bis heute ---
            end = datetime.datetime.today()
            start = end - relativedelta(months=6)

            data = yf.Ticker(symbol).history(start=start.strftime('%Y-%m-%d'),
                                             end=end.strftime('%Y-%m-%d'),
                                             interval='1d')

            if data.empty:  # an Wochenenden
                send_telegram_message(f"{symbol}: Not enough data.")
                continue  # überspringen

            # Kerzenchart Generierer
            fig = go.Figure()
            fig.add_trace(go.Candlestick(
                x=data.index,
                open=data['Open'],
                high=data['High'],
                low=data['Low'],
                close=data['Close'],
                name='Candlestick'
            ))

            # Chart Konfiguration (Simplifikation der Daten)
            fig.update_layout(
                xaxis=dict(visible=False), yaxis=dict(visible=False),
                showlegend=False, margin=dict(l=0, r=0, t=0, b=0),
                plot_bgcolor='white', paper_bgcolor='white',
                xaxis_rangeslider_visible=False,
                width=image_dim, height=image_dim
            )


            last_date = data.index[-1].strftime("%Y-%m-%d")
            filename = f"live_charts/{symbol}_{last_date}.png"
            fig.write_image(filename)

            # Pixel in normalisierte Werte übersetzen
            # 🔹 Live-Chart dauerhaft speichern
            last_date = data.index[-1].strftime("%Y-%m-%d")
            live_filename = f"live_charts/{symbol}_{last_date}.png"
            fig.write_image(live_filename)

            # Pixel in normalisierte Werte übersetzen
            img = Image.open(live_filename).convert("RGB").resize((image_dim, image_dim))
            img_array = np.array(img) / 255.0
            img_array = np.expand_dims(img_array, axis=0)

            #
            prediction = model.predict(img_array)
            confidence = float(prediction[0][0])
            label = 1 if confidence >= 0.5 else 0

            # after loading data and before creating message:
            last_date = data.index[-1].strftime("%Y-%m-%d")

            msg = f"📊 {symbol} ({last_date}) – Label: {label} (Confidence: {confidence:.4f})"
            send_telegram_message(msg)
            print(msg)



        print("⏳ Waiting for next run...")
        time.sleep(86400)  # 24h Pause


print("‼️To get the prediction for the next day the program needs to be run after the market close.")
livechart_analyst()
