# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-11-16

### Added
- 🔐 **End-to-End Encrypted Cloud Sync**: Complete cloud synchronization with AES-256-GCM encryption protecting environment secrets
- **AES-256-GCM Encryption Core**: Industrial-strength encryption with authenticated encryption mode, 12-byte IV, and workspace-specific keys
- **EncryptedCloudSyncManager**: Transparent wrapper that encrypts before pushing to cloud and decrypts after pulling, with automatic key management
- **Cloud Encryption Configuration**: Added encryptCloudSync boolean flag to CloudSyncConfig with backward compatibility
- **Workspace-Specific Key Management**: Auto-generated per-workspace encryption keys stored securely in VSCode's globalState
- **Push Command Encryption Integration**: Modified pushToCloud command to detect encryption settings and use encrypted manager when enabled
- **Pull Command Decryption Integration**: Updated pullFromCloud command to handle encrypted payloads and decrypt automatically
- **Status Bar Encryption Indicators**: Added visual encryption status to status bar with 🔐 lock icon for encrypted connections
- **Extension Context Integration**: Properly integrated with VSCode extension context for secure key storage

### Enhanced
- 🛡️ **Enhanced Encryption Security Parameters (OWASP 2025 Compliance)**: Upgraded cryptographic parameters to modern security standards with format versioning and key rotation
- **PBKDF2 Parameter Enhancement**: Increased PBKDF2 iterations from 100,000 to 310,000 (OWASP 2025 recommended minimum) for stronger password-based key derivation
- **Enhanced Salt Management**: Increased salt length to 32 bytes (256-bit) and migrated salt storage to workspace-specific state for better isolation
- **Encryption Format Versioning**: Implemented format version 2 with full backward compatibility for existing encrypted variables (supports v1 migration)
- **Key Rotation Support**: Added EncryptionHealthUtils class with secure key rotation functionality for generating new master keys and re-encrypting variables
- **Enhanced Cloud Encryption Metadata**: Updated cloud encryption format to version 2.0 with algorithm metadata and improved payload structure
- **Encryption Health Monitoring**: Implemented health check utilities to assess encryption strength and recommend parameter updates
- **TypeScript Code Quality**: Fixed TypeScript linting issues including removal of 'any' types and proper type safety
- **Cryptographic Constants Transparency**: Made encryption parameters public for transparency while maintaining key secrecy (follows Kerckhoffs's principle)

### Technical
- **Encryption Algorithm**: AES-256-GCM with authenticated encryption (format v2)
- **PBKDF2 Parameters**: 310,000 iterations (OWASP 2025 compliant), 256-bit salt
- **Key Management**: Workspace-specific keys in VSCode globalState with key rotation support
- **Encryption Format**: Versioned format: 'ENC[version|iv|tag|ciphertext]' with v1/v2 compatibility
- **Architecture**: Transparent wrapper pattern around existing CloudSyncManager with health monitoring
- **Security Features**: End-to-end encryption, authenticated encryption, per-workspace keys, format versioning
- **Backward Compatibility**: Seamless migration from unencrypted to encrypted sync, format v1 compatibility

## [1.1.0] - 2025-11-08

### Added
- 🎨 **History Tree View**: Added tree-like organization to history viewer with collapsible sections and better categorization
- 🗂️ **Tabbed Main Interface**: Implemented tabbed interface for main panel with Overview, Environments, History, and Settings tabs
- 🏷️ **Smart Environment Categorization**: Added intelligent grouping of environment files by type (local, development, staging, production)
- 🔍 **Enhanced Search & Filtering**: Improved search functionality with advanced filters for environment management

### Enhanced
- **UI Organization**: Improved overall user interface organization and usability across the extension

## [1.0.2] - 2025-10-12

### Added
- 🧠 **AI-Powered Secret Detection**: Custom Large Language Model (LLM) service for superior secret analysis
- 🔬 **From-Scratch LLM Implementation**: Complete transformer architecture built in Python with custom attention mechanisms
- ⚡ **Real-time AI Analysis**: Sub-100ms inference with 14-dimensional feature extraction and transformer-based classification
- 🛡️ **Graceful Fallbacks**: Seamless degradation to traditional entropy analysis when AI service unavailable
- 🚀 **Automated LLM Service**: FastAPI-based Python service with automatic deployment and health monitoring
- 🎯 **Enhanced Confidence Levels**: AI-powered high/medium/low confidence scoring replacing rule-based analysis
- 🔄 **Adaptive Learning Infrastructure**: Model training infrastructure for continuous accuracy improvement
- 🏗️ **Hybrid Architecture**: TypeScript extension communicates with Python LLM via HTTP with robust error handling

### Enhanced
- **Secrets Guard**: Upgraded from entropy-based to AI-powered secret detection with transformer confidence
- **Real-time Scanning**: LLM integration provides more accurate file-based secret monitoring
- **Performance Optimization**: LLM service isolates heavy computations from VS Code extension environment
- **User Experience**: No interruption in functionality when LLM service is offline (automatic fallback)

### Technical
- **Python LLM Service**: Complete transformer implementation with multi-head attention and layer normalization
- **REST API Integration**: HTTP client with timeout, retry, and error recovery mechanisms
- **Feature Engineering**: 14 carefully crafted features capturing entropy, patterns, context, and variable analysis
- **Model Architecture**: 4-layer transformer with 256 hidden dimensions and 8 attention heads
- **Production Ready**: Automated deployment, service management, and comprehensive error handling
- **Memory Efficient**: ~50MB serialized model with optimized inference performance

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
- **Security**: Multi-layer secret detection powered by **Custom Large Language Model (LLM)** and commit blocking
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
