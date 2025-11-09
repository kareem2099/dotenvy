"""
Unit tests for LLM Service
==========================

Comprehensive test suite covering all service components.
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient
from fastapi import HTTPException
import json
import os

# Set test environment BEFORE importing
os.environ['ENVIRONMENT'] = 'test'
os.environ['API_KEY'] = 'test-key-123'
os.environ['JWT_SECRET'] = 'test-jwt-secret'

from src.service import app, analyzer, security_manager

# Initialize security manager for tests
security_manager.load_api_keys()
from src.model import CustomLLM, ModelConfig
from src.cache import redis_cache
from src.database import db_manager


class TestLLMAnalyzer:
    """Test cases for LLM analyzer functionality."""

    def setup_method(self):
        """Set up test fixtures."""
        self.analyzer = analyzer

    def test_calculate_enhanced_confidence(self):
        """Test confidence calculation."""
        secret = "sk-1234567890abcdef"
        context = "const apiKey = \"sk-1234567890abcdef\";"
        confidence = self.analyzer.calculate_enhanced_confidence(secret, context, "low")
        assert isinstance(confidence, str)
        assert confidence in ["high", "medium", "low"]

    def test_extract_features(self):
        """Test feature extraction."""
        secret = "test-secret-123"
        context = "const key = \"test-secret-123\";"
        features = self.analyzer.extract_features(secret, context)
        # Features is a numpy array, convert to list for testing
        features_list = features.tolist() if hasattr(features, 'tolist') else features
        assert isinstance(features_list, list)
        assert len(features_list) > 0

    def test_categorize_secret(self):
        """Test secret categorization."""
        # Test API key
        category = self.analyzer._categorize_secret("sk-1234567890abcdef")
        assert category == "API Key"

        # Test generic secret
        category = self.analyzer._categorize_secret("some-random-secret")
        assert category == "Potential Secret"

    def test_assess_risk_level(self):
        """Test risk level assessment."""
        # High risk context
        risk = self.analyzer._assess_risk_level("secret", "process.env.SECRET_KEY")
        assert risk in ["high", "medium", "low", "critical"]

    def test_entropy_calculation(self):
        """Test entropy calculation."""
        high_entropy = self.analyzer._calculate_entropy("sk-1234567890abcdef")
        low_entropy = self.analyzer._calculate_entropy("aaaaaaaa")
        assert high_entropy > low_entropy


class TestSecurityManager:
    """Test cases for security manager."""

    def setup_method(self):
        """Set up test fixtures."""
        self.security = security_manager

    def test_api_key_verification(self):
        """Test API key verification."""
        assert self.security.verify_api_key("test-key-123") == True
        assert self.security.verify_api_key("invalid-key") == False

    def test_jwt_token_generation(self):
        """Test JWT token generation."""
        token = self.security.generate_jwt_token("test-user")
        assert isinstance(token, str)
        assert len(token) > 0

    def test_jwt_token_verification(self):
        """Test JWT token verification."""
        token = self.security.generate_jwt_token("test-user")
        payload = self.security.verify_jwt_token(token)
        assert payload is not None
        assert payload["sub"] == "test-user"

    def test_rate_limiting(self):
        """Test rate limiting functionality."""
        client_ip = "192.168.1.100"

        # Should allow requests within limit
        for i in range(60):
            assert self.security.check_rate_limit(client_ip) == True

        # Should block after limit exceeded
        assert self.security.check_rate_limit(client_ip) == False


class TestAPISecurity:
    """Test API security endpoints."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_health_endpoint_no_auth(self):
        """Test health endpoint doesn't require authentication."""
        response = self.client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "llm_ready" in data

    def test_analyze_endpoint_requires_auth(self):
        """Test analyze endpoint requires authentication."""
        response = self.client.post("/analyze", json={
            "secret_value": "test",
            "context": "test"
        })
        assert response.status_code == 401

    def test_analyze_endpoint_with_valid_key(self):
        """Test analyze endpoint with valid API key."""
        response = self.client.post("/analyze", json={
            "secret_value": "sk-1234567890abcdef",
            "context": "const apiKey = \"sk-1234567890abcdef\";",
            "variable_name": "apiKey"
        }, headers={"X-API-KEY": "test-key-123"})

        assert response.status_code == 200
        data = response.json()
        assert "enhanced_confidence" in data
        assert "is_likely_secret" in data
        assert "category" in data
        assert "risk_level" in data

    def test_analyze_endpoint_with_invalid_key(self):
        """Test analyze endpoint with invalid API key."""
        response = self.client.post("/analyze", json={
            "secret_value": "test",
            "context": "test"
        }, headers={"X-API-KEY": "invalid-key"})

        assert response.status_code == 401

    def test_input_validation(self):
        """Test input validation."""
        # Test empty secret
        response = self.client.post("/analyze", json={
            "secret_value": "",
            "context": "test"
        }, headers={"X-API-KEY": "test-key-123"})
        assert response.status_code == 422  # Validation error

        # Test overly long secret
        long_secret = "x" * 10001
        response = self.client.post("/analyze", json={
            "secret_value": long_secret,
            "context": "test"
        }, headers={"X-API-KEY": "test-key-123"})
        assert response.status_code == 422  # Validation error


class TestMonitoring:
    """Test monitoring and observability."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_metrics_endpoint(self):
        """Test Prometheus metrics endpoint."""
        response = self.client.get("/metrics")
        assert response.status_code == 200
        content = response.text
        assert "llm_http_requests_total" in content
        assert "python_info" in content

    def test_health_detailed_endpoint(self):
        """Test detailed health check."""
        response = self.client.get("/health/detailed")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "checks" in data

    def test_readiness_endpoint(self):
        """Test readiness probe."""
        response = self.client.get("/readiness")
        assert response.status_code == 200
        data = response.json()
        assert "ready" in data
        assert "status" in data

    def test_liveness_endpoint(self):
        """Test liveness probe."""
        response = self.client.get("/liveness")
        assert response.status_code == 200
        data = response.json()
        assert "alive" in data
        assert "uptime_seconds" in data


class TestTraining:
    """Test model training functionality."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_train_endpoint_requires_auth(self):
        """Test training endpoint requires authentication."""
        response = self.client.post("/train", json={
            "secret_value": "test-secret",
            "context": "const key = \"test-secret\";",
            "user_action": "confirmed_secret",
            "label": "high"
        })
        assert response.status_code == 401

    def test_train_endpoint_with_valid_key(self):
        """Test training endpoint with valid API key."""
        response = self.client.post("/train", json={
            "secret_value": "test-secret",
            "context": "const key = \"test-secret\";",
            "user_action": "confirmed_secret",
            "label": "high"
        }, headers={"X-API-KEY": "test-key-123"})

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] in ["trained", "sample_added"]


class TestStatistics:
    """Test statistics and analytics endpoints."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_stats_endpoint(self):
        """Test comprehensive statistics endpoint."""
        response = self.client.get("/stats")
        assert response.status_code == 200
        data = response.json()
        assert "model" in data
        assert "training" in data
        assert "cache" in data
        assert "database" in data
        assert "service" in data

    def test_analytics_summary_endpoint(self):
        """Test analytics summary endpoint."""
        response = self.client.get("/analytics/summary?days=7")
        assert response.status_code == 200
        data = response.json()
        # Analytics may be empty in test environment
        assert isinstance(data, dict)


class TestCacheOperations:
    """Test cache management endpoints."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_cache_clear_endpoint(self):
        """Test cache clearing endpoint."""
        response = self.client.post("/cache/clear")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_cache_stats_endpoint(self):
        """Test cache statistics endpoint."""
        response = self.client.get("/cache/stats")
        assert response.status_code == 200
        data = response.json()
        assert "redis" in data
        assert "application" in data


class TestModelVersioning:
    """Test model versioning functionality."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_versions_endpoint(self):
        """Test model versions endpoint."""
        response = self.client.get("/versions")
        assert response.status_code == 200
        data = response.json()
        assert "active_version" in data
        assert "versions" in data

    def test_create_version_endpoint(self):
        """Test creating new model version."""
        response = self.client.post("/versions/create?version_name=test-v1")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_switch_version_endpoint(self):
        """Test switching model version."""
        # First create a version
        self.client.post("/versions/create?version_name=test-v2")

        # Then switch to it
        response = self.client.post("/versions/switch?version_name=test-v2")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data


class TestABTesting:
    """Test A/B testing functionality."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_ab_test_results_endpoint(self):
        """Test A/B test results endpoint."""
        response = self.client.get("/ab/results")
        assert response.status_code == 200
        data = response.json()
        # A/B testing may not be enabled
        assert isinstance(data, dict)

    def test_enable_ab_testing_endpoint(self):
        """Test enabling A/B testing."""
        response = self.client.post("/ab/enable?version_a=default&version_b=default")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data


class TestErrorHandling:
    """Test error handling and edge cases."""

    def setup_method(self):
        """Set up test client."""
        self.client = TestClient(app)

    def test_invalid_json_payload(self):
        """Test handling of invalid JSON payloads."""
        response = self.client.post("/analyze",
            data="invalid json",
            headers={"X-API-KEY": "test-key-123", "Content-Type": "application/json"}
        )
        assert response.status_code == 422

    def test_missing_required_fields(self):
        """Test handling of missing required fields."""
        response = self.client.post("/analyze", json={
            "context": "test context"
            # Missing secret_value
        }, headers={"X-API-KEY": "test-key-123"})
        assert response.status_code == 422

    def test_rate_limit_exceeded(self):
        """Test rate limiting behavior."""
        # This would require multiple rapid requests
        # In a real test, we'd mock the rate limiter
        pass


# Integration test fixtures
@pytest.fixture
def test_client():
    """Test client fixture."""
    return TestClient(app)


@pytest.fixture
def auth_headers():
    """Authentication headers fixture."""
    return {"X-API-KEY": "test-key-123"}


@pytest.fixture
def sample_secret_data():
    """Sample secret data fixture."""
    return {
        "secret_value": "sk-1234567890abcdef",
        "context": "const apiKey = \"sk-1234567890abcdef\";",
        "variable_name": "apiKey"
    }


@pytest.fixture
def sample_training_data():
    """Sample training data fixture."""
    return {
        "secret_value": "test-secret",
        "context": "const key = \"test-secret\";",
        "user_action": "confirmed_secret",
        "label": "high"
    }


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
