"""
Prometheus metrics for LLM Service monitoring
=============================================

Comprehensive metrics collection for performance monitoring and alerting.
"""

import os
import time
from typing import Dict, Any, Optional
from prometheus_client import (
    Counter, Histogram, Gauge, Summary, CollectorRegistry,
    generate_latest, CONTENT_TYPE_LATEST
)
from prometheus_client.core import GaugeMetricFamily, CounterMetricFamily

class MetricsCollector:
    """Prometheus metrics collector for LLM Service."""

    def __init__(self):
        # Create registry
        self.registry = CollectorRegistry()

        # HTTP Request Metrics
        self.http_requests_total = Counter(
            'llm_http_requests_total',
            'Total number of HTTP requests',
            ['method', 'endpoint', 'status_code'],
            registry=self.registry
        )

        self.http_request_duration = Histogram(
            'llm_http_request_duration_seconds',
            'HTTP request duration in seconds',
            ['method', 'endpoint'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
            registry=self.registry
        )

        # Analysis Metrics
        self.analysis_requests_total = Counter(
            'llm_analysis_requests_total',
            'Total number of secret analysis requests',
            ['secret_type', 'confidence', 'risk_level', 'cache_hit'],
            registry=self.registry
        )

        self.analysis_duration = Histogram(
            'llm_analysis_duration_seconds',
            'Secret analysis duration in seconds',
            ['secret_type'],
            buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
            registry=self.registry
        )

        # Cache Metrics
        self.cache_hits_total = Counter(
            'llm_cache_hits_total',
            'Total number of cache hits',
            registry=self.registry
        )

        self.cache_misses_total = Counter(
            'llm_cache_misses_total',
            'Total number of cache misses',
            registry=self.registry
        )

        self.cache_size = Gauge(
            'llm_cache_size',
            'Current cache size',
            registry=self.registry
        )

        # Database Metrics
        self.db_connections_active = Gauge(
            'llm_db_connections_active',
            'Number of active database connections',
            registry=self.registry
        )

        self.db_query_duration = Histogram(
            'llm_db_query_duration_seconds',
            'Database query duration in seconds',
            ['query_type'],
            buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0],
            registry=self.registry
        )

        # Model Metrics
        self.model_predictions_total = Counter(
            'llm_model_predictions_total',
            'Total number of model predictions',
            ['model_version', 'prediction_type'],
            registry=self.registry
        )

        self.model_training_samples = Gauge(
            'llm_model_training_samples',
            'Number of training samples in model',
            registry=self.registry
        )

        # Security Metrics
        self.auth_attempts_total = Counter(
            'llm_auth_attempts_total',
            'Total number of authentication attempts',
            ['result'],
            registry=self.registry
        )

        self.rate_limit_exceeded_total = Counter(
            'llm_rate_limit_exceeded_total',
            'Total number of rate limit violations',
            registry=self.registry
        )

        # System Metrics
        self.memory_usage = Gauge(
            'llm_memory_usage_bytes',
            'Memory usage in bytes',
            registry=self.registry
        )

        self.cpu_usage = Gauge(
            'llm_cpu_usage_percent',
            'CPU usage percentage',
            registry=self.registry
        )

        # Business Metrics
        self.secrets_detected_total = Counter(
            'llm_secrets_detected_total',
            'Total number of secrets detected',
            ['risk_level', 'secret_type'],
            registry=self.registry
        )

        self.user_feedback_total = Counter(
            'llm_user_feedback_total',
            'Total number of user feedback submissions',
            ['feedback_type'],
            registry=self.registry
        )

        # Service Health
        self.service_uptime = Gauge(
            'llm_service_uptime_seconds',
            'Service uptime in seconds',
            registry=self.registry
        )

        self.service_health_status = Gauge(
            'llm_service_health_status',
            'Service health status (1=healthy, 0=unhealthy)',
            registry=self.registry
        )

        # Custom business metrics
        self.api_key_usage = Counter(
            'llm_api_key_usage_total',
            'API key usage by hashed key',
            ['api_key_hash'],
            registry=self.registry
        )

    def record_http_request(self, method: str, endpoint: str, status_code: int, duration: float):
        """Record HTTP request metrics."""
        self.http_requests_total.labels(method=method, endpoint=endpoint, status_code=status_code).inc()
        self.http_request_duration.labels(method=method, endpoint=endpoint).observe(duration)

    def record_analysis(self, secret_type: str, confidence: str, risk_level: str,
                       cache_hit: bool, duration: float):
        """Record analysis metrics."""
        self.analysis_requests_total.labels(
            secret_type=secret_type,
            confidence=confidence,
            risk_level=risk_level,
            cache_hit=str(cache_hit).lower()
        ).inc()
        self.analysis_duration.labels(secret_type=secret_type).observe(duration)

        if cache_hit:
            self.cache_hits_total.inc()
        else:
            self.cache_misses_total.inc()

    def record_cache_operation(self, hit: bool):
        """Record cache hit/miss."""
        if hit:
            self.cache_hits_total.inc()
        else:
            self.cache_misses_total.inc()

    def update_cache_size(self, size: int):
        """Update cache size gauge."""
        self.cache_size.set(size)

    def record_db_query(self, query_type: str, duration: float):
        """Record database query metrics."""
        self.db_query_duration.labels(query_type=query_type).observe(duration)

    def update_db_connections(self, active_connections: int):
        """Update database connections gauge."""
        self.db_connections_active.set(active_connections)

    def record_model_prediction(self, model_version: str, prediction_type: str):
        """Record model prediction metrics."""
        self.model_predictions_total.labels(
            model_version=model_version,
            prediction_type=prediction_type
        ).inc()

    def update_training_samples(self, count: int):
        """Update training samples gauge."""
        self.model_training_samples.set(count)

    def record_auth_attempt(self, success: bool):
        """Record authentication attempt."""
        result = 'success' if success else 'failure'
        self.auth_attempts_total.labels(result=result).inc()

    def record_rate_limit_violation(self):
        """Record rate limit violation."""
        self.rate_limit_exceeded_total.inc()

    def update_system_metrics(self, memory_bytes: int, cpu_percent: float):
        """Update system resource metrics."""
        self.memory_usage.set(memory_bytes)
        self.cpu_usage.set(cpu_percent)

    def record_secret_detected(self, risk_level: str, secret_type: str):
        """Record detected secret."""
        self.secrets_detected_total.labels(
            risk_level=risk_level,
            secret_type=secret_type
        ).inc()

    def record_user_feedback(self, feedback_type: str):
        """Record user feedback."""
        self.user_feedback_total.labels(feedback_type=feedback_type).inc()

    def update_service_health(self, healthy: bool, uptime_seconds: float):
        """Update service health status."""
        self.service_health_status.set(1 if healthy else 0)
        self.service_uptime.set(uptime_seconds)

    def record_api_key_usage(self, api_key_hash: str):
        """Record API key usage."""
        self.api_key_usage.labels(api_key_hash=api_key_hash).inc()

    def get_metrics(self) -> str:
        """Get metrics in Prometheus format."""
        return generate_latest(self.registry).decode('utf-8')

    def get_metrics_dict(self) -> Dict[str, Any]:
        """Get metrics as dictionary for custom endpoints."""
        return {
            'http_requests_total': sum(self.http_requests_total._metrics.values()) if hasattr(self.http_requests_total, '_metrics') else 0,
            'cache_hit_rate': self._calculate_cache_hit_rate(),
            'analysis_requests_total': sum(self.analysis_requests_total._metrics.values()) if hasattr(self.analysis_requests_total, '_metrics') else 0,
            'db_connections_active': self.db_connections_active._value if hasattr(self.db_connections_active, '_value') else 0,
            'model_training_samples': self.model_training_samples._value if hasattr(self.model_training_samples, '_value') else 0,
            'service_health': self.service_health_status._value if hasattr(self.service_health_status, '_value') else 1,
            'uptime_seconds': self.service_uptime._value if hasattr(self.service_uptime, '_value') else 0
        }

    def _calculate_cache_hit_rate(self) -> float:
        """Calculate cache hit rate."""
        total = self.cache_hits_total._value + self.cache_misses_total._value
        if total == 0:
            return 0.0
        return self.cache_hits_total._value / total

# Global metrics collector instance
metrics_collector = MetricsCollector()

# Convenience functions
def record_http_request(method: str, endpoint: str, status_code: int, duration: float):
    """Record HTTP request metrics."""
    metrics_collector.record_http_request(method, endpoint, status_code, duration)

def record_analysis(secret_type: str, confidence: str, risk_level: str, cache_hit: bool, duration: float):
    """Record analysis metrics."""
    metrics_collector.record_analysis(secret_type, confidence, risk_level, cache_hit, duration)

def record_auth_attempt(success: bool):
    """Record authentication attempt."""
    metrics_collector.record_auth_attempt(success)

def record_rate_limit_violation():
    """Record rate limit violation."""
    metrics_collector.record_rate_limit_violation()

def update_system_metrics(memory_bytes: int, cpu_percent: float):
    """Update system metrics."""
    metrics_collector.update_system_metrics(memory_bytes, cpu_percent)

def get_metrics() -> str:
    """Get Prometheus metrics."""
    return metrics_collector.get_metrics()

def get_metrics_dict() -> Dict[str, Any]:
    """Get metrics as dictionary."""
    return metrics_collector.get_metrics_dict()
