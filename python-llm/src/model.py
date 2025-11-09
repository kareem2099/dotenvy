"""
Custom LLM Model Implementation
==============================

Lightweight transformer-based model for secret detection.
Implements a custom transformer architecture optimized for classification.
"""

import numpy as np
import json
import os
from typing import Dict, Any, Optional, List
from .attention import CustomAttention


class ModelConfig:
    """Configuration for the CustomLLM model."""

    def __init__(self):
        self.vocab_size = 1000  # Token vocabulary size
        self.hidden_dim = 128   # Hidden dimension
        self.num_layers = 2     # Number of transformer layers
        self.num_heads = 4      # Number of attention heads
        self.max_seq_len = 50   # Maximum sequence length
        self.num_classes = 4    # Number of output classes (high, medium, low, false_positive)
        self.dropout = 0.1      # Dropout rate


class FeedForwardNetwork:
    """Feed-forward network with layer normalization."""

    def __init__(self, hidden_dim: int, ff_dim: Optional[int] = None):
        if ff_dim is None:
            ff_dim = hidden_dim * 4

        self.hidden_dim = hidden_dim
        self.ff_dim = ff_dim

        # Initialize weights
        self.w1 = np.random.randn(hidden_dim, ff_dim) * 0.02
        self.b1 = np.zeros(ff_dim)
        self.w2 = np.random.randn(ff_dim, hidden_dim) * 0.02
        self.b2 = np.zeros(hidden_dim)

        # Layer normalization parameters
        self.ln_weight = np.ones(hidden_dim)
        self.ln_bias = np.zeros(hidden_dim)

    def forward(self, x: np.ndarray) -> np.ndarray:
        """Forward pass through feed-forward network."""
        # Layer normalization
        mean = np.mean(x, axis=-1, keepdims=True)
        var = np.var(x, axis=-1, keepdims=True)
        x_norm = (x - mean) / np.sqrt(var + 1e-6)
        x_norm = x_norm * self.ln_weight + self.ln_bias

        # Feed-forward
        h = np.maximum(0, np.matmul(x_norm, self.w1) + self.b1)  # ReLU
        out = np.matmul(h, self.w2) + self.b2

        return out

    def get_weights(self) -> dict:
        """Get weights for serialization."""
        return {
            'w1': self.w1.tolist(),
            'b1': self.b1.tolist(),
            'w2': self.w2.tolist(),
            'b2': self.b2.tolist(),
            'ln_weight': self.ln_weight.tolist(),
            'ln_bias': self.ln_bias.tolist(),
            'hidden_dim': self.hidden_dim,
            'ff_dim': self.ff_dim
        }

    def set_weights(self, weights: dict):
        """Set weights from serialized data."""
        self.w1 = np.array(weights['w1'])
        self.b1 = np.array(weights['b1'])
        self.w2 = np.array(weights['w2'])
        self.b2 = np.array(weights['b2'])
        self.ln_weight = np.array(weights['ln_weight'])
        self.ln_bias = np.array(weights['ln_bias'])
        self.hidden_dim = weights['hidden_dim']
        self.ff_dim = weights['ff_dim']


class TransformerBlock:
    """Single transformer block with attention and feed-forward."""

    def __init__(self, config: ModelConfig):
        self.config = config
        self.attention = CustomAttention(config.hidden_dim, config.num_heads)
        self.ffn = FeedForwardNetwork(config.hidden_dim)

    def forward(self, x: np.ndarray, mask: Optional[np.ndarray] = None) -> np.ndarray:
        """Forward pass through transformer block."""
        # Multi-head attention with residual connection
        attn_out = self.attention.forward(x, x, x, mask)
        x = x + attn_out  # Residual connection

        # Feed-forward with residual connection
        ffn_out = self.ffn.forward(x)
        x = x + ffn_out  # Residual connection

        return x

    def get_weights(self) -> dict:
        """Get weights for serialization."""
        return {
            'attention': self.attention.get_weights(),
            'ffn': self.ffn.get_weights()
        }

    def set_weights(self, weights: dict):
        """Set weights from serialized data."""
        self.attention.set_weights(weights['attention'])
        self.ffn.set_weights(weights['ffn'])


class CustomLLM:
    """
    Custom transformer-based LLM for secret detection.
    Processes numerical features and text tokens for classification.
    """

    def __init__(self, config: ModelConfig):
        self.config = config

        # Embedding layers
        self.token_embedding = np.random.randn(config.vocab_size, config.hidden_dim) * 0.02
        self.feature_embedding = np.random.randn(19, config.hidden_dim) * 0.02  # 19 features (enhanced)

        # Positional encoding
        self.pos_encoding = self._create_positional_encoding()

        # Transformer layers
        self.layers = [TransformerBlock(config) for _ in range(config.num_layers)]

        # Classification head
        self.classifier = np.random.randn(config.hidden_dim, config.num_classes) * 0.02
        self.classifier_bias = np.zeros(config.num_classes)

        # Training state
        self.is_trained = False
        self.learning_rate = 0.001
        self.training_samples = []

        # Confidence calibration
        self.confidence_calibration = {}
        self.calibration_samples = []

    def _create_positional_encoding(self) -> np.ndarray:
        """Create sinusoidal positional encoding."""
        pos_enc = np.zeros((self.config.max_seq_len, self.config.hidden_dim))
        position = np.arange(0, self.config.max_seq_len, dtype=np.float32).reshape(-1, 1)
        div_term = np.exp(np.arange(0, self.config.hidden_dim, 2).astype(np.float32) *
                         -(np.log(10000.0) / self.config.hidden_dim))

        pos_enc[:, 0::2] = np.sin(position * div_term)
        pos_enc[:, 1::2] = np.cos(position * div_term)

        return pos_enc

    def _tokenize_secret(self, secret_value: str) -> List[int]:
        """Simple tokenization of secret value."""
        # For now, use character-level tokenization
        tokens = []
        for char in secret_value[:self.config.max_seq_len]:
            # Simple character to token mapping (0-255 for ASCII)
            token = ord(char) if ord(char) < self.config.vocab_size else 0
            tokens.append(token)
        return tokens

    def forward(self, secret_value: str, features: np.ndarray) -> Dict[str, Any]:
        """
        Forward pass through the model.

        Args:
            secret_value: The secret string to analyze
            features: Numerical features array (14 dimensions)

        Returns:
            Dictionary with prediction results
        """
        # Tokenize secret
        tokens = self._tokenize_secret(secret_value)
        seq_len = len(tokens)

        if seq_len == 0:
            return {'prediction': 'low', 'confidence': 0.0}

        # Create token embeddings
        token_embeds = self.token_embedding[tokens]  # [seq_len, hidden_dim]

        # Create feature embeddings and expand to sequence length
        feature_embeds = np.matmul(features.reshape(1, -1), self.feature_embedding)  # [1, hidden_dim]
        feature_embeds = np.tile(feature_embeds, (seq_len, 1))  # [seq_len, hidden_dim]

        # Combine token and feature embeddings
        x = token_embeds + feature_embeds + self.pos_encoding[:seq_len]

        # Add batch dimension
        x = x.reshape(1, seq_len, self.config.hidden_dim)

        # Create attention mask (no masking for now)
        mask = None

        # Pass through transformer layers
        for layer in self.layers:
            x = layer.forward(x, mask)

        # Global average pooling
        x = np.mean(x, axis=1)  # [1, hidden_dim]

        # Classification
        logits = np.matmul(x, self.classifier) + self.classifier_bias
        probs = self._softmax(logits[0])

        # Get prediction
        pred_idx = np.argmax(probs)
        confidence = float(probs[pred_idx])

        # Map to confidence levels
        labels = ['high', 'medium', 'low', 'false_positive']
        prediction = labels[pred_idx]

        return {
            'prediction': prediction,
            'confidence': confidence,
            'probabilities': probs.tolist()
        }

    def _softmax(self, x: np.ndarray) -> np.ndarray:
        """Compute softmax."""
        x_max = np.max(x)
        exp_x = np.exp(x - x_max)
        return exp_x / np.sum(exp_x)

    def train_step(self, secret_value: str, features: np.ndarray, target_label: str) -> float:
        """
        Perform one training step with backpropagation.

        Args:
            secret_value: The secret string
            features: Numerical features array
            target_label: Target confidence level ('high', 'medium', 'low', 'false_positive')

        Returns:
            Loss value for this training step
        """
        # Map label to index
        label_map = {'high': 0, 'medium': 1, 'low': 2, 'false_positive': 3}
        target_idx = label_map.get(target_label, 2)  # Default to 'low'

        # Forward pass
        result = self.forward(secret_value, features)
        probs = np.array(result['probabilities'])

        # Compute cross-entropy loss
        loss = -np.log(probs[target_idx] + 1e-8)

        # Simple gradient descent update (simplified backprop)
        # In a real implementation, you'd compute proper gradients
        self._simple_gradient_update(secret_value, features, target_idx, probs)

        return float(loss)

    def _simple_gradient_update(self, secret_value: str, features: np.ndarray, target_idx: int, probs: np.ndarray):
        """Simplified gradient update for demonstration."""
        # This is a very simplified update - in practice you'd use proper backprop
        tokens = self._tokenize_secret(secret_value)
        if not tokens:
            return

        # Update classifier weights based on prediction error
        pred_idx = np.argmax(probs)
        if pred_idx != target_idx:
            # Simple weight update to encourage correct classification
            update_factor = self.learning_rate * 0.1

            # Update classifier bias
            self.classifier_bias[target_idx] += update_factor
            self.classifier_bias[pred_idx] -= update_factor

            # Update classifier weights (simplified)
            grad = np.zeros_like(self.classifier)
            grad[:, target_idx] = update_factor
            grad[:, pred_idx] = -update_factor
            self.classifier += grad

    def train(self, training_samples: List[Dict[str, Any]], epochs: int = 1) -> Dict[str, Any]:
        """
        Train the model on a batch of samples.

        Args:
            training_samples: List of training samples with 'secret_value', 'features', 'label'
            epochs: Number of training epochs

        Returns:
            Training statistics
        """
        if not training_samples:
            return {'error': 'No training samples provided'}

        total_loss = 0.0
        num_samples = len(training_samples)

        for epoch in range(epochs):
            epoch_loss = 0.0

            for sample in training_samples:
                secret_value = sample.get('secret_value', '')
                features = np.array(sample.get('features', []))
                label = sample.get('label', 'low')

                if len(features) != 19:
                    continue  # Skip invalid samples

                loss = self.train_step(secret_value, features, label)
                epoch_loss += loss

            avg_epoch_loss = epoch_loss / max(1, num_samples)
            total_loss += avg_epoch_loss

            # Note: Training samples are already stored via add_training_sample()

        self.is_trained = True

        return {
            'epochs_trained': epochs,
            'average_loss': total_loss / epochs,
            'samples_processed': num_samples,
            'model_updated': True
        }

    def add_training_sample(self, secret_value: str, features: List[float], label: str):
        """
        Add a single training sample for future training.

        Args:
            secret_value: The secret string
            features: Numerical features (14 dimensions)
            label: Confidence label ('high', 'medium', 'low', 'false_positive')
        """
        self.training_samples.append({
            'secret_value': secret_value,
            'features': features,
            'label': label
        })

    def get_training_stats(self) -> Dict[str, Any]:
        """Get training statistics."""
        return {
            'is_trained': self.is_trained,
            'training_samples_count': len(self.training_samples),
            'learning_rate': self.learning_rate,
            'calibration_samples': len(self.calibration_samples)
        }

    def calibrate_confidence(self, predicted_confidence: float, true_label: str) -> float:
        """
        Calibrate confidence scores based on historical performance.

        Args:
            predicted_confidence: Raw confidence score from model
            true_label: Ground truth label

        Returns:
            Calibrated confidence score
        """
        # Simple calibration based on historical accuracy
        if true_label not in self.confidence_calibration:
            self.confidence_calibration[true_label] = []

        # Store calibration sample
        self.calibration_samples.append({
            'predicted_confidence': predicted_confidence,
            'true_label': true_label
        })

        # Update calibration stats
        self.confidence_calibration[true_label].append(predicted_confidence)

        # Simple calibration: adjust based on historical mean confidence
        if len(self.confidence_calibration[true_label]) > 5:
            historical_mean = np.mean(self.confidence_calibration[true_label])
            # Adjust confidence towards historical average
            calibrated = predicted_confidence * 0.7 + historical_mean * 0.3
            return min(1.0, max(0.0, calibrated))

        return predicted_confidence

    def get_calibration_stats(self) -> Dict[str, Any]:
        """Get confidence calibration statistics."""
        stats = {}
        for label, confidences in self.confidence_calibration.items():
            if confidences:
                stats[label] = {
                    'count': len(confidences),
                    'mean': float(np.mean(confidences)),
                    'std': float(np.std(confidences)),
                    'min': float(np.min(confidences)),
                    'max': float(np.max(confidences))
                }
        return stats

    def save_model(self, filepath: str):
        """Save model weights to JSON file."""
        model_data = {
            'config': {
                'vocab_size': self.config.vocab_size,
                'hidden_dim': self.config.hidden_dim,
                'num_layers': self.config.num_layers,
                'num_heads': self.config.num_heads,
                'max_seq_len': self.config.max_seq_len,
                'num_classes': self.config.num_classes,
                'dropout': self.config.dropout
            },
            'weights': {
                'token_embedding': self.token_embedding.tolist(),
                'feature_embedding': self.feature_embedding.tolist(),
                'pos_encoding': self.pos_encoding.tolist(),
                'classifier': self.classifier.tolist(),
                'classifier_bias': self.classifier_bias.tolist()
            },
            'layers': [layer.get_weights() for layer in self.layers],
            'is_trained': self.is_trained
        }

        with open(filepath, 'w') as f:
            json.dump(model_data, f, indent=2)

    def load_model(self, filepath: str):
        """Load model weights from JSON file."""
        if not os.path.exists(filepath):
            print(f"Model file {filepath} not found, using random initialization")
            return

        try:
            with open(filepath, 'r') as f:
                model_data = json.load(f)

            # Load config
            config_data = model_data['config']
            self.config.vocab_size = config_data['vocab_size']
            self.config.hidden_dim = config_data['hidden_dim']
            self.config.num_layers = config_data['num_layers']
            self.config.num_heads = config_data['num_heads']
            self.config.max_seq_len = config_data['max_seq_len']
            self.config.num_classes = config_data['num_classes']

            # Load weights
            weights = model_data['weights']
            self.token_embedding = np.array(weights['token_embedding'])
            self.feature_embedding = np.array(weights['feature_embedding'])
            self.pos_encoding = np.array(weights['pos_encoding'])
            self.classifier = np.array(weights['classifier'])
            self.classifier_bias = np.array(weights['classifier_bias'])

            # Load layers
            for i, layer_weights in enumerate(model_data['layers']):
                if i < len(self.layers):
                    self.layers[i].set_weights(layer_weights)

            self.is_trained = model_data.get('is_trained', False)
            print(f"Model loaded successfully from {filepath}")

        except Exception as e:
            print(f"Error loading model: {e}, using random initialization")

    def get_model_stats(self) -> Dict[str, Any]:
        """Get model statistics."""
        return {
            'vocab_size': self.config.vocab_size,
            'hidden_dim': self.config.hidden_dim,
            'num_layers': self.config.num_layers,
            'num_heads': self.config.num_heads,
            'is_trained': self.is_trained,
            'model_size_mb': self._estimate_model_size()
        }

    def _estimate_model_size(self) -> float:
        """Estimate model size in MB."""
        total_params = 0

        # Count parameters in embeddings
        total_params += self.token_embedding.size
        total_params += self.feature_embedding.size
        total_params += self.classifier.size
        total_params += self.classifier_bias.size

        # Count parameters in layers
        for layer in self.layers:
            # Attention parameters
            attn_weights = layer.attention.get_weights()
            for key, weight in attn_weights.items():
                if isinstance(weight, list):
                    total_params += len(weight) * len(weight[0]) if isinstance(weight[0], list) else len(weight)

            # FFN parameters
            ffn_weights = layer.ffn.get_weights()
            for key, weight in ffn_weights.items():
                if isinstance(weight, list):
                    total_params += len(weight) * len(weight[0]) if isinstance(weight[0], list) else len(weight)

        # Convert to MB (assuming float32 = 4 bytes)
        return (total_params * 4) / (1024 * 1024)
