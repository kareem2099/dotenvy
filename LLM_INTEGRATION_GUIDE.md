# LLM Integration Guide - DotEnvy

## Overview

This document provides comprehensive documentation for the LLM (Large Language Model) integration in DotEnvy, including the connection to the Railway server and the complete architecture.

## Architecture Diagram

```
┌─────────────────┐    HTTP Requests     ┌─────────────────────┐
│   VS Code       │  ──────────────────→ │   Railway Server    │
│   Extension     │                      │   (Python LLM)      │
│                 │  ←─────────────────  │                     │
│  ┌─────────────┐│    Analysis Results  │  ┌─────────────────┐ │
│  │ Secret      ││                      │  │ ML Models       │ │
│  │ Detector    ││                      │  │ (FastAPI)       │ │
│  │             ││                      │  │                 │ │
│  │ ┌─────────┐ ││                      │  │ ┌─────────────┐ │ │
│  │ │ LLM     │ ││                      │  │ │ PostgreSQL  │ │ │
│  │ │ Analyzer│ ││                      │  │ │ (Storage)   │ │ │
│  │ │         │ ││                      │  │ └─────────────┘ │ │
│  │ └─────────┘ ││                      │  │                 │ │
│  └─────────────┘│                      │  │ ┌─────────────┐ │ │
│                 │                      │  │ │ Redis Cache │ │ │
│  ┌─────────────┐│                      │  │ └─────────────┘ │ │
│  │ Cache       ││                      │  │                 │ │
│  │ Manager     ││                      │  │ ┌─────────────┐ │ │
│  │             ││                      │  │ │ Monitoring  │ │ │
│  │             ││                      │  │ │ (Prometheus)│ │ │
│  └─────────────┘│                      │  │ └─────────────┘ │ │
└─────────────────┘                      │  └─────────────────┘ │
                                         └─────────────────────┘
```

## Components

### 1. LLMAnalyzer Class (`src/utils/llmAnalyzer.ts`)

**Purpose**: TypeScript interface to communicate with the Python LLM service.

**Key Features**:
- Singleton pattern implementation
- HTTP request handling
- Fallback analysis when LLM service is unavailable
- Feature extraction for ML analysis

**Configuration**:
```typescript
// Default local development
this.serviceUrl = process.env.DOTENVY_LLM_SERVICE_URL || 'http://127.0.0.1:8000';

// Production Railway URL
// Format: https://[service-name]-production.up.railway.app
```

**API Endpoints**:
- `GET /health` - Service health check
- `POST /analyze` - Secret analysis endpoint
- `GET /stats` - Service statistics

### 2. SecretDetector Integration (`src/utils/secretDetector.ts`)

**Purpose**: Integrates LLM analysis into the secret detection workflow.

**Integration Points**:
```typescript
// Enhanced confidence scoring
const enhancedConfidence = await llmAnalyzer.analyzeSecret(secretValue, context, variableName);

// Fallback to traditional analysis
const baselineConfidence = EntropyAnalyzer.getConfidence(secretValue);
```

**Workflow**:
1. Traditional pattern matching and entropy analysis
2. Context extraction from surrounding code
3. LLM analysis request with enhanced features
4. Response processing and confidence adjustment
5. Fallback to traditional analysis if LLM unavailable

### 3. Railway Server Deployment

**Production URL**: `https://[service-name]-production.up.railway.app`

**Authentication**:
- **API Key**: [Securely stored in environment variables]
- **JWT Secret**: [Securely stored in environment variables]

**Infrastructure**:
- **Platform**: Railway
- **Runtime**: Python 3.11
- **Framework**: FastAPI
- **Database**: PostgreSQL
- **Cache**: Redis
- **Monitoring**: Prometheus + Grafana

### 4. Feature Extraction

The LLM analyzer extracts 15+ features for ML analysis:

```typescript
// Basic text features
features.push(secretValue.length);
features.push(this.calculateEntropy(secretValue));

// Character analysis
features.push(specialChars.test(secretValue) ? 1 : 0);
features.push(/\d/.test(secretValue) ? 1 : 0);
features.push(/[A-Z]/.test(secretValue) ? 1 : 0);
features.push(/[a-z]/.test(secretValue) ? 1 : 0);

// Pattern analysis
features.push(uniqueRatio);
features.push(prefixes.some(prefix => secretValue.startsWith(prefix)) ? 1 : 0);

// Base64/hex patterns
features.push(this.isBase64Like(secretValue) ? 1 : 0);
features.push(this.isHexLike(secretValue) ? 1 : 0);

// Context analysis
features.push(this.analyzeContextRisk(context));
features.push(this.isInQuotes(context) ? 1 : 0);
features.push(this.countKeywords(context));

// Variable name score
features.push(this.scoreVariableName(variableName));
```

## Deployment Architecture

### Infrastructure as Code

**Terraform Configuration** (`infrastructure/`):
- Kubernetes namespace: `llm-service`
- Deployment with 3 replicas
- Service with load balancing
- Ingress with SSL termination
- Secrets management

**Kubernetes Manifests** (`k8s/`):
- `deployment.yaml` - Application deployment
- `service.yaml` - Service definitions
- `ingress.yaml` - Ingress configuration
- `secrets.yaml` - Secrets management

### CI/CD Pipeline

**GitHub Actions** (`.github/workflows/ci-cd.yml`):
1. **Security Scanning**: Trivy vulnerability scanning
2. **Code Quality**: Flake8, MyPy, Black, isort
3. **Testing**: Unit, integration, and API tests
4. **Build & Push**: Multi-stage Docker build
5. **Deployment**: Staging and production deployment

**Build Process**:
```bash
# Multi-stage Docker build
docker build -t llm-service:dev ./python-llm

# Multi-platform support
docker build --platform linux/amd64,linux/arm64 -t llm-service:latest

# Registry push
docker push ghcr.io/kareem2099/dotenvy/llm-service:latest
```

## Performance & Reliability

### Caching Strategy
- **Redis**: Application-level caching for frequent requests
- **HTTP Cache**: Browser caching for static assets
- **Database Cache**: Query result caching

### Monitoring & Alerting
- **Prometheus**: Metrics collection
- **Grafana**: Visualization dashboards
- **AlertManager**: Alerting rules

**Key Metrics**:
```prometheus
# Request metrics
llm_http_requests_total{method="POST", endpoint="/analyze", status_code="200"} 150

# Performance metrics
llm_analysis_duration_seconds{secret_type="API Key", quantile="0.95"} 0.15

# Cache metrics
llm_cache_hits_total 1200
llm_cache_misses_total 300

# Business metrics
llm_secrets_detected_total{risk_level="high", secret_type="API Key"} 45
```

### Health Checks
- **Liveness**: `/liveness` - Service availability
- **Readiness**: `/readiness` - Service readiness for traffic
- **Detailed Health**: `/health/detailed` - Comprehensive health status

## Security Features

### API Security
- **Authentication**: Bearer token authentication
- **Rate Limiting**: DDoS protection and abuse prevention
- **Input Validation**: Comprehensive input sanitization

### Container Security
- **Non-root Containers**: Services run as non-root user
- **Read-only Filesystem**: Immutable container filesystem
- **Security Headers**: Comprehensive HTTP security headers

### Secrets Management
- **Environment Variables**: Secure secret storage
- **Kubernetes Secrets**: Encrypted secret management
- **Railway Secrets**: Platform-level secret management

## Fallback Mechanisms

### Service Unavailability
When the LLM service is unavailable, the system automatically falls back to traditional analysis:

```typescript
if (!this.isConnected) {
    // Fallback to traditional analysis
    return this.fallbackAnalysis(secretValue, context);
}
```

### Fallback Analysis Logic
```typescript
private fallbackAnalysis(secretValue: string, context: string): string {
    const entropy = this.calculateEntropy(secretValue);
    const hasKeywords = this.analyzeContextRisk(context) > 0;

    if (entropy > 4.5 && hasKeywords) {
        return 'high';
    } else if (entropy > 3.5) {
        return 'medium';
    } else {
        return 'low';
    }
}
```

## Testing

### Local Development
```bash
# Test LLM service locally
cd python-llm
python main.py

# Test with curl
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"secret_value":"sk-test","context":"api key","variable_name":"key"}'
```

### Production Testing
```bash
# Test production endpoint
API_URL="https://[service-name]-production.up.railway.app"
API_KEY="[your-api-key]"

curl -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"secret_value":"sk-1234567890abcdef","context":"const apiKey = \"sk-1234567890abcdef\";","variable_name":"apiKey"}'
```

## Troubleshooting

### Common Issues

1. **Service Connection Failed**
   - Check Railway service status
   - Verify API key and authentication
   - Check network connectivity

2. **High Response Times**
   - Check Redis cache hit rate
   - Monitor database performance
   - Review ML model inference time

3. **Authentication Errors**
   - Verify API key format
   - Check JWT token expiration
   - Review authentication headers

### Debug Commands

```bash
# Check service health
curl https://[service-name]-production.up.railway.app/health

# Check service statistics
curl -H "Authorization: Bearer [your-api-key]" \
     https://[service-name]-production.up.railway.app/stats

# Check deployment status
kubectl get pods -l app=llm-service
kubectl logs -f deployment/llm-service
```

## Environment Variables

### Required Environment Variables

**For Extension**:
```bash
# LLM Service URL
DOTENVY_LLM_SERVICE_URL=https://[service-name]-production.up.railway.app
```

**For Railway Service**:
```bash
# Database Configuration
DATABASE_URL=postgresql://[user]:[password]@[host]:[port]/[database]

# Redis Configuration
REDIS_URL=redis://[host]:[port]

# Authentication
API_KEYS=comma_separated_list_of_valid_keys
JWT_SECRET=your_jwt_secret_key

# Monitoring
PROMETHEUS_ENABLED=true
```

## Future Enhancements

### Planned Features
1. **Auto-scaling**: Dynamic scaling based on load
2. **Multi-region**: Geographic distribution for latency reduction
3. **Model Updates**: Automated ML model retraining and deployment
4. **Advanced Analytics**: Enhanced metrics and reporting

### Performance Optimizations
1. **Edge Caching**: CDN-based caching for global performance
2. **Database Optimization**: Query optimization and indexing
3. **Memory Management**: Advanced memory allocation strategies

---

## Conclusion

The LLM integration in DotEnvy provides enterprise-grade secret detection with ML-enhanced accuracy while maintaining high performance and reliability through the Railway-deployed LLM service. The architecture is designed to be scalable, secure, and maintainable, with comprehensive fallback mechanisms to ensure continuous operation.

## Security Notes

⚠️ **Important**: 
- Never commit API keys, JWT secrets, or other sensitive credentials to version control
- Use environment variables or secure secret management systems
- Regularly rotate API keys and secrets
- Monitor access logs for unauthorized usage
- Implement proper access controls and permissions