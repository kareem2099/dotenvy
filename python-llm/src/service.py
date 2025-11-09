"""
Custom LLM Service for VS Code Extension
========================================

Main service interface for the custom LLM, providing analysis
and training capabilities for secret detection.
"""

import os
import numpy as np
import json
import hashlib
import hmac
import secrets
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Depends, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, validator
import jwt
import re

from .model import CustomLLM, ModelConfig
from .attention import CustomAttention
from .cache import redis_cache
from .database import db_manager
from .logging_config import log_request, log_analysis, log_security_event
from .metrics import record_http_request, record_analysis, record_auth_attempt, record_rate_limit_violation, get_metrics
from .health import check_health, check_readiness, check_liveness, get_detailed_health
from .performance_monitor import start_performance_monitoring, get_performance_report, profile_request_context, optimize_memory, detect_performance_bottlenecks
import math
import time
import hashlib

# Security Models
class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int

class UserCredentials(BaseModel):
    username: str
    password: str

# API Models with enhanced validation
class AnalyzeResponse(BaseModel):
    enhanced_confidence: str
    method: str
    is_likely_secret: bool
    category: str
    risk_level: str
    reasoning: List[str]
    error: Optional[str] = None
    request_id: Optional[str] = None

class AnalyzeRequest(BaseModel):
    secret_value: str
    context: str
    variable_name: Optional[str] = None
    features: Optional[List[float]] = None

    @validator('secret_value')
    def validate_secret_value(cls, v):
        if not v or not isinstance(v, str):
            raise ValueError('secret_value must be a non-empty string')
        if len(v) > 10000:  # Prevent extremely long inputs
            raise ValueError('secret_value too long (max 10000 characters)')
        # Sanitize - remove null bytes and other dangerous chars
        v = v.replace('\x00', '').replace('\r', '').replace('\n', ' ')
        return v.strip()

    @validator('context')
    def validate_context(cls, v):
        if not isinstance(v, str):
            raise ValueError('context must be a string')
        if len(v) > 5000:  # Reasonable limit for context
            raise ValueError('context too long (max 5000 characters)')
        # Sanitize context
        v = v.replace('\x00', '').replace('\r\n', '\n').replace('\r', '\n')
        return v.strip()

class TrainingSample(BaseModel):
    secret_value: str
    context: str
    features: Optional[List[float]] = None  # Made optional - server calculates its own
    variable_name: Optional[str] = None    # Added for better feature extraction
    user_action: str
    label: str

    @validator('user_action')
    def validate_user_action(cls, v):
        allowed_actions = ['confirmed_secret', 'ignored_warning', 'marked_false_positive']
        if v not in allowed_actions:
            raise ValueError(f'user_action must be one of: {allowed_actions}')
        return v

    @validator('label')
    def validate_label(cls, v):
        allowed_labels = ['high', 'medium', 'low', 'false_positive']
        if v not in allowed_labels:
            raise ValueError(f'label must be one of: {allowed_labels}')
        return v

# Global model
model = None

class LLMAnalyzer:
    """
    Custom LLM analyzer for secret detection.
    Replaces the original MLLearner with LLM-powered analysis.
    """

    def __init__(self):
        self.config = ModelConfig()
        self.model = CustomLLM(self.config)
        self.load_model()

        # Performance optimizations - now using Redis
        self.cache_hits = 0
        self.cache_misses = 0

        # Model versioning and A/B testing
        self.model_versions = {}
        self.active_version = "default"
        self.ab_testing_enabled = False
        self.ab_test_groups = {"A": "default", "B": "default"}
        self.version_performance = {}

    def load_model(self):
        """Load model from saved state."""
        model_path = os.path.join(os.path.dirname(__file__), "models", "llm_model.json")
        if os.path.exists(model_path):
            self.model.load_model(model_path)

    def save_model(self):
        """Save model state."""
        model_path = os.path.join(os.path.dirname(__file__), "models", "llm_model.json")
        os.makedirs(os.path.dirname(model_path), exist_ok=True)
        self.model.save_model(model_path)

    def extract_features(self, secret_value: str, context: str, variable_name: Optional[str] = None) -> np.ndarray:
        """
        Extract numerical features from secret and context.
        """
        return self._extract_features(secret_value, context, variable_name)

    def calculate_enhanced_confidence(self, secret_value: str, context: str, traditional_confidence: str, variable_name: Optional[str] = None) -> str:
        """
        Calculate enhanced confidence using LLM, with Redis caching.
        """
        # 1. Create a unique cache key (hash for privacy)
        cache_key = hashlib.sha256(f"{secret_value}|{context}|{variable_name}".encode()).hexdigest()

        # 2. Check Redis cache first
        cached_result = redis_cache.get(cache_key)
        if cached_result is not None:
            self.cache_hits += 1
            return cached_result

        # 3. Cache Miss - Increment miss counter
        self.cache_misses += 1

        # 4. Do the expensive work (This only runs on a miss)
        features = self.extract_features(secret_value, context, variable_name)
        result = self.model.forward(secret_value, features)

        # Map LLM prediction to confidence level
        if result['confidence'] > 0.8 or result['prediction'] == 'high':
            confidence_level = "high"
        elif result['confidence'] > 0.6 or result['prediction'] == 'medium':
            confidence_level = "medium"
        elif result['prediction'] == 'false_positive':
            confidence_level = "low"
        else:
            confidence_level = traditional_confidence

        # 5. Store the new result in Redis cache (1 hour TTL)
        redis_cache.set(cache_key, confidence_level, ttl_seconds=3600)

        return confidence_level

    def record_user_feedback(self, secret_value: str, context: str, features: List[float], user_action: str):
        """
        Record user feedback for learning.
        """
        # For now, this is a placeholder
        # In full implementation, would update model weights
        print(f"Recorded feedback: {user_action} for secret")

    def get_stats(self) -> Dict[str, Any]:
        """Get model statistics."""
        return self.model.get_model_stats()

    # Helper methods for feature extraction
    def _extract_features(self, secret_value: str, context: str, variable_name: Optional[str] = None) -> np.ndarray:
        """Enhanced feature extraction with sophisticated pattern recognition."""
        features = []

        # Basic features
        features.append(len(secret_value))
        features.append(self._calculate_entropy(secret_value))
        special_chars = "!#$%&()*+,-./:;<=>?@[\\]^_`{|}~"
        features.append(1 if any(c in special_chars for c in secret_value) else 0)
        features.append(1 if any(c.isdigit() for c in secret_value) else 0)
        features.append(1 if any(c.isupper() for c in secret_value) else 0)
        features.append(1 if any(c.islower() for c in secret_value) else 0)

        # Unique chars and patterns
        features.append(len(set(secret_value)) / len(secret_value) if secret_value else 0)
        features.append(1 if secret_value.startswith(('sk-', 'pk_', 'AKIAI', 'ghp_', 'xox', 'Bearer ', 'Token ')) else 0)
        features.append(1 if self._is_base64(secret_value) else 0)
        features.append(1 if self._is_hex(secret_value) else 0)

        # Enhanced context analysis
        features.append(self._analyze_context_risk(context))
        features.append(1 if '"' in context or "'" in context or '`' in context else 0)
        features.append(sum(1 for kw in ['const', 'let', 'var', 'process.env', 'config', 'secret', 'key', 'token', 'auth'] if kw in context.lower()))

        # Variable name score
        features.append(self._score_variable_name(variable_name))

        # Additional advanced features
        features.append(self._detect_common_secret_patterns(secret_value))
        features.append(self._analyze_secret_structure(secret_value))
        features.append(self._check_entropy_distribution(secret_value))
        features.append(self._detect_api_key_patterns(secret_value))
        features.append(self._analyze_context_keywords(context))

        return np.array(features)

    def _detect_common_secret_patterns(self, secret: str) -> float:
        """Detect common secret patterns and return confidence score."""
        patterns = [
            r'sk-[a-zA-Z0-9]{20,}',  # Stripe keys
            r'AKIAI[a-zA-Z0-9]{16}',  # AWS keys
            r'ghp_[a-zA-Z0-9]{36}',   # GitHub tokens
            r'xox[baprs]-[a-zA-Z0-9-]+',  # Slack tokens
            r'[a-f0-9]{32}',  # MD5 hashes
            r'[a-f0-9]{40}',  # SHA1 hashes
            r'[a-f0-9]{64}',  # SHA256 hashes
        ]

        import re
        for pattern in patterns:
            if re.match(pattern, secret):
                return 1.0
        return 0.0

    def _analyze_secret_structure(self, secret: str) -> float:
        """Analyze the structural properties of the secret."""
        if not secret:
            return 0.0

        # Check for structured patterns
        structure_score = 0.0

        # Alternating patterns (common in API keys)
        if len(secret) > 10:
            alternating = sum(1 for i in range(len(secret)-1)
                            if (secret[i].isalpha() and secret[i+1].isdigit()) or
                               (secret[i].isdigit() and secret[i+1].isalpha()))
            structure_score += min(1.0, alternating / (len(secret) * 0.3))

        # Check for separators
        separators = ['-', '_', '.']
        sep_count = sum(1 for sep in separators if sep in secret)
        structure_score += min(1.0, sep_count * 0.3)

        # Length-based scoring
        if 20 <= len(secret) <= 100:
            structure_score += 0.3
        elif len(secret) > 100:
            structure_score += 0.1

        return min(1.0, structure_score)

    def _check_entropy_distribution(self, secret: str) -> float:
        """Check entropy distribution for randomness."""
        if len(secret) < 8:
            return 0.0

        # Calculate local entropy in windows
        window_size = min(8, len(secret))
        entropies = []

        for i in range(len(secret) - window_size + 1):
            window = secret[i:i+window_size]
            entropy = self._calculate_entropy(window)
            entropies.append(entropy)

        if not entropies:
            return 0.0

        # High entropy variation suggests structured randomness
        entropy_std = np.std(entropies)
        entropy_mean = np.mean(entropies)

        # Score based on entropy consistency and level
        consistency_score = 1.0 - min(1.0, entropy_std / 2.0)  # Lower std is better
        level_score = min(1.0, entropy_mean / 4.0)  # Higher entropy is better

        return (consistency_score + level_score) / 2.0

    def _detect_api_key_patterns(self, secret: str) -> float:
        """Detect API key specific patterns."""
        if not secret or len(secret) < 10:
            return 0.0

        pattern_score = 0.0

        # Service-specific prefixes
        prefixes = {
            'sk-': 1.0, 'pk-': 1.0, 'AKIAI': 1.0, 'ghp_': 1.0, 'xox': 1.0,
            'Bearer ': 0.8, 'Token ': 0.8, 'apikey': 0.6, 'secret': 0.6
        }

        for prefix, score in prefixes.items():
            if secret.lower().startswith(prefix.lower()):
                pattern_score = max(pattern_score, score)

        # Suffix patterns
        if secret.endswith(('=', '==')):
            pattern_score = max(pattern_score, 0.7)  # Base64-like

        # Character distribution patterns
        alpha_count = sum(1 for c in secret if c.isalpha())
        digit_count = sum(1 for c in secret if c.isdigit())
        special_count = len(secret) - alpha_count - digit_count

        # Balanced distribution often indicates API keys
        total = len(secret)
        if total > 0:
            alpha_ratio = alpha_count / total
            digit_ratio = digit_count / total
            special_ratio = special_count / total

            # Good balance of alphanumeric characters
            if 0.3 <= alpha_ratio <= 0.8 and 0.1 <= digit_ratio <= 0.6:
                pattern_score = max(pattern_score, 0.4)

        return pattern_score

    def _analyze_context_keywords(self, context: str) -> float:
        """Analyze context for security-related keywords."""
        if not context:
            return 0.0

        # Expanded keyword lists with weights
        high_risk_keywords = ['password', 'secret', 'key', 'token', 'auth', 'credential']
        medium_risk_keywords = ['config', 'env', 'api', 'access', 'private', 'secure']
        low_risk_keywords = ['const', 'let', 'var', 'export', 'process.env']

        context_lower = context.lower()
        score = 0.0

        # High risk keywords
        for keyword in high_risk_keywords:
            if keyword in context_lower:
                score += 0.3

        # Medium risk keywords
        for keyword in medium_risk_keywords:
            if keyword in context_lower:
                score += 0.15

        # Low risk keywords (assignment patterns)
        for keyword in low_risk_keywords:
            if keyword in context_lower:
                score += 0.05

        # Bonus for quotes (common in assignments)
        if '"' in context or "'" in context or '`' in context:
            score += 0.1

        # Bonus for equals signs (assignments)
        if '=' in context:
            score += 0.1

        return min(1.0, score)

    # Model versioning and A/B testing methods
    def create_model_version(self, version_name: str) -> bool:
        """Create a new model version by copying current model."""
        try:
            if version_name in self.model_versions:
                return False  # Version already exists

            # Create a copy of current model
            versioned_model = CustomLLM(self.config)
            # Copy weights (simplified - in practice would deep copy)
            versioned_model.token_embedding = self.model.token_embedding.copy()
            versioned_model.feature_embedding = self.model.feature_embedding.copy()
            versioned_model.pos_encoding = self.model.pos_encoding.copy()
            versioned_model.classifier = self.model.classifier.copy()
            versioned_model.classifier_bias = self.model.classifier_bias.copy()
            versioned_model.layers = self.model.layers.copy()  # Shallow copy for now

            self.model_versions[version_name] = versioned_model
            self.version_performance[version_name] = {
                'total_predictions': 0,
                'correct_predictions': 0,
                'accuracy': 0.0,
                'created_at': 'now'
            }

            return True
        except Exception as e:
            print(f"Error creating model version: {e}")
            return False

    def switch_model_version(self, version_name: str) -> bool:
        """Switch to a different model version."""
        if version_name not in self.model_versions and version_name != "default":
            return False

        if version_name == "default":
            self.active_version = "default"
            # Default model is already loaded
        else:
            self.active_version = version_name
            self.model = self.model_versions[version_name]

        # Clear cache when switching versions
        self.analysis_cache = {}
        self.cache_hits = 0
        self.cache_misses = 0

        return True

    def enable_ab_testing(self, version_a: str = "default", version_b: str = "default") -> bool:
        """Enable A/B testing between two model versions."""
        if version_a not in self.model_versions and version_a != "default":
            return False
        if version_b not in self.model_versions and version_b != "default":
            return False

        self.ab_testing_enabled = True
        self.ab_test_groups = {"A": version_a, "B": version_b}
        return True

    def disable_ab_testing(self):
        """Disable A/B testing and use default model."""
        self.ab_testing_enabled = False
        self.switch_model_version("default")

    def get_ab_test_results(self) -> Dict[str, Any]:
        """Get A/B testing performance results."""
        if not self.ab_testing_enabled:
            return {"error": "A/B testing not enabled"}

        results = {}
        for group, version in self.ab_test_groups.items():
            if version in self.version_performance:
                results[group] = {
                    'version': version,
                    'performance': self.version_performance[version]
                }
            else:
                results[group] = {
                    'version': version,
                    'performance': {'total_predictions': 0, 'accuracy': 0.0}
                }

        # Determine winner
        perf_a = results['A']['performance']
        perf_b = results['B']['performance']

        if perf_a['total_predictions'] > 10 and perf_b['total_predictions'] > 10:
            if perf_a['accuracy'] > perf_b['accuracy']:
                winner = 'A'
            elif perf_b['accuracy'] > perf_a['accuracy']:
                winner = 'B'
            else:
                winner = 'tie'
        else:
            winner = 'insufficient_data'

        results['winner'] = winner
        results['recommendation'] = self.ab_test_groups[winner] if winner in ['A', 'B'] else None

        return results

    def record_prediction_result(self, version: str, correct: bool):
        """Record prediction result for performance tracking."""
        if version not in self.version_performance:
            self.version_performance[version] = {
                'total_predictions': 0,
                'correct_predictions': 0,
                'accuracy': 0.0
            }

        perf = self.version_performance[version]
        perf['total_predictions'] += 1
        if correct:
            perf['correct_predictions'] += 1

        perf['accuracy'] = perf['correct_predictions'] / perf['total_predictions']

    def get_model_version_info(self) -> Dict[str, Any]:
        """Get information about all model versions."""
        versions_info = {
            'active_version': self.active_version,
            'ab_testing_enabled': self.ab_testing_enabled,
            'versions': {}
        }

        # Add default version
        versions_info['versions']['default'] = {
            'exists': True,
            'performance': self.version_performance.get('default', {'total_predictions': 0, 'accuracy': 0.0})
        }

        # Add other versions
        for version_name, model in self.model_versions.items():
            versions_info['versions'][version_name] = {
                'exists': True,
                'performance': self.version_performance.get(version_name, {'total_predictions': 0, 'accuracy': 0.0})
            }

        return versions_info

    def _calculate_entropy(self, text: str) -> float:
        """Calculate Shannon entropy."""
        if not text:
            return 0.0
        freq = {}
        for c in text:
            freq[c] = freq.get(c, 0) + 1
        entropy = 0
        for count in freq.values():
            p = count / len(text)
            entropy -= p * math.log2(p)
        return entropy

    def _is_base64(self, text: str) -> bool:
        """Check if looks like base64."""
        import string
        base64_chars = string.ascii_letters + string.digits + '+/='
        return len(text) % 4 == 0 and all(c in base64_chars for c in text)

    def _is_hex(self, text: str) -> bool:
        """Check if looks like hex."""
        import string
        return len(text) >= 32 and all(c in string.hexdigits for c in text)

    def _analyze_context_risk(self, context: str) -> float:
        """Analyze context risk."""
        risk = 0.0
        keywords = ['auth', 'key', 'secret', 'token', 'password']
        for kw in keywords:
            if kw in context.lower():
                risk += 0.2
        return min(1.0, risk)

    def _score_variable_name(self, name: Optional[str]) -> float:
        """Score variable name."""
        if not name:
            return 0.0
        if name.upper() == name:
            return 0.8
        if any(word in name.lower() for word in ['secret', 'key', 'token']):
            return 0.6
        return 0.2

    def _warm_cache(self):
        """Pre-warm cache with common patterns to improve cold start performance."""
        try:
            # Common test patterns that are frequently analyzed
            common_patterns = [
                ("sk-1234567890abcdef", "const apiKey = \"sk-1234567890abcdef\";", "apiKey"),
                ("AKIAIOSFODNN7EXAMPLE", "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE", "AWS_ACCESS_KEY_ID"),
                ("ghp_abcd1234efgh5678", "GITHUB_TOKEN=ghp_abcd1234efgh5678", "GITHUB_TOKEN"),
                ("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "auth_header"),
                ("some-random-string", "const value = \"some-random-string\";", "value"),
            ]

            warmed_count = 0
            for secret, context, var_name in common_patterns:
                try:
                    # This will populate the cache
                    self.calculate_enhanced_confidence(secret, context, "low", var_name)
                    warmed_count += 1
                except Exception as e:
                    print(f"Cache warming failed for pattern: {e}")

            print(f"Cache warmed with {warmed_count} common patterns")

        except Exception as e:
            print(f"Cache warming failed: {e}")

    def _categorize_secret(self, secret_value: str) -> str:
        """Categorize secret based on pattern analysis."""
        import re
        if re.match(r'^(sk|pk)[_-]', secret_value): return 'API Key'
        if re.match(r'^(AKIAI|AKIAIOS)', secret_value): return 'AWS API Key'
        if re.match(r'^ghp_', secret_value): return 'GitHub Token'
        if re.match(r'^xox[bap]-', secret_value): return 'Slack Token'
        if re.match(r'^SG\.', secret_value): return 'SendGrid API Key'
        if re.match(r'^(mysql|postgresql|mongodb|redis):\/\/', secret_value): return 'Database URL'
        if re.match(r'^Bearer\s+', secret_value): return 'Bearer Token'
        if re.match(r'-----BEGIN', secret_value): return 'Certificate/Private Key'
        if len(secret_value) >= 64: return 'Cryptographic Key'
        return 'Potential Secret'

    def _assess_risk_level(self, secret_value: str, context: str) -> str:
        """Assess risk level based on secret type and context."""
        context_lower = context.lower()
        if 'authorization' in context_lower or 'bearer' in context_lower:
            return 'critical'
        if 'stripe' in context_lower or 'payment' in context_lower:
            return 'high'
        if 'aws' in context_lower or 'cloud' in context_lower:
            return 'high'
        if 'api' in context_lower or 'key' in context_lower or 'token' in context_lower:
            return 'medium'
        return 'low'


# Global analyzer instance
analyzer = LLMAnalyzer()

# Security utilities
class SecurityManager:
    """Handles authentication, authorization, and security operations."""

    def __init__(self):
        self.api_keys = set()
        self.jwt_secret = os.getenv('JWT_SECRET', 'default-jwt-secret-change-in-production')
        self.rate_limits = {}  # IP-based rate limiting
        self.max_requests_per_minute = int(os.getenv('RATE_LIMIT_REQUESTS_PER_MINUTE', '60'))

    def load_api_keys(self):
        """Load API keys from environment."""
        api_key_env = os.getenv('API_KEY', '')
        if api_key_env:
            # Support comma-separated keys
            self.api_keys = set(key.strip() for key in api_key_env.split(',') if key.strip())

    def verify_api_key(self, api_key: str) -> bool:
        """Verify API key."""
        return api_key in self.api_keys

    def generate_jwt_token(self, username: str, expires_delta: timedelta = None) -> str:
        """Generate JWT token."""
        if expires_delta is None:
            expires_delta = timedelta(hours=1)

        expire = datetime.utcnow() + expires_delta
        to_encode = {
            "sub": username,
            "exp": expire,
            "iat": datetime.utcnow(),
            "type": "access"
        }

        encoded_jwt = jwt.encode(to_encode, self.jwt_secret, algorithm="HS256")
        return encoded_jwt

    def verify_jwt_token(self, token: str) -> Optional[dict]:
        """Verify JWT token."""
        try:
            payload = jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
            return payload
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None

    def check_rate_limit(self, client_ip: str) -> bool:
        """Check if client is within rate limits."""
        current_time = datetime.utcnow()
        minute_key = current_time.strftime("%Y-%m-%d %H:%M")

        if client_ip not in self.rate_limits:
            self.rate_limits[client_ip] = {}

        client_limits = self.rate_limits[client_ip]

        # Clean old entries
        current_minute = current_time.replace(second=0, microsecond=0)
        cutoff_time = current_minute - timedelta(minutes=1)

        client_limits_copy = client_limits.copy()
        for timestamp_str, count in client_limits_copy.items():
            timestamp = datetime.fromisoformat(timestamp_str)
            if timestamp < cutoff_time:
                del client_limits[timestamp_str]

        # Check current minute
        if minute_key not in client_limits:
            client_limits[minute_key] = 0

        if client_limits[minute_key] >= self.max_requests_per_minute:
            return False  # Rate limit exceeded

        client_limits[minute_key] += 1
        return True

    def hash_password(self, password: str) -> str:
        """Hash password using SHA-256."""
        return hashlib.sha256(password.encode()).hexdigest()

    def verify_password(self, password: str, hashed: str) -> bool:
        """Verify password against hash."""
        return hmac.compare_digest(self.hash_password(password), hashed)

# Global security manager
security_manager = SecurityManager()

# Authentication dependencies
security_scheme = HTTPBearer(auto_error=False)

async def get_api_key(credentials: HTTPAuthorizationCredentials = Depends(security_scheme)):
    """Extract and verify API key from request."""
    if not credentials:
        # Check X-API-KEY header
        from fastapi import Header
        api_key = Header(None, alias="X-API-KEY")
        if api_key and security_manager.verify_api_key(api_key):
            return api_key
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required"
        )

    # Check Bearer token
    if credentials.scheme.lower() == "bearer":
        # Try as JWT first
        payload = security_manager.verify_jwt_token(credentials.credentials)
        if payload:
            return payload

        # Try as API key
        if security_manager.verify_api_key(credentials.credentials):
            return credentials.credentials

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials"
    )

async def check_rate_limit(request: Request):
    """Check rate limiting for the client."""
    client_ip = request.client.host if request.client else "unknown"

    if not security_manager.check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later."
        )

    return True

# FastAPI app setup with security
app = FastAPI(
    title="LLM Secret Detection Service",
    description="AI-powered secret detection for development workflows",
    version="1.0.0",
    docs_url="/docs" if os.getenv('ENVIRONMENT') != 'production' else None,  # Disable docs in production
    redoc_url="/redoc" if os.getenv('ENVIRONMENT') != 'production' else None
)

# Security middleware
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"] if os.getenv('ENVIRONMENT') == 'development' else ["your-domain.com"]  # Restrict in production
)

# CORS middleware with environment-based configuration
cors_origins = os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://localhost:8080')
cors_origins_list = [origin.strip() for origin in cors_origins.split(',') if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,  # 24 hours
)

@app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Depends(get_api_key), Depends(check_rate_limit)])
def analyze_secret(request: AnalyzeRequest, request_obj: Request):
    """Analyze secret using LLM and return a full scoring object."""
    start_time = datetime.utcnow()
    request_id = secrets.token_hex(8)
    client_ip = request_obj.client.host if request_obj.client else "unknown"
    user_agent = request_obj.headers.get("user-agent", "")

    try:
        # Use the cached calculate_enhanced_confidence method
        confidence_level = analyzer.calculate_enhanced_confidence(
            request.secret_value,
            request.context,
            "low",  # Default fallback confidence
            request.variable_name
        )

        # Get additional analysis data
        entropy = analyzer._calculate_entropy(request.secret_value)
        category = analyzer._categorize_secret(request.secret_value)
        risk = analyzer._assess_risk_level(request.secret_value, request.context)

        # Determine if likely secret based on confidence and entropy
        is_likely = (confidence_level != 'low') or (entropy > 3.5)

        # Build reasoning based on cache usage
        reasoning = [f"Enhanced confidence: {confidence_level}", f"Entropy: {entropy:.2f}"]

        # Add cache info to reasoning if available
        total_requests = analyzer.cache_hits + analyzer.cache_misses
        if total_requests > 0:
            hit_rate = analyzer.cache_hits / total_requests
            reasoning.append(f"Cache hit rate: {hit_rate:.1%}")

        # Calculate processing time
        processing_time_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        # Store analytics data asynchronously (don't block response)
        try:
            # Hash API key for privacy
            api_key_hash = hashlib.sha256(str(request_obj.state.api_key).encode()).hexdigest() if hasattr(request_obj.state, 'api_key') else ""

            # Determine if this was a cache hit
            cache_hit = total_requests > 0 and analyzer.cache_hits > 0

            # Store in database (async - don't wait)
            db_manager.store_analysis_request(
                request_id=request_id,
                client_ip=client_ip,
                user_agent=user_agent,
                secret_type=category,
                risk_level=risk,
                confidence=float(confidence_level == 'high') if confidence_level in ['high', 'medium', 'low'] else 0.5,
                processing_time_ms=processing_time_ms,
                cache_hit=cache_hit,
                api_key_hash=api_key_hash
            )
        except Exception as db_error:
            print(f"Analytics storage failed: {db_error}")  # Don't fail the request

        return AnalyzeResponse(
            enhanced_confidence=confidence_level,
            method="llm_hybrid",
            is_likely_secret=is_likely,
            category=category,
            risk_level=risk,
            reasoning=reasoning,
            request_id=request_id
        )

    except Exception as e:
        # Still store failed requests for analytics
        try:
            processing_time_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            db_manager.store_analysis_request(
                request_id=request_id,
                client_ip=client_ip,
                user_agent=user_agent,
                secret_type="error",
                risk_level="unknown",
                confidence=0.0,
                processing_time_ms=processing_time_ms,
                cache_hit=False,
                api_key_hash=""
            )
        except:
            pass  # Ignore analytics errors

        return AnalyzeResponse(
            enhanced_confidence="low",
            method="error",
            is_likely_secret=False,
            category="Unknown",
            risk_level="low",
            reasoning=[f"Server Error: {str(e)}"],
            request_id=request_id
        )

@app.get("/health")
def health():
    """Basic health check - no authentication required."""
    return {
        "status": "ok",
        "llm_ready": True,
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

@app.get("/health/detailed")
def detailed_health():
    """Detailed health check with all system components."""
    return get_detailed_health()

@app.get("/readiness")
def readiness():
    """Kubernetes readiness probe - checks if service can accept traffic."""
    return check_readiness()

@app.get("/liveness")
def liveness():
    """Kubernetes liveness probe - checks if service should be restarted."""
    return check_liveness()

@app.get("/metrics")
def metrics():
    """Prometheus metrics endpoint."""
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )

@app.get("/performance/report")
def performance_report():
    """Get comprehensive performance report."""
    return get_performance_report()

@app.post("/performance/optimize")
def optimize_performance():
    """Trigger memory optimization."""
    optimize_memory()
    return {"status": "optimized", "message": "Memory optimization completed"}

@app.get("/performance/bottlenecks")
def detect_bottlenecks():
    """Detect performance bottlenecks."""
    issues = detect_performance_bottlenecks()
    return {
        "bottlenecks_detected": len(issues),
        "issues": issues,
        "recommendations": [
            "Consider increasing memory limits" if any("memory" in issue.lower() for issue in issues) else None,
            "Consider optimizing database queries" if any("response time" in issue.lower() for issue in issues) else None,
            "Consider horizontal scaling" if any("thread" in issue.lower() for issue in issues) else None,
        ]
    }

@app.post("/auth/login", response_model=TokenResponse)
def login(credentials: UserCredentials):
    """Authenticate user and return JWT token."""
    # This is a simplified example - in production you'd verify against a database
    # For now, accept any username/password combination
    if not credentials.username or not credentials.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password required"
        )

    # Generate JWT token
    access_token = security_manager.generate_jwt_token(credentials.username)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=3600  # 1 hour
    )

@app.post("/train", dependencies=[Depends(get_api_key), Depends(check_rate_limit)])
def train_model(request: TrainingSample, request_obj: Request):
    """Train the model with user feedback - server calculates its own features for consistency."""
    try:
        # --- 🚀 SMART FIX: SINGLE SOURCE OF TRUTH ---
        # 1. Server calculates its own features, ignoring client features
        #    (This ensures features are *always* consistent and up-to-date)
        features_vector = analyzer.extract_features(
            request.secret_value,
            request.context,
            request.variable_name
        )
        features_list = features_vector.tolist()
        # --- END OF SMART FIX ---

        # Store training sample in database for persistence
        secret_hash = hashlib.sha256(request.secret_value.encode()).hexdigest()
        context_hash = hashlib.sha256(request.context.encode()).hexdigest()

        db_manager.store_training_sample(
            secret_hash=secret_hash,
            context_hash=context_hash,
            features=features_list,
            label=request.label,
            user_action=request.user_action,
            confidence=0.5,  # Default confidence for training samples
            model_version=analyzer.active_version
        )

        # 2. Add training sample to the model using server-calculated features
        analyzer.model.add_training_sample(
            request.secret_value,
            features_list,  # Always use server-calculated features
            request.label
        )

        # 3. Perform training if we have enough samples
        if len(analyzer.model.training_samples) >= 5:  # Train every 5 samples
            training_samples = analyzer.model.training_samples[-10:]  # Use last 10 samples
            result = analyzer.model.train(training_samples, epochs=1)

            # Save updated model
            analyzer.save_model()

            return {
                "status": "trained",
                "samples_processed": result.get('samples_processed', 0),
                "average_loss": result.get('average_loss', 0.0),
                "model_updated": True,
                "features_calculated": len(features_list),  # Show feature count for transparency
                "training_samples_stored": True
            }
        else:
            return {
                "status": "sample_added",
                "total_samples": len(analyzer.model.training_samples),
                "message": "Training sample added. Training will occur when 5+ samples are available.",
                "features_calculated": len(features_list),  # Show feature count for transparency
                "training_samples_stored": True
            }

    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }

@app.post("/reset")
def reset_model():
    """Reset model to initial state."""
    try:
        # Reset model weights
        analyzer.model = CustomLLM(analyzer.config)
        analyzer.analysis_cache = {}  # Clear cache
        analyzer.cache_hits = 0
        analyzer.cache_misses = 0
        analyzer.save_model()
        return {"status": "reset", "message": "Model reset to initial state"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/stats")
def get_stats():
    """Get comprehensive model, cache, database, and performance statistics."""
    try:
        model_stats = analyzer.model.get_model_stats()
        training_stats = analyzer.model.get_training_stats()

        # Cache statistics
        cache_hit_rate = 0.0
        total_requests = analyzer.cache_hits + analyzer.cache_misses
        if total_requests > 0:
            cache_hit_rate = analyzer.cache_hits / total_requests

        redis_stats = redis_cache.get_cache_stats()

        # Database analytics (last 7 days)
        analytics_summary = db_manager.get_analytics_summary(days=7)

        return {
            "model": model_stats,
            "training": training_stats,
            "cache": {
                "redis_status": redis_stats.get("status", "unknown"),
                "cache_hit_rate": cache_hit_rate,
                "total_cache_requests": total_requests,
                "cache_hits": analyzer.cache_hits,
                "cache_misses": analyzer.cache_misses,
                "redis_keys": redis_stats.get("total_keys", 0),
                "redis_memory": redis_stats.get("memory_used", "unknown")
            },
            "database": {
                "analytics_summary": analytics_summary,
                "training_samples_count": len(db_manager.get_training_samples(limit=1000)) if db_manager else 0
            },
            "performance": {
                "uptime": "unknown",  # Would need process start time tracking
                "active_connections": "unknown",  # Would need connection tracking
                "average_response_time": analytics_summary.get("average_processing_time_ms", 0)
            },
            "service": {
                "status": "active",
                "version": "1.0.0",
                "environment": os.getenv('ENVIRONMENT', 'development'),
                "model_version": analyzer.active_version,
                "ab_testing_enabled": analyzer.ab_testing_enabled
            }
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

# Cache management endpoints
@app.post("/cache/clear")
def clear_cache():
    """Clear all cached analysis results."""
    try:
        # Clear Redis cache
        cleared_count = redis_cache.clear_pattern("*")
        return {
            "status": "cleared",
            "redis_keys_cleared": cleared_count,
            "message": f"Cleared {cleared_count} cached entries"
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/cache/stats")
def get_cache_stats():
    """Get detailed cache statistics."""
    try:
        redis_stats = redis_cache.get_cache_stats()
        cache_hit_rate = 0.0
        total_requests = analyzer.cache_hits + analyzer.cache_misses
        if total_requests > 0:
            cache_hit_rate = analyzer.cache_hits / total_requests

        return {
            "redis": redis_stats,
            "application": {
                "cache_hits": analyzer.cache_hits,
                "cache_misses": analyzer.cache_misses,
                "hit_rate": cache_hit_rate,
                "total_requests": total_requests
            }
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

# Database management endpoints
@app.get("/analytics/summary")
def get_analytics_summary(days: int = 7):
    """Get analytics summary for specified number of days."""
    try:
        summary = db_manager.get_analytics_summary(days=days)
        return summary
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/database/cleanup")
def cleanup_database(days_to_keep: int = 90):
    """Clean up old database records."""
    try:
        success = db_manager.cleanup_old_data(days_to_keep=days_to_keep)
        if success:
            return {"status": "cleaned", "message": f"Cleaned up data older than {days_to_keep} days"}
        else:
            return {"status": "error", "message": "Cleanup failed"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/database/training-samples")
def get_training_samples(limit: int = 100, model_version: str = None):
    """Get stored training samples."""
    try:
        samples = db_manager.get_training_samples(limit=limit, model_version=model_version)
        return {
            "samples": samples,
            "count": len(samples),
            "limit": limit,
            "model_version": model_version
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}

# Model versioning endpoints
@app.post("/versions/create")
def create_model_version(version_name: str):
    """Create a new model version."""
    try:
        success = analyzer.create_model_version(version_name)
        if success:
            return {"status": "created", "version": version_name}
        else:
            return {"status": "error", "message": f"Version '{version_name}' already exists"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/versions/switch")
def switch_model_version(version_name: str):
    """Switch to a different model version."""
    try:
        success = analyzer.switch_model_version(version_name)
        if success:
            return {"status": "switched", "active_version": version_name}
        else:
            return {"status": "error", "message": f"Version '{version_name}' not found"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/versions")
def get_model_versions():
    """Get information about all model versions."""
    try:
        return analyzer.get_model_version_info()
    except Exception as e:
        return {"status": "error", "error": str(e)}

# A/B testing endpoints
@app.post("/ab/enable")
def enable_ab_testing(version_a: str = "default", version_b: str = "default"):
    """Enable A/B testing between two model versions."""
    try:
        success = analyzer.enable_ab_testing(version_a, version_b)
        if success:
            return {
                "status": "enabled",
                "group_a": version_a,
                "group_b": version_b
            }
        else:
            return {"status": "error", "message": "Invalid version names"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/ab/disable")
def disable_ab_testing():
    """Disable A/B testing."""
    try:
        analyzer.disable_ab_testing()
        return {"status": "disabled", "active_version": "default"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.get("/ab/results")
def get_ab_test_results():
    """Get A/B testing results."""
    try:
        return analyzer.get_ab_test_results()
    except Exception as e:
        return {"status": "error", "error": str(e)}

@app.post("/ab/record")
def record_prediction_result(version: str, correct: bool):
    """Record prediction result for A/B testing."""
    try:
        analyzer.record_prediction_result(version, correct)
        return {"status": "recorded", "version": version, "correct": correct}
    except Exception as e:
        return {"status": "error", "error": str(e)}

# Startup event to initialize security and performance monitoring
@app.on_event("startup")
async def startup_event():
    """Initialize security manager, performance monitoring, and load configuration."""
    # Initialize security
    security_manager.load_api_keys()
    print("🔐 Security manager initialized")
    print(f"📊 Loaded {len(security_manager.api_keys)} API keys")
    print(f"⚡ Rate limit: {security_manager.max_requests_per_minute} requests/minute")

    # Start performance monitoring
    start_performance_monitoring()
    print("📈 Performance monitoring started")

    # Optimize database on startup
    try:
        db_manager.optimize_database()
        print("🗄️ Database optimization completed")
    except Exception as e:
        print(f"⚠️ Database optimization failed: {e}")

    # Pre-warm cache with common patterns
    try:
        analyzer._warm_cache()
        print("🔥 Cache warming completed")
    except Exception as e:
        print(f"⚠️ Cache warming failed: {e}")

# Shutdown event for cleanup
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    print("🛑 Shutting down LLM service...")
    analyzer.save_model()  # Save model state
    print("💾 Model state saved")

# Monitoring and security middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

class MonitoringMiddleware(BaseHTTPMiddleware):
    """Middleware for request monitoring, logging, and metrics."""

    async def dispatch(self, request, call_next):
        start_time = time.time()
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "")

        # Extract request details
        method = request.method
        path = request.url.path

        try:
            # Process the request
            response = await call_next(request)

            # Calculate response time
            process_time = time.time() - start_time
            response_time_ms = int(process_time * 1000)

            # Record metrics
            record_http_request(method, path, response.status_code, process_time)

            # Log request (only for non-health endpoints to avoid spam)
            if path not in ["/health", "/metrics", "/readiness", "/liveness"]:
                log_request(
                    request_id=getattr(request.state, 'request_id', 'unknown'),
                    method=method,
                    path=path,
                    status_code=response.status_code,
                    duration_ms=response_time_ms,
                    client_ip=client_ip,
                    user_agent=user_agent
                )

            return response

        except Exception as e:
            # Record failed request metrics
            process_time = time.time() - start_time
            record_http_request(method, path, 500, process_time)

            # Log error
            log_security_event(
                "request_error",
                client_ip,
                {"method": method, "path": path, "error": str(e)}
            )

            raise

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)

        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        # Remove server header for security
        if "server" in response.headers:
            del response.headers["server"]

        return response

# Add middleware in correct order
app.add_middleware(MonitoringMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
