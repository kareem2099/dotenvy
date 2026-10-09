# dotenvy – VS Code Environment Manager

[![Version](https://img.shields.io/badge/version-2.2.3-blue.svg)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)
[![Codename](https://img.shields.io/badge/codename-Aegis-orange.svg)](https://github.com/kareem2099/dotenvy/releases/tag/v2.2.3)
[![Publisher](https://img.shields.io/badge/publisher-FreeRave-red.svg)](https://marketplace.visualstudio.com/publishers/FreeRave)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![VS Code Marketplace](https://img.shields.io/badge/vscode-marketplace-007ACC)](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)

<div align="center">
  <img width="800" alt="DotEnvy Variable Manager" src="https://github.com/user-attachments/assets/46565ce7-fa75-4d39-b582-e32ebcdee0f1" />
</div>

**dotenvy** switches `.env` files inside VS Code, keeps a history of those files, and scans the workspace for secrets.

**[Install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy)** · **[Issues](https://github.com/kareem2099/dotenvy/issues)**

---

## Features

### Environment switching

Switch between `.env.development`, `.env.staging`, `.env.production`, or any other discovered `.env.*` file. The chosen file is copied to `.env`. A backup of the previous `.env` is written first.

### Languages

English, Italian, Arabic (including RTL), and Russian. The sidebar language control updates commands, notifications, and the webview panels without restarting VS Code.

### Sidebar

The environment view is a compact sidebar for narrow layouts, with an onboarding banner on a new workspace.

<img width="100%" alt="Environment Switcher" src="https://github.com/user-attachments/assets/c2139b3c-4dfc-4a3c-86b5-adf0b7b7fa89" />

### Doppler sync

Push and pull go through Doppler. Several local `.env` files can share one Doppler config: `cloudSync.envTargets` routes keys by `keyPrefix` (longer prefixes win) or by `prefixes`. `pushMode` is `replace` (remote keys absent locally are removed) or `merge`. Project names from `package.json`, the folder, or `.dotenvy.json` become Doppler slugs: dots, underscores, and spaces turn into hyphens (`project.webservice` → `project-webservice`) before every API call.

A pull merges into each local file. Comments, blank lines, key order, and inline `#` suffixes stay. Keys removed in Doppler are dropped. New keys are appended. Before that write, the previous file is copied to a sibling `.backup` (`.env` → `.env.backup`, `backend/.env.local` → `backend/.env.local.backup`). Pull then adds this line to the workspace `.gitignore` when it is missing:

```gitignore
.env*.backup
```

The pattern has no slash, so it matches those backups in every directory. A backup that Git already tracks stays tracked until you run `git rm --cached` on it.

**DotEnvy: Diff Cloud Secrets** compares the merged local keys with Doppler and does not write files.

Cloud payloads are encrypted with AES-256-GCM unless `encryptCloudSync` is `false`. The data key is random. The first encrypted push asks for a passphrase (at least 8 characters) that wraps the key with PBKDF2 and AES-256-GCM. Doppler stores the wrap, its salt, and the iteration count, so another machine unlocks the same payload with that passphrase. Pull does not create a new key. A push that cannot decrypt the remote payload stops instead of replacing it. A payload uploaded before the wrap exists opens only on the machine that still has the data key, until that machine pushes once. The previous workspace key is left in place so another Doppler config in the same workspace can still be opened.

### Discovery

The extension finds `.env.*` files in the workspace, including nested folders, and skips `node_modules`. The root `.env` is the active file, so it is not listed as a switch target. `.env.example`, `.env.backup`, and `.env.template` are excluded.

### Git branch switching

With `autoSwitchOnBranchChange` and `gitBranchMapping` in `.dotenvy.json`, a branch checkout can select the mapped environment.

### Validation and diff

Validation checks syntax, required variables, and types (`string`, `number`, `boolean`, `url`, or a custom regex). **DotEnvy: Diff Environment Files** compares two files before you switch.

<img width="100%" alt="Native Diff Demo" src="https://github.com/user-attachments/assets/d3905fa6-6b1c-478f-ba50-a993d45515d7" />

### Git commit hook

**DotEnvy: Install Git Commit Hook** installs a pre-commit hook. By default it blocks staged `.env` files. It can also block secrets and validation errors. The hook resolves the Git root, so it works in a monorepo.

### History, trash, and analytics

History records environment changes. The timeline and analytics panels summarize that history. The session trash bin restores a variable deleted in the current session.

<img width="100%" alt="Trash Bin Demo" src="https://github.com/user-attachments/assets/7a84cb1a-2b6e-447e-9c7c-8510d266b4b0" />

<img width="100%" alt="Analytics Dashboard" src="https://github.com/user-attachments/assets/70b17cee-f866-42f0-922d-0942d181fe48" />

### Backups

**DotEnvy: Backup Current Environment** and **DotEnvy: Restore from Backup** use AES-256-GCM when backup encryption is on (the default).

### Secure project

**DotEnvy: Init Secure Project**, **Add User to Secure Project**, **Login to Secure Project**, and **Revoke User Access** manage a password-protected project lock. The last admin cannot be revoked.

### Status bar

The status bar shows the active environment, validation, the Git hook, and cloud sync.

### Secret scan

**DotEnvy: Scan for Secrets** walks the workspace and opens a panel of findings. You can filter by confidence, open a match, move it into `.env`, or mark it as not a secret. `.dotenvyignore` uses `.gitignore` syntax. Lockfiles, `node_modules`, and other built-in paths are skipped even without that file.

Detection runs on the machine first: known key shapes, a local community-hash list, then entropy. A candidate is sent to `https://aegis.dotsuite.dev` only after those checks. The request is HMAC-SHA256 over the timestamp and body, with the device secret from VS Code Secret Storage. If the service is unreachable, a local score from the same 35-feature vector decides the confidence. Details are in [LLM_ARCHITECTURE_SUMMARY.md](LLM_ARCHITECTURE_SUMMARY.md).

A scan does not upload the workspace. The remote call sends the candidate value, its surrounding context, and the variable name. **Not a Secret** and **Move to .env** store that sample in VS Code global state and, once a device secret exists, upload the value, context, variable name, the 35-number vector, and the action.

---

## Commands

Open the Command Palette with `Ctrl+Shift+P` or `⌘+Shift+P`.

### Environments

- **DotEnvy: Switch Environment**
- **DotEnvy: Open Main Dashboard**
- **DotEnvy: Open Variable Manager**
- **DotEnvy: Validate Environment Files**
- **DotEnvy: Diff Environment Files**
- **DotEnvy: Compare Environments** — same key, different values across discovered `.env` files
- **DotEnvy: Backup Current Environment**
- **DotEnvy: Restore from Backup**

### History

- **DotEnvy: View Environment History**
- **DotEnvy: Open History Panel**
- **DotEnvy: Open Timeline Panel**
- **DotEnvy: Open Analytics Panel**
- **DotEnvy: Open Session Trash Bin**

### Git

- **DotEnvy: Install Git Commit Hook**
- **DotEnvy: Remove Git Commit Hook**

### Doppler

- **DotEnvy: Pull Environment from Cloud**
- **DotEnvy: Push Environment to Cloud**
- **DotEnvy: Diff Cloud Secrets** — keys only in Doppler, only local, or with different values, without writing files

### Secrets

- **DotEnvy: Scan for Secrets**
- **DotEnvy: Init .dotenvyignore**
- **DotEnvy: Ignore this path** — Explorer context menu on a file or folder
- **DotEnvy: Setup LLM Secret** — stores the device secret used to sign analysis requests
- Open editors underline a local pattern match while you type and add a `dotenvy-secrets` problem. That check does not call the analysis service. The pre-commit hook uses the same local scan.
- The secrets panel shows how many findings this installation confirmed, marked as not a secret, or has not sent yet.

### Secure project

- **DotEnvy: Init Secure Project**
- **DotEnvy: Add User to Secure Project**
- **DotEnvy: Login to Secure Project**
- **DotEnvy: Revoke User Access**

### Support

- **DotEnvy: Feedback & Support**
- **DotEnvy: Show What's New**

---

## .dotenvyignore

Same pattern rules as `.gitignore`: `*` stays inside one path segment, `**` crosses directories, and `!` un-ignores a pattern.

```gitignore
.dotenvy/**
.dotenvy-backups/**
**/*.test.ts
**/*.spec.ts
docs/**
README.md
```

**DotEnvy: Init .dotenvyignore** writes a starter file. If the file already exists, the command opens it.

---

## Installation

1. Open Extensions (`Ctrl+Shift+X` or `⌘+Shift+X`).
2. Search for **dotenvy**.
3. Install.

You can also install a `.vsix` from the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=FreeRave.dotenvy). VS Code **1.90.0** or later is required.

---

## Usage

1. Add environment files to the project:

    ```text
    .env.development
    .env.staging
    .env.production
    ```

2. Run **DotEnvy: Switch Environment** and pick one.

3. That file is copied to `.env`. The status bar shows the active environment.

---

## Configuration

`.dotenvy.json` in the workspace root:

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
  },
  "cloudSync": {
    "provider": "doppler",
    "project": "your-project-name",
    "config": "development",
    "token": "dp.pt.your_token_here",
    "encryptCloudSync": true,
    "pushMode": "replace",
    "envTargets": [
      { "file": "backend/.env", "keyPrefix": "BACKEND_" },
      { "file": "frontend/.env", "prefixes": ["VITE_"] },
      { "file": ".env", "catchAll": true }
    ]
  }
}
```

`autoSwitchOnBranchChange` defaults to off. `encryptCloudSync` defaults to on. With encryption on, the first push asks for a passphrase that wraps the data key so other machines can pull. Without that wrap, pull works only on the machine that created the key. A later pull does not mint a replacement key, and a push that cannot open the remote payload does not overwrite it. The Doppler token is read from `cloudSync.token`, from the `DOPPLER_TOKEN` environment variable, or from VS Code Secret Storage under `doppler:<project>:token`. `cloudSync.project` is stored as a Doppler slug. The only implemented `provider` is `doppler`. After a pull finds env files to sync, dotenvy appends `.env*.backup` to `.gitignore` when that line is not already there.

Editor settings under **DotEnvy** cover the backup folder, backup encryption, and history retention.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and [CI-CD-README.md](CI-CD-README.md) for the GitHub Actions workflow.

## Contributors

Thanks to **[@FaberVi](https://github.com/FaberVi)** for the Italian localization, the sidebar language switcher, the compact sidebar, and Doppler multi-file sync in [PR #2](https://github.com/kareem2099/dotenvy/pull/2).

## License

Apache License, Version 2.0. See [LICENSE](LICENSE).
