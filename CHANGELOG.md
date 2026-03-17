# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-03-13

### **LLM Integration Upgrade + HMAC Security** — Production-Grade ML Secret Detection
Complete overhaul of the AI-powered secret detection backend with HMAC authentication, 35-feature ML model, two-tier caching, and SSE streaming.

#### **HMAC Authentication — No More API Key in Extension**
- **Zero API Key Exposure**: Extension no longer holds any real API key — only a shared secret used for signing
- **HMAC-SHA256 Signing**: Every request to the LLM service is signed with `X-Extension-Timestamp` + `X-Extension-Signature` headers
- **Replay Attack Protection**: 5-minute timestamp window prevents request replay attacks
- **Per-Device Rate Limiting**: `X-Machine-ID` header enables per-device rate limiting (30 req/min) on the server
- **Secure Build Pipeline**: `build-with-env.js` injects `EXTENSION_SHARED_SECRET` at build time — excluded from published package via `.vscodeignore`
- **Circuit Breaker**: 3-failure threshold opens circuit for 60 seconds, preventing cascade failures

#### **35-Feature ML Model (Upgraded from 19)**
- **6 Basic Text Features**: uppercase ratio, lowercase ratio, digit ratio, special chars, length normalization, unique char ratio
- **3 Entropy Features**: Shannon entropy + bigram entropy + trigram entropy
- **3 Pattern Features**: known secret prefix detection, Base64 encoding, hex encoding
- **5 Context Risk Features**: auth/key/secret keywords, bearer tokens, database URLs, cloud provider signals, payment keywords
- **4 Variable Name Features**: key/secret/token naming, env var convention (ALL_CAPS), const naming, variable length
- **4 Structural Features**: dash, underscore, dot, slash presence
- **10 Derived Features**: threshold flags and feature combinations
- **TypeScript Mirror**: `extractFeatures()` method in extension matches Python backend exactly (for offline use + testing)

#### ⚡ **Two-Tier Cache — 18.4x Speedup**
- **L1 Cache**: In-process LRU (500 items, 5-minute TTL) — sub-millisecond hits
- **L2 Cache**: Redis (1-hour TTL) — shared across instances
- **Smart TTL**: high confidence=24h, medium=1h, low=5min
- **Graceful Degradation**: Falls back to L1-only if Redis is unavailable
- **Measured Performance**: 18.4x speedup on repeated requests in production

#### **SSE Streaming Endpoint**
- **Progressive Analysis**: Results stream in 5 stages via Server-Sent Events
- `pattern_match` (20%) → `entropy` (40%) → `context` (65%) → `llm_analysis` (85%) → `final` (100%)
- **HMAC Authenticated**: Same security as the standard endpoint
- **Endpoint**: `POST /extension/analyze/stream`

#### **Python Service Refactor — 600 Lines → 9 Files**
Complete restructure of the Railway backend for maintainability:
- `service.py` — ~60 lines, app wiring only
- `analyzer.py` — LLMAnalyzer + cache singleton
- `security.py` — JWT, rate limiting, auth dependencies
- `middleware.py` — monitoring + security headers middleware
- `models.py` — Pydantic request/response schemas
- `routes/analyze.py` — `/analyze` + `/extension/analyze` + `/extension/analyze/stream`
- `routes/train.py` — `/train` + `/reset`
- `routes/stats.py` — `/stats` + `/health` + `/cache/*` + `/performance/*`
- `routes/versioning.py` — `/versions/*` + `/ab/*`

#### **Test Coverage**
- **18/18** python-llm tests passing on Railway production
- **12/12** TypeScript extension tests passing
- Covers: HMAC auth, confidence levels, circuit breaker, 35-feature extraction, fallback, streaming

---

## [1.4.0] - 2026-01-26

### **Portable Backup Encryption Enhancement** - Cross-Device Backup Revolution
Complete implementation of password-based encryption (PBE) for backups, eliminating VSCode SecretStorage dependency and enabling truly portable encrypted backups across any device.

#### **Password-Based Encryption (PBE) Architecture**
- **OWASP 2025 Compliance**: PBKDF2 with 310,000 iterations for industry-standard password hashing
- **Device Independence**: Backups work on any device with just user's password - no VSCode dependency
- **Salt Management System**: Per-backup salt generation, storage in encrypted files, and extraction for consistent key derivation
- **AES-256-GCM Encryption**: Authenticated encryption with embedded salt in backup payload format
- **Cross-Platform Portability**: Take encrypted backups to any machine, enter password, restore successfully

#### **Enhanced Backup Creation & Restoration**
- **Backup Creation UX**: User enters password → PBKDF2 key derivation → AES-GCM encryption with salt → Portable backup created
- **Backup Restoration UX**: User selects file → Salt extraction → Password prompt → File decryption with password-derived key
- **Salt Extraction Utility**: Automatic salt extraction from encrypted backup files before password prompt
- **Enhanced Encryption Format**: Base64 encoded JSON: {v, iv, ct, tag, s} with salt included for portability
- **Backward Compatibility**: Support both old SecretStorage and new PBE methods seamlessly

#### **Security & Error Handling**
- **Brute-Force Resistance**: High iteration count PBKDF2 prevents password cracking attempts
- **Rainbow Table Protection**: Per-file salt generation prevents precomputed attack vectors
- **Authenticated Encryption**: AES-GCM provides integrity verification and tamper detection
- **Clear Error Messages**: User-friendly feedback for incorrect passwords and corrupted backup files
- **Security Model**: Password-based encryption eliminating VSCode SecretStorage dependency vulnerability

#### **User Experience Enhancements**
- **Intuitive Password Prompts**: Clear guidance for password entry with proper validation
- **Progress Feedback**: Loading states and progress indicators for encryption/decryption operations
- **Error Recovery**: Graceful handling of corrupted files and wrong password attempts
- **Cross-Device Workflow**: Seamless backup transfer and restoration across different machines
- **Professional UX**: Consistent with existing extension patterns and VS Code design principles

#### **Technical Implementation**
- **PBKDF2 Key Derivation**: 310,000 iterations with 256-bit derived keys and per-file salt generation
- **Salt Management**: 16-byte random salt generated per backup, embedded in encrypted payload
- **Encryption Format**: Versioned format supporting both legacy and new PBE methods
- **File Format**: Base64 encoded JSON structure with version, IV, ciphertext, auth tag, and salt
- **Security Standards**: Following OWASP 2025 password hashing guidelines and modern encryption practices

### **Technical Enhancements**
- **AES-256-GCM Authenticated Encryption**: Industry-standard encryption with embedded salt for portability
- **PBKDF2 Key Derivation**: 310,000 iterations with per-backup salt generation for security
- **Salt Storage Integration**: Salt embedded within encrypted backup format for consistent decryption
- **Cross-Device Compatibility**: Eliminates VSCode SecretStorage dependency for true portability
- **Error Handling**: Comprehensive validation and user-friendly error messages
- **Backward Compatibility**: Seamless support for existing SecretStorage-based backups
- **Security Model**: Password-based encryption following modern cryptographic best practices

### **Documentation & Testing**
- **Comprehensive Test Coverage**: Backup creation, restoration, cross-device scenarios, and error handling
- **Security Architecture Review**: Complete analysis of PBE implementation and OWASP compliance
- **User Experience Testing**: Cross-device backup workflows and password management scenarios
- **Code Quality Standards**: Enhanced TypeScript compilation and security-focused code review

---

## [1.3.0] - 2025-12-28

### 🛡️ **Multi-User Key Wrapping (Envelope Encryption)** - Enterprise-Grade Security
Complete implementation of envelope encryption enabling secure multi-user access to environment secrets without shared passwords. Each team member gets individual credentials while maintaining centralized project key management.

#### 🔐 **Key Wrapping Architecture**
- **Envelope Encryption**: Project keys are wrapped with individual user passwords using AES-256-GCM
- **Zero Shared Secrets**: Each developer has unique PBKDF2-derived credentials (310,000 iterations, OWASP 2025 compliant)
- **Individual Authentication**: Per-user access control with complete audit trail via Git
- **Instant Revocation**: Remove user access immediately without password rotation for entire team
- **Forward Secrecy**: Revoked users lose access instantly with no cryptographic dependencies

#### 👥 **User Management System**
- **Init Secure Project**: Create admin user and establish encrypted project foundation
- **Add User**: Invite team members with individual password-based access envelopes
- **Revoke User**: Instantly remove access with admin verification and self-revocation protection
- **Login to Secure Project**: Authenticate individual users and establish session access
- **Git-Based Audit Trail**: Complete non-repudiation with all user management operations tracked in version control

#### 🔒 **Individual Variable Encryption UI**
- **Lock/Unlock Toggle**: Interactive 🔒/🔓 icons for granular control over individual environment variables
- **Real-time Encryption**: Encrypt/decrypt specific variables with visual feedback and loading states
- **Professional UI**: Modern CSS styling with hover effects and responsive design
- **State Management**: Rich variable tracking with encryption status and UI synchronization

#### 🛡️ **Critical Security Fixes**
- **Data Loss Bug Fix**: Resolved critical password change bug that caused permanent encrypted variable loss
- **Enhanced Input Validation**: Comprehensive validation for encrypted data format, base64 encoding, and component sizes
- **OWASP 2025 Compliance**: Updated cryptographic parameters with modern security standards
- **Workspace Key Management**: Fixed encryption key accessibility issues when workspace folders change
- **Cloud Sync Security**: Improved encrypted payload lookup with exact key matching

#### 🔔 **Professional Update System**
- **What's New Notifications**: Automatic version update notifications with changelog access
- **Native Integration**: VS Code markdown preview for professional changelog display
- **Welcome Messages**: Appropriate messaging for new vs returning users
- **Persistent State**: Version tracking to avoid repeated notifications

#### 📊 **Advanced User Experience**
- **Fail-Fast Validation**: Early username availability checking prevents wasted user input
- **Progress Indicators**: Professional loading bars for encryption and user management operations
- **QuickPick Interfaces**: Intuitive user selection with rich metadata display (username, role, access time)
- **Modal Confirmations**: Critical operation safeguards with explicit user consent
- **Comprehensive Error Handling**: User-friendly messages with actionable guidance

#### 🏗️ **Architecture & Code Quality**
- **Constants Centralization**: Organized all hardcoded values into maintainable constants file
- **TypeScript Enhancements**: Complete type safety with proper interfaces and removed 'any' usage
- **ESLint Compliance**: Resolved all linting issues and improved code standards
- **Session Management**: In-memory secure storage for decrypted project keys with VS Code integration
- **Hybrid Mode Support**: Seamless fallback between multi-user and legacy single-password systems

### 🔧 **Technical Enhancements**
- **AES-256-GCM Authenticated Encryption**: Industry-standard encryption with 12-byte IV and 16-byte auth tags
- **PBKDF2 Key Derivation**: 310,000 iterations with 256-bit salts per OWASP 2025 recommendations
- **Git Integration**: Distributed audit trail eliminating single points of failure
- **Zero-Knowledge Design**: Project keys never exist in plaintext outside encrypted memory
- **Enterprise Security Model**: Following AWS/Google cloud envelope encryption patterns
- **TypeScript Type Safety**: Comprehensive interfaces ensuring protocol compliance
- **VSCode Lifecycle Management**: Proper extension integration with activation and command registration

### 📚 **Documentation & Testing**
- **Comprehensive Test Coverage**: Extended master key migration tests with malformed data validation
- **Security Architecture Review**: Complete review of dual encryption systems and OWASP compliance
- **Code Quality Improvements**: Enhanced TypeScript compilation and linting standards
- **Professional UX Patterns**: Modal confirmations, progress feedback, and fail-fast validation

---

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

- **1.5.0** - HMAC security + 35-feature ML model + two-tier cache + SSE streaming + service refactor
- **1.4.0** - Portable backup encryption (PBE) with PBKDF2 + AES-256-GCM
- **1.3.0** - Multi-user key wrapping (envelope encryption) + user management
- **1.2.0** - End-to-end encrypted cloud sync
- **1.1.0** - History tree view + tabbed interface
- **1.0.2** - AI-powered secret detection (LLM v1)
- **1.0.0** - Initial stable release