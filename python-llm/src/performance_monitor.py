"""
Performance monitoring and optimization for LLM Service
=======================================================

Advanced performance profiling, memory optimization, and bottleneck detection.
"""

import os
import time
import psutil
import threading
import tracemalloc
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import gc
import sys
from contextlib import contextmanager

from .logging_config import logger
from .metrics import metrics_collector


class PerformanceMonitor:
    """Advanced performance monitoring and optimization."""

    def __init__(self):
        self.process = psutil.Process()
        self.baseline_memory = None
        self.memory_snapshots = []
        self.request_timings = []
        self.gc_stats = []
        self.is_monitoring = False
        self.monitor_thread = None

    def start_monitoring(self):
        """Start comprehensive performance monitoring."""
        if self.is_monitoring:
            return

        self.is_monitoring = True
        self.baseline_memory = self.process.memory_info().rss

        # Start memory tracing
        tracemalloc.start()

        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()

        logger.info("Performance monitoring started")

    def stop_monitoring(self):
        """Stop performance monitoring."""
        if not self.is_monitoring:
            return

        self.is_monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=5.0)

        # Stop memory tracing
        tracemalloc.stop()

        logger.info("Performance monitoring stopped")

    def _monitor_loop(self):
        """Background monitoring loop."""
        while self.is_monitoring:
            try:
                self._collect_system_metrics()
                time.sleep(30)  # Collect every 30 seconds
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")

    def _collect_system_metrics(self):
        """Collect comprehensive system metrics."""
        try:
            # Memory metrics
            memory_info = self.process.memory_info()
            memory_percent = self.process.memory_percent()

            # CPU metrics
            cpu_percent = self.process.cpu_percent(interval=1.0)

            # Thread count
            thread_count = self.process.num_threads()

            # Open file descriptors
            try:
                open_files = len(self.process.open_files())
            except:
                open_files = 0

            # Network connections
            try:
                connections = len(self.process.net_connections())
            except:
                connections = 0

            # Record metrics
            metrics_collector.update_system_metrics(memory_info.rss, cpu_percent)

            # Log performance data
            logger.log_performance_metric("memory_usage_bytes", memory_info.rss)
            logger.log_performance_metric("memory_usage_percent", memory_percent)
            logger.log_performance_metric("cpu_usage_percent", cpu_percent)
            logger.log_performance_metric("thread_count", thread_count)
            logger.log_performance_metric("open_files", open_files)
            logger.log_performance_metric("network_connections", connections)

        except Exception as e:
            logger.error(f"Error collecting system metrics: {e}")

    @contextmanager
    def profile_request(self, request_id: str, endpoint: str):
        """Context manager for profiling individual requests."""
        start_time = time.time()
        start_memory = self.process.memory_info().rss

        # Start detailed memory tracing for this request
        if tracemalloc.is_tracing():
            tracemalloc.reset_peak()

        try:
            yield
        finally:
            end_time = time.time()
            end_memory = self.process.memory_info().rss

            duration = end_time - start_time
            memory_delta = end_memory - start_memory

            # Record request timing
            self.request_timings.append({
                'request_id': request_id,
                'endpoint': endpoint,
                'duration': duration,
                'memory_delta': memory_delta,
                'timestamp': datetime.utcnow()
            })

            # Keep only last 1000 timings
            if len(self.request_timings) > 1000:
                self.request_timings = self.request_timings[-1000:]

            # Log performance metrics
            logger.log_performance_metric("request_duration_seconds", duration,
                                        endpoint=endpoint, request_id=request_id)
            logger.log_performance_metric("request_memory_delta_bytes", memory_delta,
                                        endpoint=endpoint, request_id=request_id)

            # Check for performance issues
            if duration > 5.0:  # Request took more than 5 seconds
                logger.warning(f"Slow request detected: {endpoint} took {duration:.2f}s",
                             request_id=request_id, endpoint=endpoint, duration=duration)

            if memory_delta > 50 * 1024 * 1024:  # More than 50MB memory increase
                logger.warning(f"High memory usage: {endpoint} used {memory_delta/1024/1024:.1f}MB",
                             request_id=request_id, endpoint=endpoint, memory_delta=memory_delta)

    def get_performance_report(self) -> Dict[str, Any]:
        """Generate comprehensive performance report."""
        report = {
            'timestamp': datetime.utcnow().isoformat(),
            'uptime_seconds': time.time() - psutil.boot_time(),
            'process_info': {
                'pid': self.process.pid,
                'cpu_percent': self.process.cpu_percent(),
                'memory_rss': self.process.memory_info().rss,
                'memory_vms': self.process.memory_info().vms,
                'memory_percent': self.process.memory_percent(),
                'threads': self.process.num_threads(),
                'open_files': len(self.process.open_files()) if self.process.open_files() else 0,
            },
            'system_info': {
                'cpu_count': psutil.cpu_count(),
                'cpu_count_logical': psutil.cpu_count(logical=True),
                'memory_total': psutil.virtual_memory().total,
                'memory_available': psutil.virtual_memory().available,
                'disk_total': psutil.disk_usage('/').total,
                'disk_free': psutil.disk_usage('/').free,
            }
        }

        # Request performance statistics
        if self.request_timings:
            durations = [r['duration'] for r in self.request_timings]
            memory_deltas = [r['memory_delta'] for r in self.request_timings]

            report['request_stats'] = {
                'total_requests': len(self.request_timings),
                'avg_duration': sum(durations) / len(durations),
                'max_duration': max(durations),
                'min_duration': min(durations),
                'p95_duration': sorted(durations)[int(len(durations) * 0.95)],
                'avg_memory_delta': sum(memory_deltas) / len(memory_deltas),
                'max_memory_delta': max(memory_deltas),
            }

            # Endpoint breakdown
            endpoint_stats = {}
            for timing in self.request_timings:
                endpoint = timing['endpoint']
                if endpoint not in endpoint_stats:
                    endpoint_stats[endpoint] = []
                endpoint_stats[endpoint].append(timing['duration'])

            report['endpoint_stats'] = {}
            for endpoint, times in endpoint_stats.items():
                report['endpoint_stats'][endpoint] = {
                    'count': len(times),
                    'avg_duration': sum(times) / len(times),
                    'max_duration': max(times),
                }

        # Memory analysis
        if tracemalloc.is_tracing():
            current, peak = tracemalloc.get_traced_memory()
            report['memory_analysis'] = {
                'current_memory': current,
                'peak_memory': peak,
                'memory_traced': True
            }

            # Get top memory consumers
            try:
                snapshot = tracemalloc.take_snapshot()
                top_stats = snapshot.statistics('lineno')[:10]
                report['memory_analysis']['top_consumers'] = [
                    {
                        'file': stat.traceback[0].filename,
                        'line': stat.traceback[0].lineno,
                        'size': stat.size,
                        'count': stat.count
                    }
                    for stat in top_stats
                ]
            except Exception as e:
                report['memory_analysis']['error'] = str(e)

        # Garbage collection stats
        gc_stats = {}
        for i, stats in enumerate(gc.get_stats()):
            gc_stats[f'gen_{i}'] = {
                'collected': stats['collected'],
                'uncollectable': stats['uncollectable'],
            }
        report['gc_stats'] = gc_stats

        return report

    def optimize_memory(self):
        """Perform memory optimization."""
        logger.info("Starting memory optimization")

        # Force garbage collection
        collected = gc.collect()
        logger.info(f"Garbage collection freed {collected} objects")

        # Clear any cached data that can be rebuilt
        if hasattr(self, 'memory_snapshots') and len(self.memory_snapshots) > 100:
            # Keep only last 100 snapshots
            self.memory_snapshots = self.memory_snapshots[-100:]
            logger.info("Cleared old memory snapshots")

        # Reset tracemalloc peak if tracing
        if tracemalloc.is_tracing():
            tracemalloc.reset_peak()
            logger.info("Reset memory tracing peak")

        logger.info("Memory optimization completed")

    def detect_bottlenecks(self) -> List[str]:
        """Detect performance bottlenecks."""
        issues = []

        # Check memory usage
        memory_percent = self.process.memory_percent()
        if memory_percent > 80:
            issues.append(f"High memory usage: {memory_percent:.1f}%")

        # Check request performance
        if self.request_timings:
            recent_requests = [r for r in self.request_timings
                             if (datetime.utcnow() - r['timestamp']).seconds < 300]  # Last 5 minutes

            if recent_requests:
                avg_duration = sum(r['duration'] for r in recent_requests) / len(recent_requests)
                if avg_duration > 2.0:
                    issues.append(f"Slow average response time: {avg_duration:.2f}s")

                slow_requests = [r for r in recent_requests if r['duration'] > 5.0]
                if slow_requests:
                    issues.append(f"Found {len(slow_requests)} requests slower than 5 seconds")

        # Check thread count
        thread_count = self.process.num_threads()
        if thread_count > 50:
            issues.append(f"High thread count: {thread_count}")

        return issues


# Global performance monitor instance
performance_monitor = PerformanceMonitor()


# Convenience functions
def start_performance_monitoring():
    """Start performance monitoring."""
    performance_monitor.start_monitoring()

def stop_performance_monitoring():
    """Stop performance monitoring."""
    performance_monitor.stop_monitoring()

def get_performance_report() -> Dict[str, Any]:
    """Get performance report."""
    return performance_monitor.get_performance_report()

def profile_request_context(request_id: str, endpoint: str):
    """Get profiling context manager."""
    return performance_monitor.profile_request(request_id, endpoint)

def optimize_memory():
    """Optimize memory usage."""
    performance_monitor.optimize_memory()

def detect_performance_bottlenecks() -> List[str]:
    """Detect performance bottlenecks."""
    return performance_monitor.detect_bottlenecks()
