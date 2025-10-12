# Custom LLM for Secret Detection

A from-scratch implementation of a lightweight Language Model optimized for detecting and classifying potential secrets in code repositories.

## Overview

This service provides intelligent secret analysis using custom neural networks trained specifically for pattern recognition in security-sensitive data. It replaces traditional rule-based secret detection with learned patterns that improve accuracy over time.

## Features

- **Custom Transformer Architecture** - From-scratch implementation with attention mechanisms
- **Fast Inference** - Sub-100ms response times optimized for real-time scanning
- **VS Code Integration** - Seamless HTTP API for extension integration
- **Feature Extraction** - 14-dimensional feature vectors capturing entropy, patterns, and context
- **Confidence Classification** - 'high', 'medium', 'low' confidence scoring
- **Learning Capability** - Can be trained on user feedback for improved accuracy

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  VS Code Ext    │────│  REST API (8000) │────│  Custom LLM     │
│                 │    │                  │    │                 │
│  TypeScript     │    │  FastAPI         │    │  Python         │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌───────────────┐
                       │  Features     │
                       │  ├─ Entropy   │
                       │  ├─ Patterns  │
                       │  ├─ Context   │
                       │  └─ Variable  │
                       │     Names     │
                       └───────────────┘

                                       ▼

                             ┌───────────────┐
                             │  Transformer  │
                             │  ├─ Attention │
                             │  ├─ FF Network│
                             │  └─ Classification
                             └───────────────┘
```

## Quick Start

### 1. Deploy the Service

```bash
cd python-llm
chmod +x deploy.sh
./deploy.sh
```

### 2. Verify Deployment

```bash
curl http://127.0.0.1:8000/health
# Should return: {"status":"ok","llm_ready":true}
```

### 3. Test Analysis

```bash
curl -X POST "http://127.0.0.1:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{
    "secret_value": "sk-test-123456789",
    "context": "const STRIPE_KEY = ",
    "variable_name": "STRIPE_KEY"
  }'
```

## API Endpoints

### Health Check
```http
GET /health
```
Returns service status and model readiness.

### Analyze Secret
```http
POST /analyze
```
Request body:
```json
{
  "secret_value": "string",
  "context": "string",
  "variable_name": "string (optional)"
}
```

Response:
```json
{
  "enhanced_confidence": "high|medium|low",
  "method": "llm",
  "error": "optional error message"
}
```

### Train Model
```http
POST /train
```
Sends training samples for model improvement (background processing).

### Reset Model
```http
POST /reset
```
Resets model weights to initial state.

## Configuration

The model hyperparameters can be modified in `src/model.py`:

- `vocab_size`: Token vocabulary size
- `hidden_dim`: Transformer hidden dimension
- `num_layers`: Number of transformer layers
- `num_heads`: Multi-head attention heads
- `learning_rate`: Training learning rate

## Dependencies

- Python 3.8+
- NumPy 1.24+
- FastAPI 0.100+
- Uvicorn 0.23+
- SciPy 1.10+

## Model Architecture Details

### Multi-Head Attention
- Learnable query, key, value projections
- Scaled dot-product attention mechanism
- Multiple attention heads for different pattern learning

### Feed-Forward Networks
- Point-wise two-layer networks
- ReLU activation with layer normalization
- Residual connections for stable training

### Classification Head
- 4-class classification (high/medium/low/false_positive)
- Softmax activation for probability distribution
- Feature-based confidence scoring

### Feature Extraction (14 dimensions)
1. Secret length
2. Shannon entropy
3. Special character count
4. Digit pattern presence
5. Uppercase pattern presence
6. Lowercase pattern presence
7. Character diversity ratio
8. Common prefix detection (sk-, pk-, etc.)
9. Base64 pattern detection
10. Hexadecimal pattern detection
11. Context risk score
12. Quote context detection
13. Keyword proximity count
14. Variable naming score

## Training

The model learns from user feedback when secrets are marked as:
- `migrated` - Confirmed real secret
- `ignored` - Intentionally ignored
- `false_positive` - Not a secret

Training occurs in the background when the `/train` endpoint is called.

## Performance

- **Model Size**: ~50MB saved as JSON
- **Inference Time**: <100ms per secret
- **Memory Usage**: <100MB during operation
- **Training**: Adam optimization with gradient clipping

## Integration with DotEnvy

This LLM service is automatically used by the DotEnvy VS Code extension for enhanced secret detection. When the Python service is unavailable, the extension falls back to traditional rule-based analysis.

### Extension Configuration

Add to `settings.json` for custom service URL:
```json
{
  "dotenvy.customLlmServiceUrl": "http://your-server:port"
}
```

## Development

### Project Structure
```
python-llm/
├── src/
│   ├── __init__.py     # Package initialization
│   ├── attention.py    # Multi-head attention implementation
│   ├── model.py        # Main LLM architecture
│   └── service.py      # FastAPI service interface
├── main.py             # Service entry point
├── deploy.sh           # Deployment script
├── requirements.txt    # Python dependencies
└── README.md          # This file
```

### Running in Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run service directly
python main.py

# Or use deployment script
./deploy.sh
```

### Testing API

```python
import requests

# Test health
response = requests.get('http://127.0.0.1:8000/health')
print(response.json())

# Test analysis
payload = {
    "secret_value": "sk-1234567890abcdef",
    "context": "API_KEY = ",
    "variable_name": "API_KEY"
}
response = requests.post('http://127.0.0.1:8000/analyze', json=payload)
print(response.json())
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your improvements
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - See LICENSE file for details.
