# dotenvy – VS Code Environment Manager

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)
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
Automatic backup creation before switching, with configurable backup paths and encryption options.

### 📊 **Status Bar Integration**
Real-time environment indicator in status bar showing current configuration, validation status, and cloud sync state.

### 🔍 **Secrets Guard** 🧠
Advanced secret detection powered by custom **Large Language Model (LLM)** for superior accuracy in identifying potential sensitive data exposure. Features:
- **AI-Powered Analysis**: Custom transformer model trained specifically for secret patterns
- **Confidence Scoring**: High/Medium/Low confidence classification
- **Real-time Scanning**: Instant detection during file changes
- **Learning Capability**: Improves accuracy from user feedback
- **Fallback Protection**: Traditional entropy-based analysis when AI unavailable

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

* [ ] Support for other cloud providers (Vault, AWS Secrets Manager)
* [ ] Environment variable encryption at rest
* [ ] Shareable environment templates
* [ ] Integration with Docker environments

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
