# DotEnvy — .env Manager & Secret Scanner for VS Code

> Switch, validate, encrypt and sync `.env` files without leaving VS Code — part of the [**DotSuite**](https://www.dotsuite.dev/en) developer toolkit.

[![Ecosystem - DotSuite](https://img.shields.io/badge/Ecosystem-DotSuite-00b4d8?style=flat-square&labelColor=333333)](https://www.dotsuite.dev/en/product/dotenvy)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/FreeRave.dotenvy?style=flat-square&label=Marketplace&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/FreeRave.dotenvy?style=flat-square&color=10b981)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)
[![Publisher](https://img.shields.io/badge/publisher-FreeRave-red?style=flat-square)](https://marketplace.visualstudio.com/publishers/FreeRave)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)

<div align="center">
  <img width="128" height="128" alt="DotEnvy logo — DE monogram with a key" src="resources/icons/icon.png" />
  <br /><br />
  <img width="800" alt="DotEnvy Variable Manager in VS Code" src="https://github.com/user-attachments/assets/46565ce7-fa75-4d39-b582-e32ebcdee0f1" />
  <br /><br />

**[📥 Install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)** •
**[🌐 DotEnvy on DotSuite](https://www.dotsuite.dev/en/product/dotenvy)** •
**[📝 Changelog](CHANGELOG.md)** •
**[🐛 Report an Issue](https://github.com/kareem2099/dotenvy/issues)**

</div>

---

## Contents

- [Why DotEnvy](#why-dotenvy)
- [Features](#features)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Secret Scanning & .dotenvyignore](#secret-scanning--dotenvyignore)
- [Cloud Sync with Doppler](#cloud-sync-with-doppler)
- [Privacy & Security](#privacy--security)
- [Development](#development)
- [Contributors](#contributors)
- [Part of DotSuite](#part-of-dotsuite)
- [License](#license)

---

## Why DotEnvy

- **One click to switch** between `.env.development`, `.env.staging`, `.env.production` or any custom file — no more renaming or copy-pasting.
- **Catch leaked keys early** with an offline secret scanner, editor warnings and a pre-commit hook.
- **Keep secrets encrypted** with AES-256-GCM backups, multi-user key wrapping and end-to-end encrypted Doppler sync.
- **Never lose a value** thanks to local history, a timeline, analytics and a session Trash Bin.
- **Works in your language**: English, Italian, Arabic (full RTL) and Russian.

---

## Features

### 🔄 Environment Switching
Switch between `.env.*` files from the sidebar, the dashboard or the Command Palette. The selected file is copied to `.env` and the status bar shows the active environment. Map Git branches to environments to switch automatically (`develop` → `.env.development`, `main` → `.env.production`).

<img width="100%" alt="DotEnvy environment switcher sidebar" src="https://github.com/user-attachments/assets/c2139b3c-4dfc-4a3c-86b5-adf0b7b7fa89" />

### 🔍 Offline Secret Scanner
Rule-based detection of API keys, tokens, passwords, private keys and database URLs — fully local, with no network requests.

- **Known key formats** for Stripe, AWS, GitHub, Slack, SendGrid, Google, OpenAI, Twilio, Mailgun, Sentry, SSH private keys and more.
- **Entropy and context signals** — risky variable names (`DB_PASS`, `client_secret`) and surrounding code raise or lower each result to High, Medium or Low.
- **Secrets Panel** with confidence filters, search and **View / Move to .env / Not a Secret** actions. View opens the original file and selects the complete value.
- **Local corrections** — "Not a Secret" and "Move to .env" are remembered for the same file, variable and value.
- **Fewer false positives** — import/require paths, URL fragments and file paths are not reported as Base64 secrets.
- **Editor warnings** in the Problems panel and a **Review Secrets** notification when a changed file contains findings.
- **Responsive on large workspaces** — at most four files scan at once and the UI stays usable.

### 🛡️ Git Commit Protection
A pre-commit hook blocks commits that contain secrets, validation errors or `.env` files. Git root discovery supports monorepos.

### ✅ Validation & Diff
Validate `.env` files for syntax errors, required variables and types (`number`, `boolean`, `url` or custom regex). Compare files side by side in VS Code's native diff before switching, and find the same key with different values across environments.

### ☁️ Doppler Cloud Sync
Connect Doppler in the browser with no CLI or manual token copying. Push and pull with end-to-end encryption, multi-file prefix routing (`BACKEND_`, `FRONTEND_`), a read-only cloud diff, and pulls that keep your comments and layout. [Setup details ↓](#cloud-sync-with-doppler)

### 🔐 Encryption & Backups
- Automatic backups before switching, with portable AES-256-GCM encrypted backups that restore on any device.
- Master keys in VS Code SecretStorage, and multi-user envelope encryption with per-user access and revocation.

### 📊 History, Timeline, Analytics & Trash Bin
Review `.env` changes like Git commits, roll back from history, browse the timeline, track stability metrics and restore deleted variables from the session Trash Bin.

<img width="100%" alt="DotEnvy session Trash Bin restoring a deleted variable" src="https://github.com/user-attachments/assets/7a84cb1a-2b6e-447e-9c7c-8510d266b4b0" />
<img width="100%" alt="DotEnvy native diff of .env history" src="https://github.com/user-attachments/assets/d3905fa6-6b1c-478f-ba50-a993d45515d7" />
<img width="100%" alt="DotEnvy analytics dashboard" src="https://github.com/user-attachments/assets/70b17cee-f866-42f0-922d-0942d181fe48" />

Analytics reads **local recorded history**. Switching an environment or saving an `.env`/`.env.*` file creates a record; actions from before installation cannot be reconstructed. History is stored under `.dotenvy/history` (or `history.storagePath`) and includes file contents, so keep that folder out of Git. Set `history.enabled: false` in `.dotenvy.json` to stop recording, or `history.trackManualEdits: false` to skip editor saves.

### 🌐 Localization
English, Italian (`it`), Arabic (`ar`, full RTL) and Russian (`ru`) across every command, notification and panel. Switch languages instantly from the sidebar.

---

## Quick Start

1. Install **DotEnvy** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy), or search for "dotenvy" in the Extensions view (`Ctrl+Shift+X` / `⌘+Shift+X`). Requires VS Code **1.90.0** or later.
2. Add environment files to your project root:

   ```bash
   .env.development
   .env.staging
   .env.production
   ```

3. Run **`DotEnvy: Switch Environment`** from the Command Palette (`Ctrl+Shift+P` / `⌘+Shift+P`) and pick one. It is copied to `.env` and shown in the status bar.

### Initialize a project (optional)

- **Init Secure Project** asks for a project name, an admin username and a password. It creates `.dotenvy.lock.json` (the password-wrapped project key and users) and opens `.dotenvy.json`. Cancelling any prompt stops setup; reinitializing replaces existing keys only after confirmation.
- **Init .dotenvyignore** creates a default ignore file, or opens your existing one without changing it.

With several folders open, these commands use the first workspace folder.

---

## Commands

All commands are available from the Command Palette.

| Area | Command | What it does |
| --- | --- | --- |
| Environments | `DotEnvy: Open Main Dashboard` | Environment Manager dashboard |
| | `DotEnvy: Switch Environment` | Switch between `.env` files |
| | `DotEnvy: Open Variable Manager` | Full-page variable editor |
| | `DotEnvy: Validate Environment Files` | Check syntax, required variables and types |
| | `DotEnvy: Diff Environment Files` | Compare two files in VS Code's diff view |
| | `DotEnvy: Compare Environments` | Find the same key with different values |
| History | `DotEnvy: View Environment History` | History table with advanced filters and rollback |
| | `DotEnvy: Open Timeline Panel` | Visual timeline of changes |
| | `DotEnvy: Open Analytics Panel` | Heatmap and stability metrics |
| | `DotEnvy: Open Session Trash Bin` | Restore deleted variables |
| Backups | `DotEnvy: Backup Current Environment` | Create an (optionally encrypted) backup |
| | `DotEnvy: Restore from Backup` | Restore a backup on any device |
| Team | `DotEnvy: Init Secure Project` | Create the project key and admin user |
| | `DotEnvy: Add User to Secure Project` | Give another user access |
| | `DotEnvy: Revoke User Access` | Remove a user's access |
| | `DotEnvy: Login to Secure Project` | Unlock the project key with your password |
| Git | `DotEnvy: Install Git Commit Hook` | Block commits that contain secrets |
| | `DotEnvy: Remove Git Commit Hook` | Remove the hook |
| Cloud | `DotEnvy: Connect Doppler` | Browser sign-in and automatic setup |
| | `DotEnvy: Pull Environment from Cloud` | Pull from Doppler |
| | `DotEnvy: Push Environment to Cloud` | Push to Doppler |
| | `DotEnvy: Diff Cloud Secrets` | Read-only comparison with Doppler |
| Security | `DotEnvy: Scan for Secrets` | Scan the workspace (100% local) |
| | `DotEnvy: Init .dotenvyignore` | Create a default `.dotenvyignore` |
| | `DotEnvy: Reset Local Secret Corrections` | Forget "Not a Secret" / "Move to .env" decisions |
| | `DotEnvy: Ignore this path` | Explorer right-click → add to `.dotenvyignore` |
| Help | `DotEnvy: Feedback & Support` | Feedback and support links |
| | `DotEnvy: Show What's New` | Open the changelog |

---

## Configuration

Create `.dotenvy.json` in your project root:

```jsonc
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

## Secret Scanning & .dotenvyignore

**Scan for Secrets** checks supported source and configuration files in every open workspace folder, including `.env` variants, JSON files and files without an extension. Generated and dependency folders are skipped by default: `node_modules`, `build`, `dist`, `out`, `coverage`, `htmlcov`, Python environments/caches and DotEnvy's own data folders. Test files and common fixture names are skipped too. The same rules apply to automatic file watching.

Git ignore rules do not decide what is scanned, because ignored config files can still hold real credentials. Use `.dotenvyignore` (same syntax as `.gitignore`) to skip more paths, or a negation such as `!test/integration.ts` to include one. Each file uses the `.dotenvyignore` of its own workspace folder.

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

# Specific files
k8s/secrets.yaml
```

Run **`DotEnvy: Init .dotenvyignore`** to create a default file, or right-click a file or folder in the Explorer and choose **DotEnvy: Ignore this path**.

---

## Cloud Sync with Doppler

### Connect in one step

Click **Connect Doppler** in the Environment Manager, or run **`DotEnvy: Connect Doppler`**. DotEnvy opens Doppler's sign-in page with a one-time code (use **Copy Code**). After you approve access, DotEnvy:

1. Uses your configured project/config, or for a fresh setup derives a lowercase project name from `package.json` or the folder name and uses `dev`.
2. Connects to that exact project, creating it if needed, without selecting a production config or replacing remote secrets.
3. Creates a read/write service token limited to that config, checks access without downloading secret values, and stores the token in VS Code SecretStorage.
4. Revokes the temporary account credential used for setup. The button then becomes **Doppler** and opens your project dashboard.

Connecting never uploads `.env` values or runs a push/pull. If setup fails or you cancel, your existing settings and token are kept; the notification names the failing step and HTTP status, and **View → Output → DotEnvy** shows credential-free diagnostics. All requests go directly to `api.doppler.com`. Sign-in uses the device authorization flow of the [official Doppler CLI](https://github.com/DopplerHQ/cli/blob/master/pkg/http/api.go) (compatible with `v3.77.0`).

### Manual configuration

```jsonc
{
  "cloudSync": {
    "provider": "doppler",
    "project": "your-project-name",
    "config": "dev"
  }
}
```

Replace the example values with your Doppler project slug and a config your token can access. Project names are normalized to lowercase slugs (dots and spaces become hyphens).

- **Tokens**: On an authentication error, choose **Set Doppler Token** to store a token in SecretStorage; the legacy `cloudSync.token` JSON field is removed. Precedence: project SecretStorage → `DOPPLER_TOKEN` environment variable → legacy config field.
- **HTTP 401** means the token was rejected (example, expired or revoked). **HTTP 403** means it cannot access that project/config; pushing needs write access. See the [Doppler service token docs](https://docs.doppler.com/docs/service-tokens).
- **Encryption**: Portable encryption is on by default. The first encrypted push asks for a sync passphrase (PBKDF2 + AES-256-GCM); another machine pulls with the same passphrase. DotEnvy cannot recover a lost passphrase.
- **Pull** merges into existing files and keeps comments, layout, multiline values and CRLF line endings. It backs up each file to a sibling `.backup` and adds `.env*.backup` to `.gitignore`.
- **Multiple files**: configure `envTargets` with `keyPrefix`, `prefixes` or `catchAll`. `pushMode: "replace"` removes remote keys missing locally, after confirmation.
- A missing Doppler config asks you to choose one; DotEnvy never switches environments on its own.

---

## Privacy & Security

**The secret scanner runs fully offline. Keys, code and corrections never leave your machine.**

| Data | Where it stays |
| --- | --- |
| Source code and detected values | Read from your workspace and processed in memory. Move to .env writes a local file. |
| Scan results | Redacted text, sanitized context and location in memory; cache lasts five minutes, up to 1,000 files. |
| Local corrections | A fingerprint of file, variable and value digest plus the decision, in VS Code state (up to 500). No raw values or file names. |

Corrections apply only to the same file, variable and complete value. A changed value or another file does not inherit them. **`DotEnvy: Reset Local Secret Corrections`** clears them.

The scanner estimates whether a value looks like a secret. It does not check whether a key is real, active or revoked, and false positives or missed secrets are possible. Moving a value to `.env` does not revoke it or remove it from Git history. Doppler push/pull sends environment data only to the Doppler account you configure. Please don't post live credentials or private code in issues.

### Why DotAegis is no longer included

Earlier versions bundled **DotAegis**, a small AI model that re-scored scanner results, plus an optional upload of numeric corrections to train it. It has been removed from DotEnvy completely. A useful model needs a large set of real, labelled keys, and nobody can or should hand over real secrets to train it. The bundled model was trained on synthetic data only, so DotEnvy now relies on transparent rules instead. DotAegis continues as a [separate DotSuite project](https://www.dotsuite.dev/en/product/dotaegis).

Upgrading deletes any pending upload queue and consent state. The `dotenvy.secrets.enableCommunityLearning`, `dotenvy.secrets.enableModelUpdates` and `dotenvy.secrets.enableCloudAnalysis` settings no longer exist. Data an older version already sent is not erased by upgrading.

---

## Development

```bash
git clone https://github.com/kareem2099/dotenvy.git
cd dotenvy
npm ci
npm run compile
npm test
```

`npm test` compiles, lints and runs the full suite (`node test/run-all-tests.js`). Offline suites block all HTTP/fetch calls. Press **F5** in VS Code to launch an Extension Development Host. See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and pull request process.

---

## Contributors

Issues and pull requests are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first.

Special thanks to **[@FaberVi](https://github.com/FaberVi)** for the Italian localization, language switcher, compact sidebar and Doppler multi-file sync ([#2](https://github.com/kareem2099/dotenvy/pull/2)), and for the module split, portable cloud encryption, cloud pull fixes and test suites ([#5](https://github.com/kareem2099/dotenvy/pull/5)).

---

## Part of DotSuite

DotEnvy is one of the tools in **[DotSuite](https://www.dotsuite.dev/en)** — an ecosystem of modern, privacy-focused developer tools for VS Code and Linux.

🌐 **DotSuite:** [www.dotsuite.dev](https://www.dotsuite.dev/en) · **DotEnvy page:** [dotsuite.dev/en/product/dotenvy](https://www.dotsuite.dev/en/product/dotenvy)

> CodeTune · DotCommand · **DotEnvy** · DotFetch · DotReadme · DotSense · DotShare · DotScramble · DotAegis · DotGhostBoard

---

## License

Licensed under the [Apache License 2.0](LICENSE). The license includes the warranty terms; this README adds no guarantee of complete secret detection or credential protection.
