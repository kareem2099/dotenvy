# dotenvy – VS Code Environment Manager

[![Version](https://img.shields.io/badge/version-1.6.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)
[![Publisher](https://img.shields.io/badge/publisher-FreeRave-red.svg)](https://marketplace.visualstudio.com/publishers/FreeRave)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/badge/vscode-marketplace-007ACC)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)

🚀 **dotenvy** makes it effortless to manage and switch between your `.env` files directly inside VS Code. No more manual renaming or copy-pasting—just pick your environment and start coding immediately!

**[📥 Install from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)** • **[📖 Documentation](https://github.com/kareem2099/dotenvy#readme)** • **[🐛 Report Issues](https://github.com/kareem2099/dotenvy/issues)**

---

## ✨ Features

### 🔄 **Environment Switching**
Effortlessly switch between `.env.development`, `.env.staging`, `.env.production`, or any custom `.env.*` file with a single click.

### 📂 **Auto Detection & Sync**
Automatically scans your workspace for `.env` files and syncs seamlessly across multi-workspace setups.

### 🌿 **Git Branch Auto-Switching**
Automatically switch environments based on Git branch changes (develop → `.env.development`, staging → `.env.staging`, etc.)

### ✅ **Environment Validation**
Validate .env files for syntax errors, required variables, and type checking with custom regex patterns.

### 📄 **Diff View**
Compare environment files side-by-side before switching to preview changes and avoid surprises.

### 🛡️ **Git Commit Security**
Prevent committing sensitive data with pre-commit hooks that scan for secrets, validation errors, and block `.env` files.

### ☁️ **Cloud Sync Support**
Bidirectional cloud sync with Doppler Secrets Manager for team-based environment variable management.

### 💾 **Backup & Recovery**
Automatic backup creation before switching, with portable AES-256-GCM encrypted backups that work across any device.

### 📊 **Status Bar Integration**
Real-time environment indicator in status bar showing current configuration, validation status, and cloud sync state.

### 🔍 **Secrets Guard** 🧠 — v1.6.0

Production-grade secret detection powered by a **custom ML model** with HMAC-secured communication and an interactive Secrets Panel.

#### What's new in v1.6.0:
- **🔐 OS-Encrypted Secret Storage** — Shared secret stored in VS Code SecretStorage (Keychain / libsecret / Credential Manager), never in the compiled bundle
- **35-Feature ML Model (fixed)** — Feature count corrected from 31 → 35, entropy normalization fixed to match Python backend exactly
- **📋 Secrets Panel** — Full WebviewPanel shows all detected secrets (no more 5-item cap) with filter by confidence, search, View / Move to .env / Not a Secret buttons
- **🧠 AI Training Feedback** — "Not a Secret" and "Move to .env" send labeled training samples to the Railway model — it learns from your corrections
- **🚫 .dotenvyignore** — New file (same syntax as `.gitignore`) lets you exclude files and folders from secret scanning
- **📝 Centralized Logging** — All extension logs visible in VS Code Output panel → DotEnvy
- **🔄 Smart Fallback** — Local fallback analysis uses all 35 features including variable name signals (e.g. `DB_PASS` increases risk even with low entropy)

---

## 📋 Commands

All commands are accessible via the Command Palette (`Ctrl+Shift+P` / `⌘+Shift+P`).

### 🔄 Environment Manager
- **`DotEnvy: Switch Environment`** — Switch between `.env` files
- **`DotEnvy: Open Environment Panel`** — Open the interactive management panel
- **`DotEnvy: Validate Environment Files`** — Validate for syntax errors and required variables
- **`DotEnvy: Diff Environment Files`** — Compare environment files side-by-side

### 📊 Environment History
- **`DotEnvy: View Environment History`** — View historical changes with timestamps

### 🛡️ Git Integration
- **`DotEnvy: Install Git Commit Hook`** — Block commits containing secrets
- **`DotEnvy: Remove Git Commit Hook`** — Remove the installed hook

### ☁️ Cloud Sync
- **`DotEnvy: Pull Environment from Cloud`** — Pull from Doppler
- **`DotEnvy: Push Environment to Cloud`** — Push to Doppler

### 🔍 Security
- **`DotEnvy: Scan for Secrets`** — Scan workspace with AI-powered detection; opens Secrets Panel with all findings
- **`DotEnvy: Init .dotenvyignore`** — Create a pre-populated `.dotenvyignore` file
- **`DotEnvy: Setup LLM Secret`** — Store the HMAC shared secret securely in OS vault

### 🖱️ Right-Click (Explorer)
- **`DotEnvy: Ignore this path`** — Right-click any file or folder → add to `.dotenvyignore` instantly

### 💬 Support
- **`DotEnvy: Feedback & Support`** — Access feedback and support resources
- **`DotEnvy: Show What's New`** — View changelog for current version

---

## 🚫 .dotenvyignore

Control which files DotEnvy skips when scanning for secrets — same syntax as `.gitignore`:

```gitignore
# .dotenvyignore

# DotEnvy's own data (always recommended)
.dotenvy/**
.dotenvy-backups/**

# Test files (often contain example secrets)
**/*.test.ts
**/*.spec.ts
tests/**

# Docs with example secrets
docs/**
README.md
SECURITY.md

# Specific files
k8s/secrets.yaml
```

Run **`DotEnvy: Init .dotenvyignore`** to create a default file, or right-click any file/folder in the Explorer and choose **"DotEnvy: Ignore this path"**.

---

## 📦 Installation

### Quick Install
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `⌘+Shift+X`)
3. Search for "**dotenvy**"
4. Click **Install**

### Alternative Methods
- **[Download from VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)**
- **Manual**: Download `.vsix` file and install via VS Code

### Requirements
- VS Code **1.110.0** or later

---

## 🚀 Usage

1. Place your environment files in your project root:

   ```bash
   .env.development
   .env.staging
   .env.production
   ```

2. Open the **Command Palette** (`Ctrl+Shift+P`).

3. Run `DotEnvy: Switch Environment` and pick your environment.

4. The selected file is copied to `.env` automatically.

✅ The status bar updates to show the active environment.

---

## ⚙️ Configuration

```jsonc
// .dotenvy.json
{
  "environments": {
    "local": ".env.local",
    "qa": ".env.qa",
    "prod": ".env.production"
  },
  "gitBranchMapping": {
    "develop": "development",
    "staging": "staging",
    "main": "production"
  },
  "autoSwitchOnBranchChange": true,
  "validation": {
    "requiredVariables": ["API_KEY", "DATABASE_URL"],
    "variableTypes": {
      "PORT": "number",
      "DEBUG": "boolean",
      "API_URL": "url"
    }
  },
  "gitCommitHook": {
    "blockEnvFiles": true,
    "blockSecrets": true,
    "blockValidationErrors": true
  }
}
```

---

## ☁️ Cloud Sync Setup (Doppler)

```jsonc
{
  "cloudSync": {
    "provider": "doppler",
    "project": "your-project-name",
    "config": "development",
    "token": "dp.pt.your_token_here"
  }
}
```

---

## 🗺️ Roadmap

* [x] Auto-switch env based on Git branch
* [x] Environment validation + diff view
* [x] Git commit hook to block secrets
* [x] Cloud sync with Doppler (E2E encrypted)
* [x] Multi-user key wrapping (envelope encryption)
* [x] Portable encrypted backups (PBE + PBKDF2)
* [x] AI-powered secret detection (LLM v1 — 14 features)
* [x] HMAC-secured LLM service (v1.5.0 — 35 features, 18.4x cache, SSE streaming)
* [x] **OS-encrypted secret storage + Secrets Panel + .dotenvyignore + AI feedback loop (v1.6.0)**

* [ ] Wire `/extension/feedback` on Railway — model learns from user corrections
* [ ] Persist trained model across Railway deploys (persistent volume)
* [ ] Streaming confidence updates in VS Code panel (SSE → UI)
* [ ] Proper backpropagation + Adam optimizer for ML model
* [ ] Expand training dataset to 150+ samples
* [ ] Support for Vault, AWS Secrets Manager
* [ ] Shareable environment templates

---

## 🤝 Contributing

PRs are welcome! If you have ideas for features, open an issue.

---

## 📜 License

MIT © 2026 FreeRave (Kareem)

---

## Development

```bash
git clone https://github.com/kareem2099/dotenvy
npm install
# Open in VS Code and press F5 to start debugging
```