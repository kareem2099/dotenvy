#!/bin/bash
set -e

# LLM Service Deployment Script
# =============================

echo "🚀 Starting LLM Service Deployment"

# Configuration
ENVIRONMENT=${ENVIRONMENT:-production}
NAMESPACE=${NAMESPACE:-default}
IMAGE_TAG=${IMAGE_TAG:-latest}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Pre-deployment checks
pre_deployment_checks() {
    log_info "Running pre-deployment checks..."

    # Check if kubectl is available
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl."
        exit 1
    fi

    # Check if we're connected to a cluster
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Not connected to a Kubernetes cluster."
        exit 1
    fi

    # Check namespace exists
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_warning "Namespace $NAMESPACE does not exist. Creating..."
        kubectl create namespace "$NAMESPACE"
    fi

    log_success "Pre-deployment checks passed"
}

# Deploy infrastructure dependencies
deploy_infrastructure() {
    log_info "Deploying infrastructure dependencies..."

    # Deploy PostgreSQL (using a simple deployment for demo)
    log_info "Deploying PostgreSQL..."
    kubectl apply -f k8s/postgres.yaml -n "$NAMESPACE" || true

    # Deploy Redis
    log_info "Deploying Redis..."
    kubectl apply -f k8s/redis.yaml -n "$NAMESPACE" || true

    # Wait for databases to be ready
    log_info "Waiting for databases to be ready..."
    kubectl wait --for=condition=available --timeout=300s deployment/postgres -n "$NAMESPACE" || true
    kubectl wait --for=condition=available --timeout=300s deployment/redis -n "$NAMESPACE" || true

    log_success "Infrastructure deployed"
}

# Deploy application
deploy_application() {
    log_info "Deploying LLM Service application..."

    # Update image tag in deployment
    sed -i "s|image:.*|image: ghcr.io/kareem2099/dotenvy/llm-service:$IMAGE_TAG|g" k8s/deployment.yaml

    # Apply Kubernetes manifests
    kubectl apply -f k8s/secrets.yaml -n "$NAMESPACE"
    kubectl apply -f k8s/configmap.yaml -n "$NAMESPACE" || true
    kubectl apply -f k8s/service.yaml -n "$NAMESPACE"
    kubectl apply -f k8s/deployment.yaml -n "$NAMESPACE"

    log_success "Application deployed"
}

# Deploy ingress
deploy_ingress() {
    log_info "Deploying ingress..."

    # Check if ingress controller is available
    if kubectl get deployment ingress-nginx-controller -n ingress-nginx &> /dev/null; then
        kubectl apply -f k8s/ingress.yaml -n "$NAMESPACE"
        log_success "Ingress deployed"
    else
        log_warning "NGINX Ingress Controller not found. Skipping ingress deployment."
        log_info "To install NGINX Ingress Controller, run:"
        log_info "kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.1/deploy/static/provider/cloud/deploy.yaml"
    fi
}

# Run post-deployment tests
run_post_deployment_tests() {
    log_info "Running post-deployment tests..."

    # Wait for deployment to be ready
    kubectl wait --for=condition=available --timeout=300s deployment/llm-service -n "$NAMESPACE"

    # Get service URL
    SERVICE_IP=$(kubectl get svc llm-service -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    SERVICE_PORT=$(kubectl get svc llm-service -n "$NAMESPACE" -o jsonpath='{.spec.ports[0].port}')

    # Test health endpoint
    if curl -f -s "http://$SERVICE_IP:$SERVICE_PORT/health" > /dev/null; then
        log_success "Health check passed"
    else
        log_error "Health check failed"
        exit 1
    fi

    # Test readiness endpoint
    if curl -f -s "http://$SERVICE_IP:$SERVICE_PORT/readiness" > /dev/null; then
        log_success "Readiness check passed"
    else
        log_warning "Readiness check failed - service may still be starting"
    fi

    log_success "Post-deployment tests completed"
}

# Rollback function
rollback() {
    log_warning "Starting rollback..."

    # Scale down current deployment
    kubectl scale deployment llm-service --replicas=0 -n "$NAMESPACE"

    # Wait a moment
    sleep 10

    # Scale back up (this will use the previous image)
    kubectl scale deployment llm-service --replicas=3 -n "$NAMESPACE"

    log_info "Rollback completed. Service scaled back to previous version."
}

# Main deployment function
main() {
    log_info "Starting deployment to $ENVIRONMENT environment in namespace $NAMESPACE"

    case "$1" in
        "deploy")
            pre_deployment_checks
            deploy_infrastructure
            deploy_application
            deploy_ingress
            run_post_deployment_tests
            log_success "🎉 Deployment completed successfully!"
            ;;
        "rollback")
            rollback
            ;;
        "status")
            kubectl get all -n "$NAMESPACE" -l app=llm-service
            ;;
        "logs")
            kubectl logs -f deployment/llm-service -n "$NAMESPACE"
            ;;
        "test")
            run_post_deployment_tests
            ;;
        *)
            echo "Usage: $0 {deploy|rollback|status|logs|test}"
            echo ""
            echo "Commands:"
            echo "  deploy   - Full deployment with infrastructure"
            echo "  rollback - Rollback to previous version"
            echo "  status   - Show deployment status"
            echo "  logs     - Show application logs"
            echo "  test     - Run post-deployment tests"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
