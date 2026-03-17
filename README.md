# dotenvy – VS Code Environment Manager

[![Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)
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

### 🔍 **Secrets Guard** 🧠 — v1.5.0
Production-grade secret detection powered by a **custom ML model** deployed on Railway with HMAC-secured communication.

#### What's new in v1.5.0:
- **🔐 HMAC-SHA256 Authentication** — Extension signs every request; no API key stored or transmitted
- **35-Feature ML Model** — Analyzes entropy, patterns, context, variable names, and structure simultaneously
- **⚡ 18.4x Cache Speedup** — Two-tier L1 LRU + L2 Redis cache for near-instant repeated analyses
- **📡 Progressive Streaming** — Results stream progressively: pattern → entropy → context → AI → final
- **🔄 Smart Fallback** — Local heuristic analysis (entropy + known prefixes) when service is unreachable
- **🎯 Confidence Scoring** — High / Medium / Low classification with reasoning attached to each finding

---

## 📋 Commands

dotenvy provides a comprehensive set of commands to manage your environment files. All commands are accessible via the Command Palette (`Ctrl+Shift+P` / `⌘+Shift+P`).

### 🔄 Environment Manager
Core commands for managing and switching between environment files:

- **`dotenvy: Switch Environment`** - Switch between different `.env` files (development, staging, production, etc.)
- **`dotenvy: Open Environment Panel`** - Open the interactive environment management panel
- **`dotenvy: Validate Environment Files`** - Validate .env files for syntax errors and required variables
- **`dotenvy: Diff Environment Files`** - Compare environment files side-by-side before switching

### 📊 Environment History
Track and manage environment file changes over time:

- **`dotenvy: View Environment History`** - View historical changes to environment files with timestamps and git integration

### 🛡️ Git Integration
Secure your commits with pre-commit hooks:

- **`dotenvy: Install Git Commit Hook`** - Install pre-commit hook to prevent committing secrets and validation errors
- **`dotenvy: Remove Git Commit Hook`** - Remove the installed git commit hook

### ☁️ Cloud Sync
Bidirectional synchronization with cloud secret managers:

- **`dotenvy: Pull Environment from Cloud`** - Pull environment variables from Doppler (or other cloud providers)
- **`dotenvy: Push Environment to Cloud`** - Push local environment variables to Doppler

### 🔍 Security
Advanced security scanning for sensitive data:

- **`dotenvy: Scan for Secrets`** - Scan workspace for potential secrets using AI-powered analysis

### 💬 Support
Get help and provide feedback:

- **`dotenvy: Feedback & Support`** - Access feedback form and support resources

### ⌨️ Keyboard Shortcuts
To improve productivity, consider setting up keyboard shortcuts for frequently used commands:

1. Open Keyboard Shortcuts (`Ctrl+K Ctrl+S` / `⌘+K ⌘+S`)
2. Search for "dotenvy"
3. Assign shortcuts to your most-used commands (e.g., `Ctrl+Alt+E` for Switch Environment)

### 🎮 List Commands Feature
For easy command discovery and execution, use **`dotenvy: List Commands`** which provides:

- **Interactive Quick Pick Menu**: Browse all commands organized by category
- **Command Descriptions**: Detailed explanations of what each command does
- **Direct Execution**: Click to run any command immediately
- **Keyboard Shortcuts Setup**: Built-in assistance for setting up shortcuts

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
- VS Code 1.74.0 or later
- Node.js (for cloud sync features)

## 🏗️ Supported Environments

Default environment files are automatically detected:
- `.env.development`
- `.env.staging`
- `.env.production`
- `.env.test`

**Custom environments** can be configured in `.dotenvy.json`.

---

## 🚀 Usage

1. Place your environment files in your project root:

   ```bash
   .env.development
   .env.staging
   .env.production
   ```

2. Open the **Command Palette** (`Ctrl+Shift+P` / `⌘+Shift+P`).

3. Search for:

   ```
   dotenvy: Switch Environment
   ```

4. Pick the environment you want to activate.

5. The selected file will be copied into `.env` automatically.

✅ The status bar will update to show the active environment.

---

## ⚙️ Configuration

You can add a config file to define custom environments, git branch auto-switching, and validation rules:

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
    "master": "production",
    "main": "production"
  },
  "autoSwitchOnBranchChange": true,
  "validation": {
    "requiredVariables": ["API_KEY", "DATABASE_URL"],
    "variableTypes": {
      "PORT": "number",
      "DEBUG": "boolean",
      "API_URL": "url"
    },
    "customValidators": {
      "EMAIL": "^[^@]+@[^@]+\\.[^@]+$"
    }
  },
  "gitCommitHook": {
    "blockEnvFiles": true,
    "blockSecrets": true,
    "blockValidationErrors": true,
    "customMessage": "Commit blocked due to security concerns"
  }
}
```

---

## ☁️ Cloud Sync Setup

### Doppler Integration

dotenvy supports bidirectional sync with [Doppler](https://www.doppler.com/) for team-based environment variable management.

#### Setup Steps:
1. **Create Doppler Account** and project at [doppler.com](https://www.doppler.com/)
2. **Generate Service Token** from Doppler dashboard
3. **Add to .dotenvy.json**:

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

#### Available Commands:
- **Pull from Cloud**: `dotenvy: Pull Environment from Cloud`
- **Push to Cloud**: `dotenvy: Push Environment to Cloud`

**Note**: Doppler tokens are stored securely using VS Code secrets storage.

---

## 🗺️ Roadmap

* [x] Auto-switch env based on Git branch
* [x] Environment validation
* [x] Diff view
* [x] Multi-workspace support
* [x] Git commit hook to block secrets
* [x] Cloud sync with Doppler
* [x] End-to-end encrypted cloud sync (AES-256-GCM)
* [x] Multi-user key wrapping (envelope encryption)
* [x] Portable encrypted backups (PBE + PBKDF2)
* [x] AI-powered secret detection (LLM v1 — 14 features)
* [x] **HMAC-secured LLM service (v1.5.0 — 35 features, 18.4x cache, SSE streaming)**

* [ ] Streaming confidence updates in the VS Code panel (SSE → UI)
* [ ] Offline fallback mode with local heuristics only
* [ ] Support for other cloud providers (Vault, AWS Secrets Manager)
* [ ] Shareable environment templates
* [ ] Integration with Docker environments
* [ ] Continuous learning from user feedback (wire `/train` endpoint to panel)

---

## 🤝 Contributing

PRs are welcome! If you have ideas for features, open an issue.

---

## 📜 License

MIT © 2025 Kareem Ehab

---

## Development

This extension is built with TypeScript. To get started:

1. Clone the repository
2. Run `npm install`
3. Open in VS Code
4. Press F5 to start debugging