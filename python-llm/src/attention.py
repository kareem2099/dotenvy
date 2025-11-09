"""
Custom Multi-Head Attention Implementation
==========================================

Lightweight attention mechanism for the custom LLM.
Implements scaled dot-product attention with multiple heads.
"""

import numpy as np
import math
from typing import Optional, Tuple


class CustomAttention:
    """
    Multi-head attention mechanism for transformer architecture.
    """

    def __init__(self, embed_dim: int, num_heads: int):
        """
        Initialize multi-head attention.

        Args:
            embed_dim: Total embedding dimension
            num_heads: Number of attention heads
        """
        assert embed_dim % num_heads == 0, "embed_dim must be divisible by num_heads"

        self.embed_dim = embed_dim
        self.num_heads = num_heads
        self.head_dim = embed_dim // num_heads

        # Initialize weights for query, key, value projections
        self.w_q = np.random.randn(embed_dim, embed_dim) * 0.02
        self.w_k = np.random.randn(embed_dim, embed_dim) * 0.02
        self.w_v = np.random.randn(embed_dim, embed_dim) * 0.02
        self.w_o = np.random.randn(embed_dim, embed_dim) * 0.02

    def forward(self, query: np.ndarray, key: np.ndarray, value: np.ndarray,
                mask: Optional[np.ndarray] = None) -> np.ndarray:
        """
        Forward pass through multi-head attention.

        Args:
            query: Query tensor [batch_size, seq_len, embed_dim]
            key: Key tensor [batch_size, seq_len, embed_dim]
            value: Value tensor [batch_size, seq_len, embed_dim]
            mask: Optional attention mask [batch_size, seq_len, seq_len]

        Returns:
            Output tensor [batch_size, seq_len, embed_dim]
        """
        batch_size, seq_len, _ = query.shape

        # Linear projections and reshape
        q = self._linear_projection(query, self.w_q)  # [batch, seq, embed]
        k = self._linear_projection(key, self.w_k)
        v = self._linear_projection(value, self.w_v)

        # Split into heads
        q = self._split_heads(q)  # [batch, num_heads, seq, head_dim]
        k = self._split_heads(k)
        v = self._split_heads(v)

        # Scaled dot-product attention
        scores = np.matmul(q, k.transpose(0, 1, 3, 2)) / math.sqrt(self.head_dim)

        if mask is not None:
            # Expand mask for multiple heads
            mask = mask[:, np.newaxis, :, :]  # [batch, 1, seq, seq]
            scores = np.where(mask == 0, float('-inf'), scores)

        attention_weights = self._softmax(scores)

        # Apply attention to values
        context = np.matmul(attention_weights, v)  # [batch, num_heads, seq, head_dim]

        # Concatenate heads
        context = self._concat_heads(context)  # [batch, seq, embed]

        # Final linear projection
        output = self._linear_projection(context, self.w_o)

        return output

    def _linear_projection(self, x: np.ndarray, weight: np.ndarray) -> np.ndarray:
        """Apply linear transformation."""
        return np.matmul(x, weight)

    def _split_heads(self, x: np.ndarray) -> np.ndarray:
        """Split tensor into multiple heads."""
        batch_size, seq_len, embed_dim = x.shape
        x = x.reshape(batch_size, seq_len, self.num_heads, self.head_dim)
        return x.transpose(0, 2, 1, 3)  # [batch, num_heads, seq, head_dim]

    def _concat_heads(self, x: np.ndarray) -> np.ndarray:
        """Concatenate multiple heads back."""
        batch_size, num_heads, seq_len, head_dim = x.shape
        x = x.transpose(0, 2, 1, 3)  # [batch, seq, num_heads, head_dim]
        return x.reshape(batch_size, seq_len, self.embed_dim)

    def _softmax(self, x: np.ndarray, axis: int = -1) -> np.ndarray:
        """Compute softmax along specified axis."""
        # Subtract max for numerical stability
        x_max = np.max(x, axis=axis, keepdims=True)
        exp_x = np.exp(x - x_max)
        return exp_x / np.sum(exp_x, axis=axis, keepdims=True)

    def get_weights(self) -> dict:
        """Get model weights for serialization."""
        return {
            'w_q': self.w_q.tolist(),
            'w_k': self.w_k.tolist(),
            'w_v': self.w_v.tolist(),
            'w_o': self.w_o.tolist(),
            'embed_dim': self.embed_dim,
            'num_heads': self.num_heads
        }

    def set_weights(self, weights: dict):
        """Set model weights from serialized data."""
        self.w_q = np.array(weights['w_q'])
        self.w_k = np.array(weights['w_k'])
        self.w_v = np.array(weights['w_v'])
        self.w_o = np.array(weights['w_o'])
        self.embed_dim = weights['embed_dim']
        self.num_heads = weights['num_heads']
        self.head_dim = self.embed_dim // self.num_heads
