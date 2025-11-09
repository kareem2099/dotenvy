#!/bin/bash

# LLM Service Test Commands
# =========================
# Test script for Railway-deployed LLM service
# Contains sensitive API keys - DO NOT COMMIT TO GIT

# Configuration
API_URL="https://llm-service-production-fe08.up.railway.app"
API_KEY="llm_ff5EBtP3Rb2U9zX6hUWM6RdJZbY0"
JWT_SECRET="P8PuLkY4swARAAFa4Fd9ZkGQ8VOfenVzDpf9ogBeZtxiF6k7luhus2N2gIBHx9Le"

echo "🧪 Testing LLM Service at $API_URL"
echo "========================================"

# Test 1: Health Check
echo -e "\n✅ Test 1: Health Check"
curl -s "$API_URL/health" | jq .

# Test 2: API Key Authentication Test
echo -e "\n🔐 Test 2: API Key Analysis (Stripe Key)"
curl -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "secret_value": "sk-1234567890abcdef",
    "context": "const apiKey = \"sk-1234567890abcdef\";",
    "variable_name": "apiKey"
  }' | jq .

# Test 3: JWT Secret Analysis
echo -e "\n🔐 Test 3: JWT Secret Analysis"
curl -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"secret_value\": \"$JWT_SECRET\",
    \"context\": \"JWT_SECRET=your-secret-here\",
    \"variable_name\": \"JWT_SECRET\"
  }" | jq .

# Test 4: AWS Key Analysis
echo -e "\n🔐 Test 4: AWS Access Key Analysis"
curl -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "secret_value": "AKIAIOSFODNN7EXAMPLE",
    "context": "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    "variable_name": "AWS_ACCESS_KEY_ID"
  }' | jq .

# Test 5: GitHub Token Analysis
echo -e "\n🔐 Test 5: GitHub Token Analysis"
curl -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "secret_value": "ghp_abcd1234efgh5678",
    "context": "GITHUB_TOKEN=ghp_abcd1234efgh5678",
    "variable_name": "GITHUB_TOKEN"
  }' | jq .

# Test 6: Stats Endpoint
echo -e "\n📊 Test 6: Service Statistics"
curl -X GET "$API_URL/stats" \
  -H "Authorization: Bearer $API_KEY" | jq .

echo -e "\n🎉 All tests completed!"
echo "Note: This file contains sensitive API keys and should not be committed to GitHub."
