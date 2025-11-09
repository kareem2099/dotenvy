terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.0"
    }
  }
}

provider "kubernetes" {
  config_path = "~/.kube/config"
}

provider "helm" {
  kubernetes {
    config_path = "~/.kube/config"
  }
}

# Namespace for LLM Service
resource "kubernetes_namespace" "llm_service" {
  metadata {
    name = var.namespace
  }
}

# PostgreSQL Database
resource "helm_release" "postgresql" {
  name       = "postgresql"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "postgresql"
  namespace  = kubernetes_namespace.llm_service.metadata[0].name
  version    = "12.1.0"

  set {
    name  = "auth.postgresPassword"
    value = var.postgres_password
  }

  set {
    name  = "auth.database"
    value = "llm_db"
  }

  set {
    name  = "persistence.enabled"
    value = "true"
  }

  set {
    name  = "persistence.size"
    value = "10Gi"
  }
}

# Redis Cache
resource "helm_release" "redis" {
  name       = "redis"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "redis"
  namespace  = kubernetes_namespace.llm_service.metadata[0].name
  version    = "17.3.0"

  set {
    name  = "auth.password"
    value = var.redis_password
  }

  set {
    name  = "architecture"
    value = "standalone"
  }

  set {
    name  = "persistence.enabled"
    value = "true"
  }

  set {
    name  = "persistence.size"
    value = "1Gi"
  }
}

# NGINX Ingress Controller
resource "helm_release" "ingress_nginx" {
  count      = var.enable_ingress ? 1 : 0
  name       = "ingress-nginx"
  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  namespace  = "ingress-nginx"
  version    = "4.5.2"

  create_namespace = true

  set {
    name  = "controller.replicaCount"
    value = "2"
  }

  set {
    name  = "controller.service.type"
    value = "LoadBalancer"
  }
}

# Cert Manager for SSL certificates
resource "helm_release" "cert_manager" {
  count      = var.enable_ssl ? 1 : 0
  name       = "cert-manager"
  repository = "https://charts.jetstack.io"
  chart      = "cert-manager"
  namespace  = "cert-manager"
  version    = "v1.11.0"

  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}

# Prometheus Monitoring Stack
resource "helm_release" "prometheus" {
  count      = var.enable_monitoring ? 1 : 0
  name       = "prometheus"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = "monitoring"
  version    = "45.0.0"

  create_namespace = true

  values = [
    file("${path.module}/prometheus-values.yaml")
  ]
}

# LLM Service Secrets
resource "kubernetes_secret" "llm_service_secrets" {
  metadata {
    name      = "llm-service-secrets"
    namespace = kubernetes_namespace.llm_service.metadata[0].name
  }

  data = {
    "database-url" = "postgresql://postgres:${var.postgres_password}@postgresql:5432/llm_db"
    "redis-url"    = "redis://redis:${var.redis_password}@redis-master:6379"
    "api-keys"     = join(",", var.api_keys)
    "jwt-secret"   = var.jwt_secret
  }

  type = "Opaque"
}

# LLM Service ConfigMap
resource "kubernetes_config_map" "llm_service_config" {
  metadata {
    name      = "llm-service-config"
    namespace = kubernetes_namespace.llm_service.metadata[0].name
  }

  data = {
    "ENVIRONMENT"                      = var.environment
    "LOG_LEVEL"                        = var.log_level
    "LOG_FORMAT"                       = var.log_format
    "RATE_LIMIT_REQUESTS_PER_MINUTE"   = var.rate_limit_requests_per_minute
    "HEALTH_CHECK_INTERVAL"            = var.health_check_interval
  }
}

# LLM Service Deployment
resource "kubernetes_deployment" "llm_service" {
  metadata {
    name      = "llm-service"
    namespace = kubernetes_namespace.llm_service.metadata[0].name
    labels = {
      app = "llm-service"
    }
  }

  spec {
    replicas = var.replicas

    selector {
      match_labels = {
        app = "llm-service"
      }
    }

    template {
      metadata {
        labels = {
          app = "llm-service"
        }
      }

      spec {
        container {
          name  = "llm-service"
          image = var.image_tag

          port {
            container_port = 8000
            name           = "http"
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map.llm_service_config.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.llm_service_secrets.metadata[0].name
            }
          }

          resources {
            requests = {
              memory = "512Mi"
              cpu    = "250m"
            }
            limits = {
              memory = "1Gi"
              cpu    = "500m"
            }
          }

          liveness_probe {
            http_get {
              path = "/liveness"
              port = 8000
            }
            initial_delay_seconds = 30
            period_seconds        = 10
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          readiness_probe {
            http_get {
              path = "/readiness"
              port = 8000
            }
            initial_delay_seconds = 5
            period_seconds        = 5
            timeout_seconds       = 3
            failure_threshold     = 3
          }

          security_context {
            allow_privilege_escalation = false
            run_as_non_root            = true
            run_as_user                = 1000
            read_only_root_filesystem  = true
          }
        }

        security_context {
          fs_group = 1000
        }
      }
    }
  }
}

# LLM Service Service
resource "kubernetes_service" "llm_service" {
  metadata {
    name      = "llm-service"
    namespace = kubernetes_namespace.llm_service.metadata[0].name
    labels = {
      app = "llm-service"
    }
  }

  spec {
    selector = {
      app = "llm-service"
    }

    port {
      port        = 80
      target_port = 8000
      protocol    = "TCP"
      name        = "http"
    }

    type = "ClusterIP"
  }
}

# LLM Service Metrics Service
resource "kubernetes_service" "llm_service_metrics" {
  metadata {
    name      = "llm-service-metrics"
    namespace = kubernetes_namespace.llm_service.metadata[0].name
    labels = {
      app = "llm-service"
    }
  }

  spec {
    selector = {
      app = "llm-service"
    }

    port {
      port        = 9090
      target_port = 8000
      protocol    = "TCP"
      name        = "metrics"
    }

    type = "ClusterIP"
  }
}

# Ingress for LLM Service
resource "kubernetes_ingress_v1" "llm_service" {
  count = var.enable_ingress ? 1 : 0

  metadata {
    name      = "llm-service-ingress"
    namespace = kubernetes_namespace.llm_service.metadata[0].name
    annotations = {
      "nginx.ingress.kubernetes.io/ssl-redirect"     = "true"
      "nginx.ingress.kubernetes.io/force-ssl-redirect" = "true"
      "nginx.ingress.kubernetes.io/rate-limit"       = "100"
      "nginx.ingress.kubernetes.io/rate-limit-window" = "1m"
      "cert-manager.io/cluster-issuer"               = "letsencrypt-prod"
    }
  }

  spec {
    ingress_class_name = "nginx"

    tls {
      hosts       = [var.domain_name]
      secret_name = "llm-service-tls"
    }

    rule {
      host = var.domain_name

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service.llm_service.metadata[0].name
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }
}
