# dotenvy – VS Code Environment Manager

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)
[![Codename](https://img.shields.io/badge/codename-Nexus-orange.svg)](https://github.com/kareem2099/dotenvy/releases/tag/v2.0.0)
[![Publisher](https://img.shields.io/badge/publisher-FreeRave-red.svg)](https://marketplace.visualstudio.com/publishers/FreeRave)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/badge/vscode-marketplace-007ACC)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)

<div align="center">
  <img width="800" alt="DotEnvy Variable Manager" src="https://github.com/user-attachments/assets/46565ce7-fa75-4d39-b582-e32ebcdee0f1" />
</div>

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

## 🚀 What's New in v2.0.0? (Nexus)

### 🗑️ Session Trash Bin (Lifesaver!)
Deleted a crucial variable by mistake? No worries. Restore it with a single click from the new Session Trash Bin.
<img width="100%" alt="Trash Bin Demo" src="https://github.com/user-attachments/assets/7a84cb1a-2b6e-447e-9c7c-8510d266b4b0" />

### 🔍 Native VS Code Diff & History
Review your `.env` changes exactly like you review Git commits. 
<img width="100%" alt="Native Diff Demo" src="https://github.com/user-attachments/assets/d3905fa6-6b1c-478f-ba50-a993d45515d7" />

### 📊 Environment Analytics
Track your usage, stability metrics, and most active environments directly from your dashboard.
<img width="100%" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/70b17cee-f866-42f0-922d-0942d181fe48" />

### ⚙️ Compact Switcher & Settings
Manage all your environments seamlessly from a clean, native sidebar.
<img width="100%" alt="Environment Switcher" src="https://github.com/user-attachments/assets/c2139b3c-4dfc-4a3c-86b5-adf0b7b7fa89" />

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
- **`DotEnvy: Open Variable Manager`** — Open the full-page variable editor tab
- **`DotEnvy: Validate Environment Files`** — Validate for syntax errors and required variables

### 📊 Explorers & Analytics
- **`DotEnvy: View Environment History`** — View the dense history table and slide-over advanced filters
- **`DotEnvy: Open Trash Bin`** — Recover accidental deletions or changes in real-time
- **`DotEnvy: Open Analytics Panel`** — View heatmap and stability metrics
- **`DotEnvy: Open Timeline Panel`** — View the SVG timeline viewer tab

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

## 🗺️ Roadmap & Contributing

For upcoming features, see [ROADMAP.md](ROADMAP.md).  
Issues and PRs are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests to us.

---

## 📜 License

This project is licensed under the Apache License, Version 2.0 - see the [LICENSE](LICENSE) file for details.