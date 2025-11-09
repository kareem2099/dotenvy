variable "namespace" {
  description = "Kubernetes namespace for LLM service"
  type        = string
  default     = "llm-service"
}

variable "environment" {
  description = "Environment (development, staging, production)"
  type        = string
  default     = "production"
}

variable "replicas" {
  description = "Number of replicas for LLM service"
  type        = number
  default     = 3
}

variable "image_tag" {
  description = "Docker image tag for LLM service"
  type        = string
  default     = "latest"
}

variable "domain_name" {
  description = "Domain name for ingress"
  type        = string
  default     = "api.llm-service.example.com"
}

# Database Configuration
variable "postgres_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
  default     = "change-me-in-production"
}

# Redis Configuration
variable "redis_password" {
  description = "Redis password"
  type        = string
  sensitive   = true
  default     = "change-me-in-production"
}

# API Configuration
variable "api_keys" {
  description = "List of API keys"
  type        = list(string)
  sensitive   = true
  default     = ["prod-key-123", "prod-key-456"]
}

variable "jwt_secret" {
  description = "JWT secret key"
  type        = string
  sensitive   = true
  default     = "your-256-bit-secret-here-change-in-production"
}

# Application Configuration
variable "log_level" {
  description = "Logging level"
  type        = string
  default     = "INFO"
}

variable "log_format" {
  description = "Log format (console or json)"
  type        = string
  default     = "json"
}

variable "rate_limit_requests_per_minute" {
  description = "Rate limit requests per minute"
  type        = string
  default     = "100"
}

variable "health_check_interval" {
  description = "Health check interval in seconds"
  type        = string
  default     = "30"
}

# Feature Flags
variable "enable_ingress" {
  description = "Enable NGINX ingress"
  type        = bool
  default     = true
}

variable "enable_ssl" {
  description = "Enable SSL certificates with cert-manager"
  type        = bool
  default     = true
}

variable "enable_monitoring" {
  description = "Enable Prometheus monitoring stack"
  type        = bool
  default     = true
}
