#!/bin/bash

# Start both frontend and backend servers
echo "Starting Convolve Development Servers..."
echo "Frontend: http://localhost:5173"
echo "Backend: http://127.0.0.1:8000"
echo ""

# Start backend in background
echo "Starting backend server..."
cd backend && MPLCONFIGDIR=/tmp/matplotlib MPLBACKEND=Agg python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start frontend
echo "Starting frontend server..."
npm run dev &
FRONTEND_PID=$!

# Wait for Ctrl+C
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT

# Keep script running
wait
