# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-09-29

### Added
- ✨ **Initial Release of dotenvy** - Complete VS Code environment file manager
- 🌍 **Multi-workspace Support** - Manage environments across multiple workspace folders
- 🔄 **One-Click Environment Switching** - Seamlessly switch between `.env` files
- 📂 **Auto Environment Detection** - Automatically scans workspace for `.env.*` files
- 🌿 **Git Branch Auto-Switching** - Automatically switch environments based on Git branch
- ✅ **Environment Validation** - Validate environment files with custom rules and regex patterns
- 📄 **Environment Diff View** - Compare environment files side-by-side before switching
- 🔀 **Git Pre-commit Hooks** - Block commits containing secrets or invalid environments
- ☁️ **Cloud Sync with Doppler** - Sync environment files with Doppler secrets manager
- 🛡️ **Secrets Guard** - Scan for and warn about potential secrets in environment files
- 📊 **Status Bar Integration** - Real-time indicators for environment status and validation
- 💾 **Backup & Restore** - Automatic backups before environment changes
- 🎨 **Modern Web-based UI** - Sleek panel interface for environment management
- 🔧 **Custom Configuration** - `.dotenvy.json` for workspace-specific settings

### Features
- **Environment Switching**: Command palette and UI-based switching with diff preview
- **Validation Rules**: Required variables, type checking, and custom regex validators
- **Git Integration**: Branch-based auto-switching and pre-commit security checks
- **Cloud Providers**: Doppler integration with extensible provider architecture
- **Security**: Multi-layer secret detection and commit blocking
- **Multi-Environment**: Support for development, staging, production, and custom environments

### Technical
- **TypeScript**: Fully typed codebase with strict TypeScript compilation
- **VS Code API**: Native integration with VS Code extension points
- **Webview Integration**: Modern HTML/CSS/JavaScript UI panels
- **Command System**: Comprehensive command palette integration
- **Configuration Management**: Flexible settings with VS Code workspace storage
- **Test Suite**: VS Code extension testing framework support

### Documentation
- **README.md**: Complete installation and usage documentation
- **CONTRIBUTING.md**: Development setup and contribution guidelines
- **License**: MIT license for open-source usage

---

## Pre-Release Features (Development History)

### Security & Git Integration
- Git pre-commit hook system with secret blocking
- Flexible hook configuration per workspace
- Automatic gitignore management for config files

### Cloud Synchronization
- Doppler secrets manager integration
- Secure token storage via VS Code secrets API
- Pull/push synchronization with conflict handling
- Project and config mapping

### Environment Management
- Comprehensive environment file parsing
- Smart diff algorithms for environment comparison
- Backup restoration with configurable paths
- Multi-file environment support (.env.* patterns)

### User Experience
- Intuitive web-based panel interface
- Status bar integration with contextual information
- Command palette integration for all features
- Progressive disclosure of advanced features

### Developer Experience
- Hot reload development workflow
- Comprehensive linting and type checking
- Test framework integration
- VS Code extension development tooling

---

## Version History

- **1.0.0** - Initial stable release of dotenvy VS Code extension
