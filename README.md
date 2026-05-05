# Convolve Insights

A full-stack platform for visual AI trading research, featuring CNN training, analysis, and interactive visualizations.

## 🚀 Quick Start

### Single Command Setup
```bash
npm run dev
```

This will show you the commands to run both frontend and backend servers.

### Manual Setup (Two Terminals)

**Terminal 1 - Frontend:**
```bash
npm run dev
```
Frontend will be available at: `http://localhost:5173`

**Terminal 2 - Backend:**
```bash
npm run dev:backend
```
Backend API will be available at: `http://127.0.0.1:8000`

## 📁 Project Structure

```
convolve-insights/
├── src/                    # Frontend React/Vite app
├── backend/               # FastAPI backend
│   ├── app/
│   └── runners/          # Training and analysis scripts
├── datasets/             # Uploaded dataset storage
├── runs/                 # Training run outputs
└── package.json          # Root scripts
```

## 🎯 Features

### Dataset Management
- **Drag & Drop Upload**: ZIP files containing labeled chart images
- **Automatic Processing**: Extracts and validates image datasets
- **Label Analysis**: Counts and categorizes training labels
- **Persistent Storage**: Reusable datasets across training runs

### CNN Training
- **Live Progress**: Real-time epoch-by-epoch metrics
- **Flexible Configuration**: Standard or custom training parameters
- **Early Stopping**: Automatic training optimization
- **Model Export**: Keras model downloads

### Visual Analysis
- **CNN Interpretability**: Filter, activation, and saliency maps
- **Grad-CAM**: Gradient-based feature attribution
- **Advanced Visualizations**: Professional research-grade outputs
- **ZIP Downloads**: Complete analysis result packages

## 🛠️ Development

### Environment Variables
Create `.env.local` in the root directory:
```
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### API Endpoints

**Dataset Management:**
- `POST /datasets/upload` - Upload and extract dataset ZIP
- `GET /datasets/{dataset_id}` - Get dataset information

**Training:**
- `POST /trainer/runs` - Start CNN training
- `GET /trainer/runs/{run_id}` - Get training progress
- `GET /trainer/runs/{run_id}/download/model` - Download trained model

**Analysis:**
- `POST /trainer/runs/{run_id}/analysis` - Start CNN analysis
- `GET /trainer/runs/{run_id}/analysis/{analysis_id}` - Get analysis status
- `GET /trainer/runs/{run_id}/analysis/{analysis_id}/download` - Download results

## 🎨 Design System

- **Colors**: Deep black backgrounds, purple/blue/pink accents
- **Typography**: Clean, high-contrast text hierarchy
- **No Green**: Candlesticks are the only green elements
- **Responsive**: Mobile-first design approach

## 🔧 Troubleshooting

### Backend Not Starting
If matplotlib cache issues occur:
```bash
cd backend
MPLCONFIGDIR=/tmp/matplotlib MPLBACKEND=Agg python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Upload Errors
- Ensure both frontend and backend are running
- Check browser Network tab for detailed error information
- Verify ZIP contains valid image files with proper naming

### Port Conflicts
- Frontend: `http://localhost:5173` (Vite dev server)
- Backend: `http://127.0.0.1:8000` (FastAPI server)

## 📊 Tech Stack

**Frontend:**
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- Framer Motion (animations)

**Backend:**
- FastAPI (Python web framework)
- TensorFlow/Keras (ML framework)
- PIL, OpenCV (image processing)
- Matplotlib (visualizations)

**Data Processing:**
- PNG/JPG/WEBP image support
- Label extraction from filenames
- Automatic dataset validation
- ZIP file handling

---

Built for quantitative researchers exploring visual AI in financial markets.