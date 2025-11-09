"""
Logging configuration for LLM Service
=====================================

Structured logging with JSON format for production monitoring.
"""

import os
import sys
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from pythonjsonlogger import jsonlogger

class StructuredLogger:
    """Structured JSON logger for production monitoring."""

    def __init__(self):
        self.logger = logging.getLogger('llm_service')
        self.logger.setLevel(self._get_log_level())

        # Remove existing handlers
        for handler in self.logger.handlers[:]:
            self.logger.removeHandler(handler)

        # Add structured handler
        handler = logging.StreamHandler(sys.stdout)
        formatter = self._get_formatter()
        handler.setFormatter(formatter)
        self.logger.addHandler(handler)

        # Prevent duplicate logs
        self.logger.propagate = False

    def _get_log_level(self) -> int:
        """Get log level from environment."""
        level_map = {
            'DEBUG': logging.DEBUG,
            'INFO': logging.INFO,
            'WARNING': logging.WARNING,
            'ERROR': logging.ERROR,
            'CRITICAL': logging.CRITICAL
        }
        level = os.getenv('LOG_LEVEL', 'INFO').upper()
        return level_map.get(level, logging.INFO)

    def _get_formatter(self):
        """Get appropriate formatter based on environment."""
        if os.getenv('LOG_FORMAT') == 'json':
            return jsonlogger.JsonFormatter(
                '%(asctime)s %(name)s %(levelname)s %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )
        else:
            return logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )

    def _log(self, level: int, message: str, extra: Optional[Dict[str, Any]] = None):
        """Log message with structured data."""
        if extra:
            # Merge extra data into the log record
            self.logger.log(level, message, extra=extra)
        else:
            self.logger.log(level, message)

    def debug(self, message: str, **kwargs):
        """Log debug message."""
        self._log(logging.DEBUG, message, kwargs or None)

    def info(self, message: str, **kwargs):
        """Log info message."""
        self._log(logging.INFO, message, kwargs or None)

    def warning(self, message: str, **kwargs):
        """Log warning message."""
        self._log(logging.WARNING, message, kwargs or None)

    def error(self, message: str, **kwargs):
        """Log error message."""
        self._log(logging.ERROR, message, kwargs or None)

    def critical(self, message: str, **kwargs):
        """Log critical message."""
        self._log(logging.CRITICAL, message, kwargs or None)

    def log_request(self, request_id: str, method: str, path: str, status_code: int,
                   duration_ms: float, client_ip: str, user_agent: str):
        """Log HTTP request with structured data."""
        self.info(
            f"HTTP {method} {path}",
            request_id=request_id,
            method=method,
            path=path,
            status_code=status_code,
            duration_ms=duration_ms,
            client_ip=client_ip,
            user_agent=user_agent[:200] if user_agent else None  # Truncate long user agents
        )

    def log_analysis(self, request_id: str, secret_type: str, confidence: str,
                    risk_level: str, processing_time_ms: int, cache_hit: bool):
        """Log secret analysis with structured data."""
        self.info(
            f"Secret analysis completed",
            request_id=request_id,
            secret_type=secret_type,
            confidence=confidence,
            risk_level=risk_level,
            processing_time_ms=processing_time_ms,
            cache_hit=cache_hit
        )

    def log_security_event(self, event_type: str, client_ip: str, details: Dict[str, Any]):
        """Log security-related events."""
        self.warning(
            f"Security event: {event_type}",
            event_type=event_type,
            client_ip=client_ip,
            **details
        )

    def log_performance_metric(self, metric_name: str, value: float, tags: Dict[str, str] = None):
        """Log performance metrics."""
        log_data = {
            'metric_name': metric_name,
            'value': value
        }
        if tags:
            log_data.update(tags)

        self.info(f"Performance metric: {metric_name}", **log_data)

# Global logger instance
logger = StructuredLogger()

# Convenience functions for easy access
def log_request(request_id: str, method: str, path: str, status_code: int,
               duration_ms: float, client_ip: str, user_agent: str):
    """Convenience function for request logging."""
    logger.log_request(request_id, method, path, status_code, duration_ms, client_ip, user_agent)

def log_analysis(request_id: str, secret_type: str, confidence: str,
                risk_level: str, processing_time_ms: int, cache_hit: bool):
    """Convenience function for analysis logging."""
    logger.log_analysis(request_id, secret_type, confidence, risk_level, processing_time_ms, cache_hit)

def log_security_event(event_type: str, client_ip: str, details: Dict[str, Any]):
    """Convenience function for security event logging."""
    logger.log_security_event(event_type, client_ip, details)

def log_performance_metric(metric_name: str, value: float, **tags):
    """Convenience function for performance metric logging."""
    logger.log_performance_metric(metric_name, value, tags)
