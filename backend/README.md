# Labeling Optimizer Backend

FastAPI backend for the Labeling Optimizer product.

## Setup

1. Create a virtual environment:
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

## Running the Backend

From the backend directory:
```bash
uvicorn app.main:app --reload
```

The API will be available at `http://127.0.0.1:8000`

## API Documentation

Once running, visit `http://127.0.0.1:8000/docs` for interactive API documentation.

## Endpoints

- `POST /api/labeling-optimizer/run` - Start a labeling optimization run
- `GET /api/labeling-optimizer/progress/{run_id}` - Get progress for a run
- `GET /api/labeling-optimizer/runs/{run_id}` - List available artifacts for a run
- `GET /api/labeling-optimizer/artifacts/{run_id}/{name}` - Get a specific artifact

## File Structure

- `runs/{run_id}/progress.json` - Progress information
- `runs/{run_id}/artifacts/` - Generated artifacts (metrics, heatmaps, etc.)
