"""
Custom LLM Service for VS Code Extension
========================================

Main service interface for the custom LLM, providing analysis
and training capabilities for secret detection.
"""

import os
import numpy as np
import json
from typing import List, Dict, Any, Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .model import CustomLLM, ModelConfig
from .attention import CustomAttention
import math

# API Models
class AnalyzeRequest(BaseModel):
    secret_value: str
    context: str
    variable_name: Optional[str] = None
    features: Optional[List[float]] = None

class TrainingSample(BaseModel):
    secret_value: str
    context: str
    features: List[float]
    user_action: str
    label: str

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
        Calculate enhanced confidence using LLM.
        """
        features = self.extract_features(secret_value, context, variable_name)
        result = self.model.forward(secret_value, features)

        # Map LLM prediction to confidence level
        if result['confidence'] > 0.8 or result['prediction'] == 'high':
            return "high"
        elif result['confidence'] > 0.6 or result['prediction'] == 'medium':
            return "medium"
        elif result['prediction'] == 'false_positive':
            return "low"
        else:
            return traditional_confidence

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
        """Feature extraction implementation."""
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
        features.append(1 if secret_value.startswith(('sk-', 'pk_', 'AKIAI', 'ghp_', 'xox')) else 0)
        features.append(1 if self._is_base64(secret_value) else 0)
        features.append(1 if self._is_hex(secret_value) else 0)

        # Context analysis
        features.append(self._analyze_context_risk(context))
        features.append(1 if '"' in context or "'" in context or '`' in context else 0)
        features.append(sum(1 for kw in ['const', 'let', 'process.env'] if kw in context))

        # Variable name score
        features.append(self._score_variable_name(variable_name))

        return np.array(features)

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


# Global analyzer instance
analyzer = LLMAnalyzer()

# FastAPI app setup
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/analyze")
def analyze_secret(request: AnalyzeRequest):
    """Analyze secret using LLM."""
    enhanced_confidence = analyzer.calculate_enhanced_confidence(
        request.secret_value,
        request.context,
        "medium",  # Default traditional confidence
        request.variable_name
    )

    return {
        "enhanced_confidence": enhanced_confidence,
        "method": "llm"
    }

@app.get("/health")
def health():
    """Health check."""
    return {"status": "ok", "llm_ready": True}
