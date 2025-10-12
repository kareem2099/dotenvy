"""
Main Entry Point for Python LLM Service
========================================

Simple launcher script for the custom LLM service.
Run this to start the FastAPI server.
"""

import uvicorn
from src.service import app

if __name__ == "__main__":
    print("=" * 50)
    print("Starting Custom LLM Service for Secret Detection")
    print("=" * 50)
    print("VS Code Extension Integration Ready")
    print("API will be available at: http://127.0.0.1:8000")
    print("=" * 50)

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
        reload=False
    )
