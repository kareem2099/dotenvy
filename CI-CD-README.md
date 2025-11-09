# 🚀 CI/CD & DevOps Setup - LLM Service

## 📋 Overview

This document outlines the complete CI/CD pipeline and DevOps infrastructure for the LLM Secret Detection Service. The setup includes automated testing, building, deployment, and monitoring.

## 🏗️ Architecture

```
GitHub Repository
        ↓
GitHub Actions CI/CD Pipeline
        ↓
Automated Testing (Unit, Integration, API)
        ↓
Security Scanning & Code Quality
        ↓
Docker Build & Registry Push
        ↓
Infrastructure as Code (Terraform)
        ↓
Kubernetes Deployment
        ↓
Monitoring & Alerting
```

## 📁 Project Structure

```
├── .github/workflows/ci-cd.yml          # GitHub Actions pipeline
├── python-llm/                          # Application code
│   ├── tests/                          # Unit & integration tests
│   ├── Dockerfile                      # Multi-stage build
│   └── requirements.txt                # Python dependencies
├── k8s/                                # Kubernetes manifests
│   ├── deployment.yaml                 # Application deployment
│   ├── service.yaml                    # Service definitions
│   ├── ingress.yaml                    # Ingress configuration
│   └── secrets.yaml                    # Secrets management
├── infrastructure/                     # Infrastructure as Code
│   ├── main.tf                        # Terraform configuration
│   └── variables.tf                   # Terraform variables
├── deploy/                             # Deployment scripts
│   └── deploy.sh                      # Automated deployment
└── CI-CD-README.md                    # This documentation
```

## 🔄 CI/CD Pipeline

### Pipeline Stages

#### 1. **Security Scanning** 🔒
- **Trivy**: Vulnerability scanning for dependencies
- **SARIF Reports**: Security findings uploaded to GitHub Security tab
- **Automated**: Runs on every push and PR

#### 2. **Code Quality** 🧹
- **Flake8**: Python linting and style checking
- **MyPy**: Static type checking
- **Black**: Code formatting verification
- **isort**: Import sorting validation

#### 3. **Testing** 🧪
- **Unit Tests**: Core functionality testing
- **Integration Tests**: Database and Redis integration
- **API Tests**: Endpoint testing with authentication
- **Coverage**: Code coverage reporting (>80% target)

#### 4. **Build & Push** 🐳
- **Multi-stage Docker Build**: Optimized for production
- **Multi-platform**: Linux AMD64 + ARM64 support
- **GitHub Container Registry**: Automated image publishing
- **Semantic Versioning**: Automatic tagging

#### 5. **Deployment** 🚀
- **Staging**: Automatic deployment on `develop` branch
- **Production**: Manual deployment on `main` branch
- **Blue-Green**: Zero-downtime deployment strategy
- **Rollback**: Automated rollback capabilities

#### 6. **Post-Deployment** ✅
- **Health Checks**: Automated endpoint verification
- **Integration Tests**: End-to-end API testing
- **Performance Tests**: Load testing (future)
- **Security Tests**: Runtime security scanning

## 🛠️ Local Development Setup

### Prerequisites

```bash
# Required tools
brew install docker kubectl helm terraform python3

# Python dependencies
cd python-llm
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pytest pytest-cov httpx

# Run tests locally
pytest tests/ -v --cov=src
```

### Docker Development

```bash
# Build local image
docker build -t llm-service:dev ./python-llm

# Run with docker-compose
docker-compose -f python-llm/docker-compose.yml up

# Test the service
curl http://localhost:8000/health
curl -H "X-API-KEY: dev-key-12345" \
     -X POST http://localhost:8000/analyze \
     -H "Content-Type: application/json" \
     -d '{"secret_value":"sk-test","context":"api key","variable_name":"key"}'
```

## 🚀 Deployment Guide

### Automated Deployment

```bash
# Using deployment script
chmod +x deploy/deploy.sh
./deploy/deploy.sh deploy

# Check deployment status
./deploy/deploy.sh status

# View logs
./deploy/deploy.sh logs

# Rollback if needed
./deploy/deploy.sh rollback
```

### Manual Deployment

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/

# Check deployment
kubectl get pods -l app=llm-service
kubectl logs -f deployment/llm-service

# Test endpoints
kubectl port-forward svc/llm-service 8080:80
curl http://localhost:8080/health
```

### Infrastructure as Code

```bash
# Initialize Terraform
cd infrastructure
terraform init

# Plan deployment
terraform plan -var-file=production.tfvars

# Apply infrastructure
terraform apply -var-file=production.tfvars

# Destroy infrastructure
terraform destroy -var-file=production.tfvars
```

## 📊 Monitoring & Alerting

### Prometheus Metrics

The service exposes metrics at `/metrics` endpoint:

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

### Alerting Rules

```yaml
# Example PrometheusRule
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: llm-service-alerts
spec:
  groups:
  - name: llm-service
    rules:
    - alert: LLMServiceDown
      expr: up{job="llm-service"} == 0
      for: 5m
      labels:
        severity: critical
    - alert: HighErrorRate
      expr: rate(llm_http_requests_total{status_code=~"5.."}[5m]) / rate(llm_http_requests_total[5m]) > 0.05
      for: 5m
      labels:
        severity: warning
```

## 🔒 Security

### CI/CD Security

- **Secret Management**: GitHub Secrets for sensitive data
- **Container Scanning**: Trivy vulnerability scanning
- **Dependency Checks**: Automated dependency vulnerability detection
- **CodeQL**: Advanced security analysis

### Runtime Security

- **Non-root Containers**: Services run as non-root user
- **Read-only Filesystem**: Immutable container filesystem
- **Security Headers**: Comprehensive HTTP security headers
- **Rate Limiting**: DDoS protection and abuse prevention

## 📈 Performance Optimization

### Build Optimization

```dockerfile
# Multi-stage build for smaller images
FROM python:3.11-slim as builder
# Build dependencies
FROM python:3.11-slim as runtime
# Only runtime dependencies
```

### Caching Strategy

- **Redis**: Application-level caching
- **Docker Layer Caching**: Build optimization
- **GitHub Actions Caching**: Dependency and build caching

### Resource Management

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "500m"
```

## 🔄 Rollback Strategy

### Automated Rollback

```bash
# Immediate rollback to previous version
kubectl rollout undo deployment/llm-service

# Rollback to specific revision
kubectl rollout undo deployment/llm-service --to-revision=2
```

### Blue-Green Deployment

```bash
# Deploy new version alongside old
kubectl apply -f k8s/deployment-green.yaml

# Switch traffic to new version
kubectl patch service llm-service -p '{"spec":{"selector":{"app":"llm-service-green"}}}'

# Verify and remove old deployment
kubectl delete deployment llm-service-blue
```

## 📚 API Documentation

### OpenAPI/Swagger

Access API documentation at:
- **Development**: `http://localhost:8000/docs`
- **Production**: `https://api.llm-service.example.com/docs`

### API Endpoints

```bash
# Core functionality
POST /analyze          # Analyze secret
POST /train           # Train model
GET  /stats           # Service statistics

# Health & monitoring
GET  /health          # Basic health check
GET  /health/detailed # Detailed health
GET  /readiness       # Readiness probe
GET  /liveness        # Liveness probe
GET  /metrics         # Prometheus metrics

# Management
GET  /versions        # Model versions
POST /versions/create # Create version
POST /ab/enable       # Enable A/B testing
```

## 🚨 Troubleshooting

### Common Issues

#### Build Failures
```bash
# Check build logs
docker build --no-cache ./python-llm

# Test locally first
cd python-llm && python main.py
```

#### Deployment Issues
```bash
# Check pod status
kubectl describe pod -l app=llm-service

# Check logs
kubectl logs -f deployment/llm-service

# Debug with temporary pod
kubectl run debug --image=busybox --rm -it --restart=Never
```

#### Performance Issues
```bash
# Check resource usage
kubectl top pods -l app=llm-service

# Check metrics
curl http://localhost:9090/metrics | grep llm_
```

## 📞 Support

### Monitoring Dashboards

- **Grafana**: `https://grafana.example.com`
- **Prometheus**: `https://prometheus.example.com`
- **Kibana**: `https://kibana.example.com` (if using EFK stack)

### Alert Channels

- **Slack**: #llm-service-alerts
- **PagerDuty**: LLM Service critical alerts
- **Email**: DevOps team notifications

## 🎯 Next Steps

1. **Phase 6**: Production Optimization
   - Load balancing configuration
   - Database optimization
   - Memory optimization
   - Final security hardening

2. **Advanced Features**
   - Auto-scaling policies
   - Multi-region deployment
   - Disaster recovery
   - Advanced monitoring

---

**🎉 Your LLM service now has enterprise-grade CI/CD and DevOps capabilities!**

The complete pipeline ensures automated testing, security scanning, and reliable deployments with comprehensive monitoring and rollback capabilities.
