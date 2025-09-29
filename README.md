# dotenvy – VS Code Environment Manager

🚀 **dotenvy** makes it effortless to manage and switch between your `.env` files directly inside VS Code. No more manual renaming or copy-pasting—just pick your environment and code.

---

## ✨ Features

* 🔄 **One-Click Switching**
  Switch between `.env.development`, `.env.staging`, `.env.production`, or any custom `.env.*` file.

* 📂 **Auto Detection**
  Automatically scans your workspace for `.env` files.

* 🔀 **Git Branch Auto-Switching**
  Automatically switch environments based on Git branch (develop → .env.development, staging → .env.staging, etc.)

* ✅ **Environment Validation**
  Validate .env files for syntax errors, required variables, and type checking

* 📄 **Diff View**
  Compare environment files side-by-side to see changes before switching

* � **Git Commit Hook** 🆕
  Prevent committing sensitive environment data with pre-commit security checks

* �🔀 **Multi-Workspace Support**
  Handle multiple workspace folders simultaneously with independent environment management

* 💾 **Backup & Restore**
  Keeps a backup of your current `.env` before switching, so nothing gets lost.

* 🌍 **Status Bar Indicator**
  Always see which environment is currently active.

* ⚠️ **Secrets Guard** *(optional)*
  Warns you if you're about to commit `.env` files with sensitive data.

---

## 📦 Installation

1. Open VS Code.
2. Go to the Extensions view (`Ctrl+Shift+X` or `⌘+Shift+X`).
3. Search for **dotenvy**.
4. Click **Install**.

Or download from [VS Code Marketplace](https://marketplace.visualstudio.com).

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

## 🗺️ Roadmap

* [x] Auto-switch env based on Git branch
* [x] Environment validation
* [x] Diff view
* [x] Multi-workspace support
* [x] Git commit hook to block secrets
* [x] Cloud sync with Doppler

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
