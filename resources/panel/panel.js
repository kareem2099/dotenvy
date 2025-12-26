const vscode = acquireVsCodeApi();

// Modern Panel State
let currentDashboardData = null;
let isLoading = false;
let animationQueue = [];

// Modern Animation Utilities
const animations = {
    fadeIn: (element, duration = 300) => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(20px)';
        element.style.transition = `all ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;

        requestAnimationFrame(() => {
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';
        });
    },

    slideIn: (element, direction = 'left', duration = 300) => {
        const translate = direction === 'left' ? 'translateX(-20px)' : 'translateX(20px)';
        element.style.opacity = '0';
        element.style.transform = translate;
        element.style.transition = `all ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;

        requestAnimationFrame(() => {
            element.style.opacity = '1';
            element.style.transform = 'translateX(0)';
        });
    },

    pulse: (element) => {
        element.style.animation = 'pulse 0.6s ease-in-out';
        setTimeout(() => {
            element.style.animation = '';
        }, 600);
    },

    shimmer: (element) => {
        element.style.position = 'relative';
        element.style.overflow = 'hidden';

        const shimmer = document.createElement('div');
        shimmer.style.position = 'absolute';
        shimmer.style.top = '0';
        shimmer.style.left = '-100%';
        shimmer.style.width = '100%';
        shimmer.style.height = '100%';
        shimmer.style.background = 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)';
        shimmer.style.animation = 'shimmer 1.5s ease-in-out';

        element.appendChild(shimmer);
        setTimeout(() => shimmer.remove(), 1500);
    }
};

// Modern Loading States
const loadingStates = {
    showSkeleton: (container) => {
        container.innerHTML = `
            <div class="skeleton" style="height: 120px; border-radius: 20px; margin-bottom: 1.5rem;"></div>
            <div class="skeleton" style="height: 80px; border-radius: 16px; margin-bottom: 1rem;"></div>
            <div class="skeleton" style="height: 80px; border-radius: 16px;"></div>
        `;
    },

    showCardSkeleton: (container) => {
        container.innerHTML = `
            <div class="env-card-skeleton">
                <div class="skeleton" style="height: 60px; border-radius: 16px 16px 0 0;"></div>
                <div style="padding: 1.5rem;">
                    <div class="skeleton" style="height: 20px; width: 60%; margin-bottom: 0.5rem;"></div>
                    <div class="skeleton" style="height: 16px; width: 40%; margin-bottom: 1rem;"></div>
                    <div style="display: flex; gap: 0.5rem;">
                        <div class="skeleton" style="height: 32px; width: 80px; border-radius: 12px;"></div>
                        <div class="skeleton" style="height: 32px; width: 80px; border-radius: 12px;"></div>
                    </div>
                </div>
            </div>
        `;
    }
};

// Modern Button Interactions
const buttonEffects = {
    addRipple: (event) => {
        const button = event.currentTarget;
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        const ripple = document.createElement('span');
        ripple.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            left: ${x}px;
            top: ${y}px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            transform: scale(0);
            animation: ripple 0.6s linear;
            pointer-events: none;
        `;

        button.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    },

    addHoverEffect: (button) => {
        button.addEventListener('mouseenter', () => {
            animations.pulse(button.querySelector('.btn-icon') || button);
        });
    }
};

// Enhanced CSS for animations
const addAnimationStyles = () => {
    if (!document.getElementById('modern-animations')) {
        const style = document.createElement('style');
        style.id = 'modern-animations';
        style.textContent = `
            @keyframes ripple {
                to {
                    transform: scale(4);
                    opacity: 0;
                }
            }

            .env-card-skeleton {
                background: var(--glass-bg);
                backdrop-filter: blur(20px);
                border: 1px solid var(--glass-border);
                border-radius: 16px;
                overflow: hidden;
                box-shadow: var(--shadow-md);
                animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }

            .btn-icon {
                transition: transform var(--transition-fast);
            }

            .card-icon {
                transition: transform var(--transition-fast);
            }

            .dashboard-card:hover .card-icon,
            .btn:hover .btn-icon {
                transform: scale(1.1);
            }

            .loading-dots::after {
                content: '';
                animation: loadingDots 1.5s infinite;
            }

            @keyframes loadingDots {
                0%, 20% { content: ''; }
                40% { content: '.'; }
                60% { content: '..'; }
                80%, 100% { content: '...'; }
            }
        `;
        document.head.appendChild(style);
    }
};

// ============================
// DASHBOARD FUNCTIONS
// ============================

function updateDashboard(data) {
    console.log('📊 Updating dashboard with data:', data);
    currentDashboardData = data;

    // Update status card
    updateStatusCard(data);

    // Update cloud card
    updateCloudCard(data);

    // Update git hook card
    updateGitHookCard(data);

    // Update validation card
    updateValidationCard(data);

    // Update environments grid with enhanced animations
    updateEnvironmentsGrid(data);

    // Update current environment section
    updateCurrentEnvironment(data);

    // Update backup settings
    updateBackupSettings(data);

    console.log('✅ Dashboard update complete');
}

// Fallback dashboard display when DOM elements are missing
function showFallbackDashboard(data) {
    console.log('🔄 Showing fallback dashboard...', data);
    try {
        // Create a simple fallback display
        const mainContainer = document.querySelector('.dashboard') || document.getElementById('dashboard') || document.body;

        if (mainContainer) {
            // Show a basic status message
            const fallbackMessage = document.createElement('div');
            fallbackMessage.style.cssText = `
                padding: 2rem;
                text-align: center;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 12px;
                margin: 20px;
                color: var(--vscode-foreground);
            `;

            const envCount = data.environments ? data.environments.length : 1;
            const currentEnv = data.currentEnvironment || data.currentFile ? data.currentFile.name : 'local';

            fallbackMessage.innerHTML = `
                <h3 style="margin-bottom: 1rem; color: var(--vscode-foreground);">Dashboard Ready</h3>
                <p>Environments: <strong>${envCount}</strong></p>
                <p>Current: <strong>${currentEnv}</strong></p>
                <p style="font-size: 0.9em; opacity: 0.8;">Dashboard loaded successfully</p>
            `;

            // Only replace if there's a basic container
            if (mainContainer.children.length === 0) {
                mainContainer.appendChild(fallbackMessage);
            }
        }

        console.log('✅ Fallback dashboard displayed');
    } catch (error) {
        console.error('❌ Error showing fallback dashboard:', error);
    }
}

function updateStatusCard(data) {
    console.log('📊 Updating status card with data:', data);
    const envCountEl = document.getElementById('env-count');
    const currentEnvEl = document.getElementById('current-env');

    if (envCountEl && currentEnvEl) {
        const envCount = ((data.environments && data.environments.length) || 0) + (data.currentFile ? 1 : 0);
        const currentEnv = data.currentEnvironment || 'None';

        envCountEl.textContent = envCount;
        currentEnvEl.textContent = currentEnv;

        console.log(`✅ Status card updated: ${envCount} environments, current: ${currentEnv}`);
    } else {
        console.error('❌ Status card elements not found:', {
            envCountEl: !!envCountEl,
            currentEnvEl: !!currentEnvEl
        });
        // Debug: List all elements with IDs
        const elementsWithIds = document.querySelectorAll('[id]');
        console.log('Available element IDs:', Array.from(elementsWithIds).map(el => el.id));

        // Fallback: Set default content if elements exist but are empty
        if (envCountEl) envCountEl.textContent = '1';
        if (currentEnvEl) currentEnvEl.textContent = 'local';
    }
}

function updateCloudCard(data) {
    console.log('☁️ Updating cloud card with data:', data);
    const statusEl = document.getElementById('cloud-status');
    const lastSyncEl = document.getElementById('last-sync');

    if (statusEl && lastSyncEl) {
        // Default cloud sync status
        const cloudStatus = {
            connected: false,
            lastSync: null
        };

        // Update with actual data if available
        if (data.cloudSync) {
            Object.assign(cloudStatus, data.cloudSync);
        }

        const status = cloudStatus.connected ? 'Connected' : 'Not Connected';
        const statusClass = cloudStatus.connected ? 'status-connected' : 'status-disconnected';

        statusEl.innerHTML = `<span class="status-indicator ${statusClass}">${status}</span>`;
        lastSyncEl.innerHTML = `<span class="sync-time">Last: ${cloudStatus.lastSync ? formatTimeDiff(cloudStatus.lastSync) : 'Never'}</span>`;

        console.log(`✅ Cloud card updated: ${status}`);
    } else {
        console.error('❌ Cloud card elements not found');
    }
}

function updateGitHookCard(data) {
    console.log('🔗 Updating git hook card with data:', data);
    const statusEl = document.getElementById('hook-status');

    if (statusEl) {
        // Default git hook status
        const hookStatus = {
            installed: false
        };

        // Update with actual data if available
        if (data.gitHook) {
            Object.assign(hookStatus, data.gitHook);
        }

        const status = hookStatus.installed ? 'Installed' : 'Not Installed';
        const statusClass = hookStatus.installed ? 'status-active' : 'status-warning';

        statusEl.innerHTML = `<span class="status-indicator ${statusClass}">${status}</span>`;

        console.log(`✅ Git hook card updated: ${status}`);
    } else {
        console.error('❌ Git hook card elements not found');
    }
}

function updateValidationCard(data) {
    console.log('✅ Updating validation card with data:', data);
    const statusEl = document.getElementById('validation-status');
    const errorsEl = document.getElementById('validation-errors');

    if (statusEl && errorsEl) {
        // Default validation status
        const validationStatus = {
            valid: true,
            errors: 0
        };

        // Update with actual data if available
        if (data.validation) {
            Object.assign(validationStatus, data.validation);
        }

        const status = validationStatus.valid ? 'Valid' : 'Invalid';
        const statusClass = validationStatus.valid ? 'status-valid' : 'status-invalid';

        statusEl.innerHTML = `<span class="status-indicator ${statusClass}">${status}</span>`;

        if (validationStatus.errors && validationStatus.errors > 0) {
            errorsEl.innerHTML = `<span class="error-count">${validationStatus.errors} errors</span>`;
            errorsEl.style.display = 'block';
        } else {
            errorsEl.style.display = 'none';
        }

        console.log(`✅ Validation card updated: ${status} (${validationStatus.errors} errors)`);
    } else {
        console.error('❌ Validation card elements not found');
    }
}

// ============================
// ENVIRONMENT GRID FUNCTIONS
// ============================

function updateEnvironmentsGrid(data) {
    const container = document.getElementById('environments-list');

    if (!data.hasWorkspace) {
        container.innerHTML = `
            <div class="welcome-message">
                <h3>Welcome to dotenvy! 🎉</h3>
                <p>dotenvy helps you manage environment variables for your projects.</p>
                <p>To get started, open a workspace folder that contains your .env files.</p>
                <button class="btn btn-primary" onclick="openWorkspace()">Open Workspace Folder</button>
            </div>
        `;
        return;
    }

    if (!data.environments || data.environments.length === 0) {
        container.innerHTML = '<p>No .env.* files found. Create one to get started!</p>';
        return;
    }

    container.innerHTML = '';
    data.environments.forEach(env => {
        container.appendChild(createEnvironmentCard(env));
    });
}

function createEnvironmentCard(env) {
    const card = document.createElement('div');
    card.className = `env-card ${env.isActive ? 'active' : ''}`;

    // Count variables in environment (rough estimate from backend)
    const varCount = env.variableCount || 0;

    card.innerHTML = `
        <div class="env-card-header">
            <div class="env-card-title">
                <span class="env-card-icon">${env.isActive ? '🔵' : '⚪'}</span>
                <h4 class="env-name">${env.name}</h4>
            </div>
            <div class="env-card-stats">
                <span>${varCount} vars</span>
                <span>${formatFileSize(env.fileSize || 0)}</span>
            </div>
        </div>
        <div class="env-card-actions">
            <button class="btn btn-primary btn-sm" onclick="switchTo('${env.name}')">Switch</button>
            <button class="btn btn-secondary btn-sm" onclick="diffWithCurrent('${env.name}')">Compare</button>
            <button class="btn btn-secondary btn-sm" onclick="editFile('${env.fileName}')">Edit</button>
        </div>
    `;

    return card;
}

function updateCurrentEnvironment(data) {
    const section = document.getElementById('current-env-section');
    const content = document.getElementById('current-env-content');

    if (!data.currentFile) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    content.textContent = data.currentFile.content;
}

function updateBackupSettings(data) {
    try {
        const backupPathEl = document.getElementById('backup-path-display');
        const encryptCheckbox = document.getElementById('encrypt-backups-checkbox');

        if (backupPathEl) {
            if (data.backupSettings && data.backupSettings.path && data.backupSettings.path.trim() !== '') {
                backupPathEl.textContent = data.backupSettings.path;
            } else {
                // Use a default path since we can't access os module in webview
                const workspaceName = 'default';
                backupPathEl.textContent = `~/.dotenvy-backups/${workspaceName}`;
            }
        }

        if (encryptCheckbox) {
            encryptCheckbox.checked = (data.backupSettings && data.backupSettings.encrypt) || false;
        }
    } catch (error) {
        console.warn('Error updating backup settings:', error);
    }
}

// ============================
// ACTION FUNCTIONS
// ============================

function switchTo(envName) {
    vscode.postMessage({
        type: 'switchEnvironment',
        environment: envName
    });
}

function editFile(fileName) {
    vscode.postMessage({
        type: 'editFile',
        fileName: fileName
    });
}

function diffWithCurrent(envName) {
    vscode.postMessage({
        type: 'diffEnvironment',
        environment: envName
    });
}

function backupCurrentEnv() {
    vscode.postMessage({
        type: 'backupCurrentEnv'
    });
}

function diffEnvironments() {
    vscode.postMessage({
        type: 'diffEnvironment'
    });
}

function editCurrentEnv() {
    vscode.postMessage({
        type: 'editFile',
        fileName: '.env'
    });
}

function createEnvFile() {
    vscode.postMessage({
        type: 'createEnvironment'
    });
}

function pullFromCloud() {
    vscode.postMessage({
        type: 'pullFromCloud'
    });
}

function pushToCloud() {
    vscode.postMessage({
        type: 'pushToCloud'
    });
}

function manageGitHook() {
    vscode.postMessage({
        type: 'manageGitHook'
    });
}

function validateEnvironments() {
    vscode.postMessage({
        type: 'validateEnvironment'
    });
}

function installHook() {
    vscode.postMessage({
        type: 'installGitHook'
    });
}

function removeHook() {
    vscode.postMessage({
        type: 'removeGitHook'
    });
}

function openWorkspace() {
    vscode.postMessage({
        type: 'openWorkspace'
    });
}

function chooseBackupLocation() {
    vscode.postMessage({
        type: 'chooseBackupLocation'
    });
}

function restoreFromBackup() {
    vscode.postMessage({
        type: 'restoreFromBackup'
    });
}

function scanSecrets() {
    vscode.postMessage({
        type: 'scanSecrets'
    });
}

// ============================
// UTILITY FUNCTIONS
// ============================

function formatTimeDiff(date) {
    const now = new Date().getTime();
    const diff = now - new Date(date).getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================
// MESSAGE HANDLER
// ============================

window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
        case 'refresh':
            updateDashboard(message);
            break;

        case 'updateStatus':
            // Update specific parts of the dashboard
            if (message.cloudStatus) updateCloudCard(message);
            if (message.gitHookStatus) updateGitHookCard(message);
            if (message.validationStatus) updateValidationCard(message);
            break;

        case 'showNotification':
            // Could show toast notifications
            console.log('Notification:', message.message);
            break;

        default:
            console.log('Unknown message type:', message.type);
    }
});

// Modern Initialization
const initializeModernUI = () => {
    // Add animation styles
    addAnimationStyles();

    // Add button interaction effects
    document.querySelectorAll('.btn').forEach(button => {
        button.addEventListener('click', buttonEffects.addRipple);
        buttonEffects.addHoverEffect(button);
    });

    // Add stagger animation to cards
    const cards = document.querySelectorAll('.dashboard-card, .env-card');
    cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
    });

    // Add tooltips to buttons
    document.querySelectorAll('.btn').forEach(button => {
        if (button.title) {
            button.classList.add('tooltip');
            button.setAttribute('data-tooltip', button.title);
        }
    });

    // Add smooth scrolling
    document.documentElement.style.scrollBehavior = 'smooth';

    // Initialize theme detection
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.body.classList.add('dark-theme');
    }

    // Listen for theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        document.body.classList.toggle('dark-theme', e.matches);
    });

    console.log('🚀 Modern dotenvy UI initialized with enhanced animations and interactions!');
};

// Enhanced Dashboard Functions with Animations
const updateDashboardEnhanced = (data) => {
    updateDashboard(data);

    // Animate cards in
    const cards = document.querySelectorAll('.dashboard-card');
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('animate-fade-in');
        }, index * 100);
    });
};

// Enhanced Environment Grid with Stagger Animation
const updateEnvironmentsGridEnhanced = (data) => {
    const container = document.getElementById('environments-list');

    if (!data.hasWorkspace) {
        container.innerHTML = `
            <div class="welcome-message animate-fade-in">
                <h3>Welcome to dotenvy! 🎉</h3>
                <p>Manage your environment variables with confidence using our intelligent secret scanner.</p>
                <p>Open a workspace to get started with modern environment management.</p>
                <button class="btn btn-primary" onclick="openWorkspace()">Open Workspace</button>
            </div>
        `;
        return;
    }

    if (!data.environments || data.environments.length === 0) {
        container.innerHTML = `
            <div class="welcome-message animate-fade-in">
                <p>No environment files found. Create your first .env file to begin!</p>
                <button class="btn btn-primary" onclick="createEnvFile()">Create Environment</button>
            </div>
        `;
        return;
    }

    // Show skeleton loading
    loadingStates.showCardSkeleton(container);

    setTimeout(() => {
        container.innerHTML = '';
        data.environments.forEach((env, index) => {
            const card = createEnvironmentCard(env);
            card.style.animationDelay = `${index * 0.1}s`;
            container.appendChild(card);
        });
    }, 200);
};

// Enhanced Button States
const setButtonLoading = (button, isLoading) => {
    if (isLoading) {
        button.classList.add('loading');
        button.disabled = true;
        button.setAttribute('data-original-text', button.textContent);
    } else {
        button.classList.remove('loading');
        button.disabled = false;
        button.textContent = button.getAttribute('data-original-text') || button.textContent;
    }
};

// Modern Notification System
const showNotification = (message, type = 'info', duration = 3000) => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, duration);
};

// Enhanced Message Handler
window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
        case 'refresh':
            updateDashboardEnhanced(message);
            break;

        case 'scanProgress':
            // Update progress bar for secret scanning
            updateScanProgress(message.progress);
            break;

        case 'scanComplete':
            showNotification('Secret scan completed successfully! 🎉', 'success');
            break;

        case 'showNotification':
            showNotification(message.message, message.notificationType || 'info');
            break;

        default:
            console.log('Unknown message type:', message.type);
    }
});

// Progress Bar for Secret Scanning
const updateScanProgress = (progress) => {
    let progressContainer = document.getElementById('scan-progress');
    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.id = 'scan-progress';
        progressContainer.className = 'progress-container';
        progressContainer.innerHTML = `
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
            <div class="progress-text">Scanning: <span class="current-file">Initializing...</span></div>
        `;
        document.querySelector('.header').appendChild(progressContainer);
    }

    const progressFill = progressContainer.querySelector('.progress-fill');
    const currentFileSpan = progressContainer.querySelector('.current-file');

    progressFill.style.width = `${progress.percentage}%`;
    currentFileSpan.textContent = progress.currentFile;

    if (progress.percentage >= 100) {
        setTimeout(() => progressContainer.remove(), 1000);
    }
};

// Initialize when DOM is ready with retry mechanism
const initializeWithRetry = () => {
    try {
        initializeModernUI();
        console.log('✅ Modern UI initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize modern UI:', error);
        // Retry after a short delay
        setTimeout(initializeWithRetry, 100);
    }
};

// Initialize when DOM is ready with retry mechanism
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔄 DOM Content Loaded, initializing modern UI...');

    // Debug: Check if header actions are present
    setTimeout(() => {
        console.log('🔍 Debugging header elements...');
        const header = document.querySelector('.header');
        const headerActions = document.querySelector('.header-actions');
        const allButtons = document.querySelectorAll('.header-actions .btn');

        console.log('Header element found:', !!header);
        console.log('Header actions element found:', !!headerActions);
        console.log('Buttons found in header actions:', allButtons.length);
        console.log('Header actions display style:', headerActions ? getComputedStyle(headerActions).display : 'N/A');
        console.log('All button classes:', Array.from(allButtons).map(btn => btn.className));

        // Check if CSS is loaded properly
        const cssRules = Array.from(document.styleSheets)
            .map(sheet => {
                try {
                    return Array.from(sheet.cssRules || []);
                } catch (e) {
                    return [];
                }
            })
            .flat();

        const headerActionsRules = cssRules.filter(rule =>
            rule.selectorText && rule.selectorText.includes('.header-actions')
        );
        console.log('CSS rules for .header-actions:', headerActionsRules.length);

        if (headerActionsRules.length === 0) {
            console.error('❌ No CSS rules found for .header-actions - CSS may not be loaded');
            // Fallback: Add inline styles
            if (headerActions) {
                headerActions.style.display = 'flex';
                headerActions.style.gap = '0.5rem';
            }
        }

        // Initialize modern UI anyway
        initializeWithRetry();

        // Then initialize dashboard cards
        setTimeout(() => {
            console.log('🧪 Initializing dashboard cards with default content...');
            initializeDashboardCards();

            // Only send refresh message after initialization is complete
            setTimeout(() => {
                console.log('📤 Sending refresh message to extension...');
                vscode.postMessage({ type: 'refresh' });
            }, 300);
        }, 150);
    }, 100);
});

// Fallback initialization
setTimeout(() => {
    if (!document.getElementById('modern-animations')) {
        console.log('🔄 Fallback initialization...');
        initializeWithRetry();
    }
}, 200);

// Initialize dashboard cards with default content
function initializeDashboardCards() {
    console.log('🧪 Initializing dashboard cards...');

    // Wait for elements to be available
    const maxRetries = 10;
    let retryCount = 0;

    const initCards = () => {
        retryCount++;

        // Check if all required elements are available
        const elements = {
            'env-count': document.getElementById('env-count'),
            'current-env': document.getElementById('current-env'),
            'cloud-status': document.getElementById('cloud-status'),
            'last-sync': document.getElementById('last-sync'),
            'hook-status': document.getElementById('hook-status'),
            'validation-status': document.getElementById('validation-status'),
            'validation-errors': document.getElementById('validation-errors')
        };

        const missingElements = Object.entries(elements)
            .filter(([id, element]) => !element)
            .map(([id]) => id);

        if (missingElements.length === 0) {
            // All elements found, populate with default content
            populateDefaultContent(elements);
        } else if (retryCount < maxRetries) {
            console.log(`🔄 Elements not ready yet, retrying... Missing: ${missingElements.join(', ')}`);
            setTimeout(initCards, 50);
        } else {
            console.error('❌ Failed to find dashboard elements after maximum retries:', missingElements);
        }
    };

    const populateDefaultContent = (elements) => {
        try {
            // Status Card
            if (elements['env-count']) {
                elements['env-count'].textContent = '1';
                console.log('✅ Status card env-count set to: 1');
            }
            if (elements['current-env']) {
                elements['current-env'].textContent = 'local';
                console.log('✅ Status card current-env set to: local');
            }

            // Cloud Card
            if (elements['cloud-status']) {
                elements['cloud-status'].innerHTML = '<span class="status-indicator status-disconnected">Not Connected</span>';
                console.log('✅ Cloud card status set to: Not Connected');
            }
            if (elements['last-sync']) {
                elements['last-sync'].innerHTML = '<span class="sync-time">Last: Never</span>';
                console.log('✅ Cloud card last sync set to: Never');
            }

            // Git Hook Card
            if (elements['hook-status']) {
                elements['hook-status'].innerHTML = '<span class="status-indicator status-warning">Not Installed</span>';
                console.log('✅ Git hook card status set to: Not Installed');
            }

            // Validation Card
            if (elements['validation-status']) {
                elements['validation-status'].innerHTML = '<span class="status-indicator status-valid">Valid</span>';
                console.log('✅ Validation card status set to: Valid');
            }
            if (elements['validation-errors']) {
                elements['validation-errors'].style.display = 'none';
                console.log('✅ Validation card errors hidden');
            }

            console.log('🧪 Dashboard cards initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing dashboard cards:', error);
        }
    };

    initCards();
}
