# LLM Service - Production Deployment

This directory contains the production deployment configuration for the Custom LLM Service used by the DotEnvy VS Code extension.

## 🚀 Quick Start

### Development Deployment
```bash
# Build and start the service
./deploy.sh development build

# Or simply (defaults to development)
./deploy.sh
```

### Production Deployment
```bash
# Set required environment variables
export API_KEY="your-production-api-key"
export SECRET_KEY="your-production-secret-key"
export JWT_SECRET="your-production-jwt-secret"
export DATABASE_URL="postgresql://user:pass@host:5432/db"
export REDIS_URL="redis://host:6379"

# Deploy to production
./deploy.sh production build
```

## 📁 Project Structure

```
python-llm/
├── Dockerfile              # Multi-stage container build
├── docker-compose.yml      # Service orchestration
├── nginx.conf             # Reverse proxy configuration
├── deploy.sh              # Deployment automation script
├── .env.development       # Development environment variables
├── .env.production        # Production environment variables
├── requirements.txt       # Python dependencies
├── main.py               # Service entry point
└── src/
    ├── service.py         # FastAPI application
    ├── model.py          # Custom LLM implementation
    ├── attention.py      # Attention mechanism
    └── models/           # Trained model storage
```

## 🐳 Containerization

### Multi-Stage Docker Build
- **Builder Stage**: Compiles dependencies and creates virtual environment
- **Runtime Stage**: Minimal production image with security hardening
- **Non-root User**: Runs as `llmuser` for security
- **Health Checks**: Built-in Docker health monitoring

### Key Features
- **Security**: Non-root user, minimal attack surface
- **Performance**: Optimized layers, multi-stage build
- **Monitoring**: Health checks, structured logging
- **Scalability**: Configurable worker processes

## 🔧 Configuration

### Environment Variables

#### Required (Production)
```bash
API_KEY=your-api-key
SECRET_KEY=your-secret-key
JWT_SECRET=your-jwt-secret
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379
```

#### Optional
```bash
SERVICE_NAME=llm-service
SERVICE_VERSION=1.0.0
ENVIRONMENT=production
HOST=0.0.0.0
PORT=8000
WORKERS=4
LOG_LEVEL=INFO
```

## 🚀 Deployment Commands

### Development
```bash
# Start development environment
./deploy.sh development up

# View logs
./deploy.sh development logs

# Restart services
./deploy.sh development restart

# Stop services
./deploy.sh development down
```

### Production
```bash
# Full production deployment
./deploy.sh production build

# Scale services
docker-compose --profile production up -d --scale llm-service=3

# View production logs
./deploy.sh production logs
```

### Health Monitoring
```bash
# Check service health
./deploy.sh production health

# Manual health check
curl http://localhost:8000/health

# View service stats
curl http://localhost:8000/stats
```

## 🔒 Security Features

### Container Security
- **Non-root execution**: Runs as `llmuser`
- **Minimal base image**: `python:3.11-slim`
- **No shell access**: Prevents container escapes
- **Read-only filesystem**: Where possible

### Network Security
- **Nginx reverse proxy**: Request filtering and rate limiting
- **Security headers**: XSS protection, content type sniffing prevention
- **CORS restrictions**: Configurable origin restrictions
- **Rate limiting**: 10 requests/second with burst handling

### Application Security
- **API key authentication**: Required for production access
- **Input validation**: Sanitized request processing
- **Error handling**: No sensitive information leakage
- **Logging**: Structured logs without sensitive data

## 📊 Monitoring & Observability

### Health Checks
- **Container Level**: Docker health checks every 30 seconds
- **Application Level**: `/health` endpoint monitoring
- **Dependency Checks**: Database and Redis connectivity

### Metrics
- **Performance**: Response times, throughput
- **Cache Statistics**: Hit rates, memory usage
- **Model Metrics**: Training progress, accuracy
- **Error Rates**: Application and infrastructure errors

### Logging
- **Structured Logs**: JSON format for production
- **Log Levels**: Configurable (DEBUG, INFO, WARNING, ERROR)
- **Correlation IDs**: Request tracing
- **Security Events**: Authentication and authorization logs

## 🔄 Scaling & Performance

### Horizontal Scaling
```bash
# Scale LLM service instances
docker-compose --profile production up -d --scale llm-service=5

# Load balancing with Nginx upstream
upstream llm_backend {
    server llm-service:8000;
    server llm-service:8001;
    server llm-service:8002;
}
```

### Caching Strategy
- **Application Cache**: In-memory LRU cache (1000 items)
- **Redis Cache**: Distributed caching for multi-instance deployments
- **Model Caching**: Persistent model storage
- **Response Caching**: Frequently requested analyses

### Database Integration
- **PostgreSQL**: Persistent model and training data storage
- **Connection Pooling**: Efficient database connections
- **Migrations**: Automated schema management
- **Backup**: Automated daily backups with 30-day retention

## 🚨 Troubleshooting

### Common Issues

#### Service Won't Start
```bash
# Check logs
./deploy.sh development logs

# Check container status
docker-compose ps

# Check resource usage
docker stats
```

#### Health Check Failures
```bash
# Manual health check
curl -v http://localhost:8000/health

# Check service dependencies
docker-compose exec llm-service curl -f http://localhost:8000/health
```

#### Performance Issues
```bash
# Check cache statistics
curl http://localhost:8000/stats

# Monitor resource usage
docker stats $(docker-compose ps -q)

# Check Redis connectivity
docker-compose exec redis redis-cli ping
```

### Logs and Debugging
```bash
# Application logs
./deploy.sh production logs llm-service

# Nginx access logs
./deploy.sh production logs nginx

# System resource logs
docker system df -v
```

## 🔧 Maintenance

### Updates and Rollbacks
```bash
# Rolling update
./deploy.sh production restart

# Blue-green deployment
# 1. Deploy new version with different tag
# 2. Switch Nginx upstream
# 3. Verify health
# 4. Remove old containers
```

### Backup and Recovery
```bash
# Database backup
docker-compose exec postgres pg_dump -U llmuser llm_service > backup.sql

# Model backup
docker cp $(docker-compose ps -q llm-service):/app/src/models ./models_backup

# Full service backup
docker-compose exec llm-service tar czf /tmp/backup.tar.gz /app/src/models
```

### Monitoring Dashboards
- **Grafana**: Real-time metrics visualization
- **Prometheus**: Time-series metrics collection
- **ELK Stack**: Log aggregation and analysis
- **Custom Dashboards**: Application-specific monitoring

## 📚 API Reference

### Endpoints
- `GET /health` - Service health check
- `GET /stats` - Service statistics and metrics
- `POST /analyze` - Analyze potential secrets
- `POST /train` - Train the model with feedback
- `POST /reset` - Reset model to initial state

### Authentication
```bash
# Include API key in headers
curl -H "X-API-KEY: your-api-key" http://localhost:8000/analyze
```

## 🤝 Contributing

### Development Setup
```bash
# Clone and setup
git clone <repository>
cd python-llm

# Install dependencies locally
pip install -r requirements.txt

# Run tests
python -m pytest

# Start development server
python main.py
```

### Deployment Testing
```bash
# Test development deployment
./deploy.sh development build

# Test production-like deployment
./deploy.sh production build

# Load testing
ab -n 1000 -c 10 http://localhost:8000/health
```

---

## 📞 Support

For deployment issues or questions:
1. Check the troubleshooting section above
2. Review logs with `./deploy.sh logs`
3. Verify environment configuration
4. Check network connectivity and firewall rules

## 🔄 Version History

- **v1.0.0**: Initial production deployment
  - Multi-stage Docker build
  - Nginx reverse proxy
  - Environment-based configuration
  - Health checks and monitoring
  - Security hardening
  - Caching and performance optimization
