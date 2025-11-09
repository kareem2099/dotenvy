"""
Redis cache manager for distributed caching
===========================================

Handles Redis integration for high-performance distributed caching.
"""

import os
import json
import hashlib
from typing import Any, Optional, Dict, List
import redis
from redis.exceptions import RedisError, ConnectionError

class RedisCacheManager:
    """Manages Redis connections and caching operations."""

    def __init__(self):
        self.redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        self.client = None
        self.is_connected = False
        self.cache_prefix = "llm_cache:"
        self.session_prefix = "llm_session:"
        self.analytics_prefix = "llm_analytics:"
        self._connect()

    def _connect(self):
        """Establish Redis connection."""
        try:
            self.client = redis.from_url(self.redis_url, decode_responses=True)
            # Test connection
            self.client.ping()
            self.is_connected = True
            print("✅ Redis cache connected successfully")
        except (ConnectionError, RedisError) as e:
            print(f"❌ Redis connection failed: {e}")
            self.is_connected = False
            # Continue without Redis - fallback to in-memory cache

    def _get_cache_key(self, key: str) -> str:
        """Generate prefixed cache key."""
        return f"{self.cache_prefix}{key}"

    def _get_session_key(self, session_id: str) -> str:
        """Generate prefixed session key."""
        return f"{self.session_prefix}{session_id}"

    def _get_analytics_key(self, key: str) -> str:
        """Generate prefixed analytics key."""
        return f"{self.analytics_prefix}{key}"

    def get(self, key: str) -> Optional[Any]:
        """Get value from cache."""
        if not self.is_connected:
            return None

        try:
            cache_key = self._get_cache_key(key)
            value = self.client.get(cache_key)
            if value:
                return json.loads(value)
            return None
        except RedisError:
            return None

    def set(self, key: str, value: Any, ttl_seconds: int = 3600) -> bool:
        """Set value in cache with TTL."""
        if not self.is_connected:
            return False

        try:
            cache_key = self._get_cache_key(key)
            json_value = json.dumps(value)
            return bool(self.client.setex(cache_key, ttl_seconds, json_value))
        except (RedisError, TypeError):
            return False

    def delete(self, key: str) -> bool:
        """Delete value from cache."""
        if not self.is_connected:
            return False

        try:
            cache_key = self._get_cache_key(key)
            return bool(self.client.delete(cache_key))
        except RedisError:
            return False

    def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        if not self.is_connected:
            return False

        try:
            cache_key = self._get_cache_key(key)
            return bool(self.client.exists(cache_key))
        except RedisError:
            return False

    def clear_pattern(self, pattern: str) -> int:
        """Clear all keys matching pattern."""
        if not self.is_connected:
            return 0

        try:
            cache_pattern = f"{self.cache_prefix}{pattern}"
            keys = self.client.keys(cache_pattern)
            if keys:
                return self.client.delete(*keys)
            return 0
        except RedisError:
            return 0

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        if not self.is_connected:
            return {"status": "disconnected"}

        try:
            info = self.client.info()
            cache_keys = len(self.client.keys(f"{self.cache_prefix}*"))

            return {
                "status": "connected",
                "total_keys": cache_keys,
                "memory_used": info.get('used_memory_human', 'unknown'),
                "connected_clients": info.get('connected_clients', 0),
                "uptime_days": info.get('uptime_in_days', 0),
                "hit_rate": "unknown"  # Would need keyspace hits/misses tracking
            }
        except RedisError:
            return {"status": "error"}

    # Session management
    def create_session(self, session_id: str, data: Dict[str, Any], ttl_seconds: int = 3600) -> bool:
        """Create a session."""
        if not self.is_connected:
            return False

        try:
            session_key = self._get_session_key(session_id)
            json_data = json.dumps(data)
            return bool(self.client.setex(session_key, ttl_seconds, json_data))
        except (RedisError, TypeError):
            return False

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get session data."""
        if not self.is_connected:
            return None

        try:
            session_key = self._get_session_key(session_id)
            value = self.client.get(session_key)
            if value:
                return json.loads(value)
            return None
        except (RedisError, TypeError):
            return None

    def update_session(self, session_id: str, data: Dict[str, Any], ttl_seconds: int = 3600) -> bool:
        """Update session data."""
        return self.create_session(session_id, data, ttl_seconds)

    def delete_session(self, session_id: str) -> bool:
        """Delete session."""
        if not self.is_connected:
            return False

        try:
            session_key = self._get_session_key(session_id)
            return bool(self.client.delete(session_key))
        except RedisError:
            return False

    # Analytics and metrics
    def increment_counter(self, key: str, amount: int = 1) -> bool:
        """Increment analytics counter."""
        if not self.is_connected:
            return False

        try:
            analytics_key = self._get_analytics_key(key)
            self.client.incrby(analytics_key, amount)
            # Set expiry for analytics data (30 days)
            self.client.expire(analytics_key, 30 * 24 * 3600)
            return True
        except RedisError:
            return False

    def get_counter(self, key: str) -> int:
        """Get analytics counter value."""
        if not self.is_connected:
            return 0

        try:
            analytics_key = self._get_analytics_key(key)
            value = self.client.get(analytics_key)
            return int(value) if value else 0
        except (RedisError, ValueError):
            return 0

    def add_to_set(self, key: str, member: str) -> bool:
        """Add member to analytics set."""
        if not self.is_connected:
            return False

        try:
            analytics_key = self._get_analytics_key(key)
            self.client.sadd(analytics_key, member)
            # Set expiry for analytics data (30 days)
            self.client.expire(analytics_key, 30 * 24 * 3600)
            return True
        except RedisError:
            return False

    def get_set_members(self, key: str) -> List[str]:
        """Get all members of analytics set."""
        if not self.is_connected:
            return []

        try:
            analytics_key = self._get_analytics_key(key)
            return list(self.client.smembers(analytics_key))
        except RedisError:
            return []

    # Rate limiting
    def check_rate_limit(self, identifier: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """
        Check if identifier is within rate limit.
        Returns (allowed: bool, remaining_attempts: int)
        """
        if not self.is_connected:
            return True, limit  # Allow if Redis is down

        try:
            key = f"ratelimit:{identifier}"
            current = self.client.get(key)

            if current is None:
                # First request in window
                self.client.setex(key, window_seconds, 1)
                return True, limit - 1
            else:
                current_count = int(current)
                if current_count >= limit:
                    # Rate limit exceeded
                    return False, 0
                else:
                    # Increment counter
                    self.client.incr(key)
                    return True, limit - current_count - 1
        except (RedisError, ValueError):
            return True, limit  # Allow on error

    # Pub/Sub for real-time features
    def publish_message(self, channel: str, message: Dict[str, Any]) -> bool:
        """Publish message to channel."""
        if not self.is_connected:
            return False

        try:
            json_message = json.dumps(message)
            return bool(self.client.publish(channel, json_message))
        except (RedisError, TypeError):
            return False

    def subscribe_to_channel(self, channel: str):
        """Subscribe to channel (returns pubsub object)."""
        if not self.is_connected:
            return None

        try:
            pubsub = self.client.pubsub()
            pubsub.subscribe(channel)
            return pubsub
        except RedisError:
            return None

    # Health check
    def health_check(self) -> Dict[str, Any]:
        """Perform health check."""
        if not self.is_connected:
            return {"status": "disconnected", "healthy": False}

        try:
            # Test basic operations
            test_key = "health_check_test"
            self.client.setex(test_key, 10, "ok")
            value = self.client.get(test_key)
            self.client.delete(test_key)

            return {
                "status": "connected",
                "healthy": value == "ok",
                "ping_time": "ok"
            }
        except RedisError:
            return {"status": "error", "healthy": False}

# Global Redis cache manager instance
redis_cache = RedisCacheManager()
