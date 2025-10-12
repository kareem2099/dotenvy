#!/bin/bash

# DotEnvy Custom LLM Service Deployment Script
# ============================================

echo "🚀 Deploying Custom LLM Service for Secret Detection"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment and install dependencies
echo "Installing Python dependencies..."
source venv/bin/activate
pip install -r requirements.txt

# Check if service is already running
if pgrep -f "python main.py" > /dev/null; then
    echo "Service already running, stopping it first..."
    pkill -f "python main.py"
    sleep 2
fi

# Start the service
echo "Starting Uvicorn server..."
nohup python main.py > service.log 2>&1 &

# Wait for startup
echo "Waiting for service to start..."
sleep 3

# Verify deployment
if curl -s http://127.0.0.1:8000/health > /dev/null 2>&1; then
    echo "✅ Custom LLM Service successfully deployed!"
    echo "📡 API available at: http://127.0.0.1:8000"
    echo "🔍 Service PID:" $(pgrep -f "python main.py")
    echo ""
    echo "Service logs: service.log"
    echo "Stop service: pkill -f 'python main.py'"
else
    echo "❌ Service deployment failed!"
    echo "Check service.log for details"
    exit 1
fi
