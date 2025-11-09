#!/usr/bin/env python3
"""
LLM Secret Detection Service - Main Entry Point
===============================================

Production-ready FastAPI application for AI-powered secret detection.
"""

import os
import uvicorn
from src.service import app

if __name__ == "__main__":
    # Set development defaults if not set
    if not os.getenv('ENVIRONMENT'):
        os.environ['ENVIRONMENT'] = 'development'

    if not os.getenv('API_KEY'):
        os.environ['API_KEY'] = 'dev-key-12345,prod-key-67890'

    if not os.getenv('JWT_SECRET'):
        os.environ['JWT_SECRET'] = 'your-256-bit-secret-here'

    if not os.getenv('RATE_LIMIT_REQUESTS_PER_MINUTE'):
        os.environ['RATE_LIMIT_REQUESTS_PER_MINUTE'] = '60'

    if not os.getenv('LOG_LEVEL'):
        os.environ['LOG_LEVEL'] = 'INFO'

    if not os.getenv('LOG_FORMAT'):
        os.environ['LOG_FORMAT'] = 'console'  # Use 'json' for production

    # Get port from Railway (or default to 8000 for local development)
    port = int(os.getenv('PORT', '8000'))

    print(f"🚀 Starting LLM Service on port {port}")
    print(f"🌍 Environment: {os.getenv('ENVIRONMENT', 'development')}")

    # Run the server
    uvicorn.run(
        "src.service:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv('ENVIRONMENT') == 'development',
        log_level=os.getenv('LOG_LEVEL', 'info').lower(),
        access_log=True
    )
