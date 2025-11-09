#!/bin/bash

# LLM Service Deployment Script
# =============================
#
# This script handles deployment of the LLM service to different environments.
#
# Usage:
#   ./deploy.sh [environment] [action]
#
# Environments:
#   - development (default)
#   - staging
#   - production
#
# Actions:
#   - build (default): Build and start services
#   - up: Start services
#   - down: Stop services
#   - restart: Restart services
#   - logs: Show logs
#   - health: Check health status

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT=${1:-development}
ACTION=${2:-build}

# Validate environment
case $ENVIRONMENT in
    development|staging|production)
        echo -e "${BLUE}Environment: $ENVIRONMENT${NC}"
        ;;
    *)
        echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'${NC}"
        echo "Valid environments: development, staging, production"
        exit 1
        ;;
esac

# Validate action
case $ACTION in
    build|up|down|restart|logs|health)
        echo -e "${BLUE}Action: $ACTION${NC}"
        ;;
    *)
        echo -e "${RED}Error: Invalid action '$ACTION'${NC}"
        echo "Valid actions: build, up, down, restart, logs, health"
        exit 1
        ;;
esac

# Load environment variables
load_environment() {
    local env_file="$SCRIPT_DIR/.env.$ENVIRONMENT"
    if [ -f "$env_file" ]; then
        echo -e "${BLUE}Loading environment from: $env_file${NC}"
        export $(grep -v '^#' "$env_file" | xargs)
    else
        echo -e "${YELLOW}Warning: Environment file not found: $env_file${NC}"
    fi
}

# Check prerequisites
check_prerequisites() {
    echo -e "${BLUE}Checking prerequisites...${NC}"

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed${NC}"
        exit 1
    fi

    # Check if Docker Compose is installed
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo -e "${RED}Error: Docker Compose is not installed${NC}"
        exit 1
    fi

    echo -e "${GREEN}Prerequisites check passed${NC}"
}

# Build services
build_services() {
    echo -e "${BLUE}Building services...${NC}"

    # Build the LLM service
    docker-compose -f "$DOCKER_COMPOSE_FILE" build llm-service

    # For production, also build nginx
    if [ "$ENVIRONMENT" = "production" ]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" --profile production build nginx
    fi

    echo -e "${GREEN}Services built successfully${NC}"
}

# Start services
start_services() {
    echo -e "${BLUE}Starting services...${NC}"

    if [ "$ENVIRONMENT" = "production" ]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" --profile production up -d
    else
        docker-compose -f "$DOCKER_COMPOSE_FILE" up -d
    fi

    echo -e "${GREEN}Services started${NC}"
}

# Stop services
stop_services() {
    echo -e "${BLUE}Stopping services...${NC}"

    if [ "$ENVIRONMENT" = "production" ]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" --profile production down
    else
        docker-compose -f "$DOCKER_COMPOSE_FILE" down
    fi

    echo -e "${GREEN}Services stopped${NC}"
}

# Restart services
restart_services() {
    echo -e "${BLUE}Restarting services...${NC}"
    stop_services
    sleep 2
    start_services
    echo -e "${GREEN}Services restarted${NC}"
}

# Show logs
show_logs() {
    echo -e "${BLUE}Showing logs...${NC}"
    if [ "$ENVIRONMENT" = "production" ]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" --profile production logs -f
    else
        docker-compose -f "$DOCKER_COMPOSE_FILE" logs -f
    fi
}

# Health check
health_check() {
    echo -e "${BLUE}Performing health check...${NC}"

    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        echo -e "${BLUE}Health check attempt $attempt/$max_attempts...${NC}"

        if curl -f http://localhost:8000/health &> /dev/null; then
            echo -e "${GREEN}✅ Service is healthy!${NC}"
            return 0
        fi

        sleep 2
        ((attempt++))
    done

    echo -e "${RED}❌ Service failed health check after $max_attempts attempts${NC}"
    return 1
}

# Pre-deployment checks
pre_deployment_checks() {
    echo -e "${BLUE}Running pre-deployment checks...${NC}"

    # Check if required environment variables are set for production
    if [ "$ENVIRONMENT" = "production" ]; then
        if [ -z "$API_KEY" ] || [ -z "$SECRET_KEY" ] || [ -z "$JWT_SECRET" ]; then
            echo -e "${RED}Error: Production deployment requires API_KEY, SECRET_KEY, and JWT_SECRET environment variables${NC}"
            exit 1
        fi
    fi

    # Check if models directory exists
    if [ ! -d "$SCRIPT_DIR/src/models" ]; then
        echo -e "${YELLOW}Warning: Models directory not found. Creating...${NC}"
        mkdir -p "$SCRIPT_DIR/src/models"
    fi

    echo -e "${GREEN}Pre-deployment checks passed${NC}"
}

# Main deployment logic
main() {
    echo -e "${BLUE}🚀 LLM Service Deployment${NC}"
    echo -e "${BLUE}Environment: $ENVIRONMENT${NC}"
    echo -e "${BLUE}Action: $ACTION${NC}"
    echo

    # Load environment
    load_environment

    # Check prerequisites
    check_prerequisites

    # Pre-deployment checks
    pre_deployment_checks

    # Execute action
    case $ACTION in
        build)
            build_services
            start_services
            health_check
            ;;
        up)
            start_services
            health_check
            ;;
        down)
            stop_services
            ;;
        restart)
            restart_services
            health_check
            ;;
        logs)
            show_logs
            ;;
        health)
            health_check
            ;;
    esac

    echo -e "${GREEN}✅ Deployment action '$ACTION' completed successfully!${NC}"

    # Show service URLs
    if [ "$ACTION" != "down" ] && [ "$ACTION" != "logs" ]; then
        echo
        echo -e "${BLUE}Service URLs:${NC}"
        echo -e "  • API: http://localhost:8000"
        echo -e "  • Health: http://localhost:8000/health"
        echo -e "  • Stats: http://localhost:8000/stats"
        if [ "$ENVIRONMENT" = "production" ]; then
            echo -e "  • Nginx: http://localhost (port 80)"
        fi
    fi
}

# Run main function
main "$@"
