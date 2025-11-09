"""
Health check system for LLM Service
===================================

Comprehensive health monitoring with dependency checks and detailed status reporting.
"""

import os
import time
import psutil
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from .cache import redis_cache
from .database import db_manager
from .metrics import metrics_collector

class HealthChecker:
    """Comprehensive health checker for all service dependencies."""

    def __init__(self):
        self.start_time = time.time()
        self.last_health_check = None
        self.health_check_interval = int(os.getenv('HEALTH_CHECK_INTERVAL', '30'))

    def check_overall_health(self) -> Dict[str, Any]:
        """Perform comprehensive health check."""
        health_status = {
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'uptime_seconds': time.time() - self.start_time,
            'checks': {}
        }

        checks = [
            self._check_database,
            self._check_cache,
            self._check_memory,
            self._check_disk,
            self._check_dependencies
        ]

        all_healthy = True
        for check_func in checks:
            check_name = check_func.__name__.replace('_check_', '')
            try:
                result = check_func()
                health_status['checks'][check_name] = result
                if not result.get('healthy', True):
                    all_healthy = False
            except Exception as e:
                health_status['checks'][check_name] = {
                    'healthy': False,
                    'error': str(e),
                    'timestamp': datetime.utcnow().isoformat()
                }
                all_healthy = False

        health_status['status'] = 'healthy' if all_healthy else 'unhealthy'

        # Update metrics
        metrics_collector.update_service_health(all_healthy, health_status['uptime_seconds'])

        self.last_health_check = health_status
        return health_status

    def _check_database(self) -> Dict[str, Any]:
        """Check database connectivity and performance."""
        try:
            start_time = time.time()

            # Test basic connectivity
            session = db_manager.get_session()
            session.execute("SELECT 1")
            session.close()

            response_time = time.time() - start_time

            # Get connection count (simplified)
            active_connections = 1  # In a real scenario, you'd query pg_stat_activity

            metrics_collector.update_db_connections(active_connections)
            metrics_collector.record_db_query('health_check', response_time)

            return {
                'healthy': True,
                'response_time_ms': response_time * 1000,
                'active_connections': active_connections,
                'timestamp': datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                'healthy': False,
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    def _check_cache(self) -> Dict[str, Any]:
        """Check Redis cache connectivity and performance."""
        try:
            health_result = redis_cache.health_check()

            # Update cache size metric
            cache_stats = redis_cache.get_cache_stats()
            cache_size = cache_stats.get('total_keys', 0)
            metrics_collector.update_cache_size(cache_size)

            return {
                'healthy': health_result.get('healthy', False),
                'status': health_result.get('status', 'unknown'),
                'cache_keys': cache_size,
                'memory_used': cache_stats.get('memory_used', 'unknown'),
                'timestamp': datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                'healthy': False,
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    def _check_memory(self) -> Dict[str, Any]:
        """Check system memory usage."""
        try:
            memory = psutil.virtual_memory()
            memory_usage_bytes = memory.used
            memory_usage_percent = memory.percent

            # Alert thresholds
            critical_threshold = 90.0
            warning_threshold = 80.0

            status = 'healthy'
            if memory_usage_percent >= critical_threshold:
                status = 'critical'
            elif memory_usage_percent >= warning_threshold:
                status = 'warning'

            # Update metrics
            metrics_collector.update_system_metrics(memory_usage_bytes, psutil.cpu_percent())

            return {
                'healthy': status == 'healthy',
                'status': status,
                'used_bytes': memory_usage_bytes,
                'used_percent': memory_usage_percent,
                'available_bytes': memory.available,
                'total_bytes': memory.total,
                'timestamp': datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                'healthy': False,
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    def _check_disk(self) -> Dict[str, Any]:
        """Check disk usage."""
        try:
            disk = psutil.disk_usage('/')
            disk_usage_percent = disk.percent

            # Alert thresholds
            critical_threshold = 95.0
            warning_threshold = 85.0

            status = 'healthy'
            if disk_usage_percent >= critical_threshold:
                status = 'critical'
            elif disk_usage_percent >= warning_threshold:
                status = 'warning'

            return {
                'healthy': status == 'healthy',
                'status': status,
                'used_bytes': disk.used,
                'free_bytes': disk.free,
                'total_bytes': disk.total,
                'used_percent': disk_usage_percent,
                'timestamp': datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {
                'healthy': False,
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    def _check_dependencies(self) -> Dict[str, Any]:
        """Check Python dependencies and imports."""
        dependencies = [
            'fastapi',
            'uvicorn',
            'sqlalchemy',
            'redis',
            'psycopg2',
            'numpy',
            'scipy'
        ]

        failed_deps = []
        for dep in dependencies:
            try:
                __import__(dep)
            except ImportError:
                failed_deps.append(dep)

        return {
            'healthy': len(failed_deps) == 0,
            'total_dependencies': len(dependencies),
            'failed_dependencies': failed_deps,
            'checked_dependencies': dependencies,
            'timestamp': datetime.utcnow().isoformat()
        }

    def get_detailed_health(self) -> Dict[str, Any]:
        """Get detailed health information including recent metrics."""
        health = self.check_overall_health()

        # Add additional context
        health.update({
            'version': '1.0.0',
            'environment': os.getenv('ENVIRONMENT', 'development'),
            'service_name': os.getenv('SERVICE_NAME', 'llm-service'),
            'metrics_summary': metrics_collector.get_metrics_dict(),
            'last_check': self.last_health_check['timestamp'] if self.last_health_check else None
        })

        return health

    def get_readiness(self) -> Dict[str, Any]:
        """Kubernetes readiness probe."""
        health = self.check_overall_health()

        # For readiness, we focus on critical dependencies
        critical_checks = ['database', 'cache']
        ready = all(
            health['checks'].get(check, {}).get('healthy', False)
            for check in critical_checks
        )

        return {
            'ready': ready,
            'status': 'ready' if ready else 'not ready',
            'timestamp': datetime.utcnow().isoformat(),
            'checks': {k: v for k, v in health['checks'].items() if k in critical_checks}
        }

    def get_liveness(self) -> Dict[str, Any]:
        """Kubernetes liveness probe."""
        # For liveness, we just check if the service is running
        return {
            'alive': True,
            'status': 'alive',
            'timestamp': datetime.utcnow().isoformat(),
            'uptime_seconds': time.time() - self.start_time
        }

# Global health checker instance
health_checker = HealthChecker()

# Convenience functions
def check_health() -> Dict[str, Any]:
    """Get overall health status."""
    return health_checker.check_overall_health()

def check_readiness() -> Dict[str, Any]:
    """Get readiness status for Kubernetes."""
    return health_checker.get_readiness()

def check_liveness() -> Dict[str, Any]:
    """Get liveness status for Kubernetes."""
    return health_checker.get_liveness()

def get_detailed_health() -> Dict[str, Any]:
    """Get detailed health information."""
    return health_checker.get_detailed_health()
