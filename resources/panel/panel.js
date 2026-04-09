const vscode = acquireVsCodeApi();

// ============================
// 1. STATE & ANIMATIONS
// ============================

const addAnimationStyles = () => {
    if (!document.getElementById('modern-animations')) {
        const style = document.createElement('style');
        style.id = 'modern-animations';
        style.textContent = `
            @keyframes ripple { to { transform: scale(4); opacity: 0; } }
            @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
            @keyframes slideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .env-card-skeleton { background: var(--glass-bg); border-radius: 16px; overflow: hidden; animation: pulse 2s infinite; }
            .animate-fade-in { animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards; opacity: 0; }
            .variable-lock-btn { transition: transform 0.2s; }
            .variable-lock-btn:hover { transform: scale(1.1); }
            .variable-lock-btn:active { transform: scale(0.95); }

            /* ── Analytics styles ── */
            .analytics-panel-section { padding: var(--space-xl); background: rgba(255,255,255,0.01); border-top: 1px solid var(--glass-border); }
            .analytics-dashboard { display: flex; flex-direction: column; gap: 1.25rem; }
            .analytics-section h3 { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 700; color: var(--vscode-foreground); }
            .analytics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
            .analytics-card { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 12px; padding: 0.875rem; }
            .analytics-card h4 { margin: 0 0 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }
            .analytics-card.full-width { grid-column: 1 / -1; }
            .top-list, .stability-list, .variable-list { display: flex; flex-direction: column; gap: 0.35rem; }
            .list-item { display: flex; justify-content: space-between; align-items: center; padding: 0.3rem 0.5rem; background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 0.8rem; }
            .list-item .count { font-weight: 700; color: var(--vscode-foreground); }
            .stability-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; }
            .stability-item span:first-child { min-width: 70px; }
            .stability-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
            .stability-fill { height: 100%; background: var(--primary-gradient); border-radius: 3px; transition: width 0.5s ease; }
            .stability-item .score { min-width: 36px; text-align: right; font-weight: 700; }
            .variable-item { display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0.5rem; background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 0.8rem; gap: 0.5rem; }
            .variable-info { display: flex; flex-direction: column; gap: 0.1rem; flex: 1; }
            .variable-name { font-weight: 600; color: var(--vscode-foreground); }
            .variable-value { color: var(--vscode-descriptionForeground); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
            .variable-stats { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; }
            .changes { font-weight: 700; color: var(--vscode-foreground); }
            .velocity { color: var(--vscode-descriptionForeground); font-size: 0.75rem; }
            .heatmap-container { display: flex; flex-direction: column; gap: 0.5rem; }
            .heatmap-grid { display: flex; flex-wrap: wrap; gap: 3px; }
            .heatmap-cell { width: 14px; height: 14px; border-radius: 2px; cursor: default; }
            .heatmap-legend { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--vscode-descriptionForeground); }
            .legend-colors { display: flex; gap: 3px; }
            .legend-color { width: 12px; height: 12px; border-radius: 2px; }
            .analytics-meta { font-size: 0.75rem; color: var(--vscode-descriptionForeground); margin: 0; }
            .analytics-footer { padding-top: 0.5rem; border-top: 1px solid var(--glass-border); }
            .empty-state { text-align: center; padding: 2rem; color: var(--vscode-descriptionForeground); font-size: 0.9rem; }
        `;
        document.head.appendChild(style);
    }
};

const buttonEffects = {
    addRipple: (event) => {
        const button = event.currentTarget;
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = event.clientX - rect.left - size / 2;
        const y = event.clientY - rect.top - size / 2;

        const ripple = document.createElement('span');
        ripple.style.cssText = `position:absolute; width:${size}px; height:${size}px; left:${x}px; top:${y}px; background:rgba(255,255,255,0.3); border-radius:50%; transform:scale(0); animation:ripple 0.6s linear; pointer-events:none;`;
        button.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }
};

// ============================
// 2. MAIN DASHBOARD LOGIC
// ============================

function updateDashboard(data) {
    console.log('📊 Updating dashboard...', data);

    updateCloudCard(data);
    updateGitHookCard(data);
    updateValidationCard(data);
    updateEnvironmentsGrid(data);
    updateCurrentEnvironment(data);
    updateBackupSettings(data);

    // Animate cards entry
    setTimeout(() => {
        document.querySelectorAll('.env-card').forEach((card, index) => {
            card.style.animationDelay = `${index * 0.05}s`;
            card.classList.add('animate-fade-in');
        });
    }, 50);
}

function updateCloudCard(data) {
    const el = document.getElementById('cloud-status');
    const syncEl = document.getElementById('last-sync');
    if (el && syncEl) {
        const connected = data.cloudSync?.connected || false;
        el.innerHTML = `<span class="status-indicator ${connected ? 'status-connected' : 'status-disconnected'}">${connected ? 'Connected' : 'Not Connected'}</span>`;
        syncEl.innerHTML = `<span class="sync-time">Last: ${data.cloudSync?.lastSync ? formatTimeDiff(data.cloudSync.lastSync) : 'Never'}</span>`;
    }
}

function updateGitHookCard(data) {
    const el = document.getElementById('hook-status');
    if (el) {
        const installed = data.gitHook?.installed || false;
        el.innerHTML = `<span class="status-indicator ${installed ? 'status-active' : 'status-warning'}">${installed ? 'Installed' : 'Not Installed'}</span>`;
    }
}

function updateValidationCard(data) {
    const statusEl = document.getElementById('validation-status');
    const errorsEl = document.getElementById('validation-errors');
    if (statusEl && errorsEl) {
        const valid = data.validation?.valid ?? true;
        const errors = data.validation?.errors || 0;
        statusEl.innerHTML = `<span class="status-indicator ${valid ? 'status-valid' : 'status-invalid'}">${valid ? 'Valid' : 'Invalid'}</span>`;
        errorsEl.innerHTML = errors > 0 ? `<span class="error-count">${errors} errors</span>` : '';
        errorsEl.style.display = errors > 0 ? 'block' : 'none';
    }
}

function updateBackupSettings(data) {
    setText('backup-path-display', data.backupSettings?.path?.trim() || '~/.dotenvy-backups/default');
    const checkbox = document.getElementById('encrypt-backups-checkbox');
    if (checkbox) checkbox.checked = data.backupSettings?.encrypt || false;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ============================
// 3. ENVIRONMENT GRID
// ============================

function updateEnvironmentsGrid(data) {
    const container = document.getElementById('environments-list');

    if (!data.hasWorkspace) {
        container.innerHTML = `<div class="welcome-message"><h3>Welcome to DotEnvy!</h3><p>Open a workspace to get started.</p><button class="btn btn-primary" onclick="openWorkspace()">Open Workspace</button></div>`;
        return;
    }

    if (!data.environments || data.environments.length === 0) {
        container.innerHTML = `<div class="welcome-message"><p>No .env files found.</p><button class="btn btn-primary" onclick="createEnvFile()">Create New</button></div>`;
        return;
    }

    container.innerHTML = '';
    data.environments.forEach(env => {
        const card = document.createElement('div');
        card.className = `env-card ${env.isActive ? 'active' : ''}`;
        card.innerHTML = `
            <div class="env-card-header">
                <div class="env-card-title">
                    <span class="env-card-icon">${env.isActive ? '🔵' : '⚪'}</span>
                    <h4 class="env-name">${env.name}</h4>
                </div>
                <div class="env-card-stats"><span>${env.variableCount || 0} vars</span><span>${formatFileSize(env.fileSize || 0)}</span></div>
            </div>
            <div class="env-card-actions">
                <button class="btn btn-primary btn-sm" onclick="switchTo('${env.name}')">Switch</button>
                <button class="btn btn-secondary btn-sm" onclick="diffWithCurrent('${env.name}')">Compare</button>
                <button class="btn btn-secondary btn-sm" onclick="editFile('${env.fileName}')">Edit</button>
            </div>
        `;
        container.appendChild(card);
    });
}

// ============================
// 4. LOCK & VARIABLES LOGIC
// ============================

function updateCurrentEnvironment(data) {
    const section = document.getElementById('current-env-section');
    const content = document.getElementById('current-env-content');

    if (!data.currentFile) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';

    if (data.currentFile.variables && data.currentFile.variables.length > 0) {
        renderVariablesWithLocks(data.currentFile.variables, content);
    } else {
        content.innerHTML = `<pre style="font-family:var(--vscode-editor-font-family)">${data.currentFile.content}</pre>`;
    }
}

function renderVariablesWithLocks(variables, container) {
    container.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:0.5rem; padding:1rem; background:var(--vscode-editor-background); border-radius:8px; border:1px solid var(--vscode-panel-border);';

    variables.forEach(variable => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:0.75rem; padding:0.5rem; background:var(--vscode-input-background); border-radius:6px; transition:all 0.2s;';

        // 🔒 Lock Button
        const lockBtn = document.createElement('button');
        lockBtn.className = `variable-lock-btn`;
        lockBtn.innerHTML = variable.isEncrypted ? '🔒' : '🔓';
        lockBtn.title = variable.isEncrypted ? 'Decrypt' : 'Encrypt';
        lockBtn.style.cssText = `width:32px; height:32px; border:none; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:center; background:${variable.isEncrypted ? 'var(--vscode-notificationsInfoIcon-foreground)' : 'var(--vscode-notificationsWarningIcon-foreground)'}; color:white;`;

        lockBtn.onclick = () => {
            const originalIcon = lockBtn.innerHTML;
            lockBtn.innerHTML = '⏳';
            lockBtn.disabled = true;
            lockBtn.style.opacity = '0.6';

            vscode.postMessage({ type: 'toggleVarEncryption', key: variable.key });

            setTimeout(() => {
                lockBtn.innerHTML = originalIcon;
                lockBtn.disabled = false;
                lockBtn.style.opacity = '1';
            }, 2500);
        };

        // Key & Value
        const keySpan = document.createElement('span');
        keySpan.textContent = variable.key;
        keySpan.style.cssText = 'font-weight:600; min-width:120px; color:var(--vscode-foreground);';

        const valSpan = document.createElement('span');
        valSpan.style.cssText = 'flex:1; word-break:break-all; color:var(--vscode-foreground);';

        if (variable.isEncrypted) {
            valSpan.textContent = variable.value.substring(0, 4) + '••••';
            valSpan.style.opacity = '0.7';
            valSpan.style.fontStyle = 'italic';
        } else {
            valSpan.textContent = variable.value;
        }

        // ✏️ Edit Button
        const editBtn = document.createElement('button');
        editBtn.className = 'variable-lock-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit Value';
        editBtn.style.cssText = `width:32px; height:32px; border:none; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.1); color:white;`;
        editBtn.onclick = () => vscode.postMessage({ type: 'updateVariable', key: variable.key });

        // 🗑️ Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'variable-lock-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete Variable';
        deleteBtn.style.cssText = `width:32px; height:32px; border:none; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:center; background:rgba(239,68,68,0.2); color:#ef4444;`;
        deleteBtn.onclick = () => vscode.postMessage({ type: 'deleteVariable', key: variable.key });

        row.appendChild(lockBtn);
        row.appendChild(editBtn);
        row.appendChild(deleteBtn);
        row.appendChild(keySpan);
        row.appendChild(document.createTextNode('='));
        row.appendChild(valSpan);
        list.appendChild(row);
    });
    container.appendChild(list);
}

// ============================
// 6. GLOBAL ACTIONS
// ============================

const actions = {
    switchTo: (env) => vscode.postMessage({ type: 'switchEnvironment', environment: env }),
    editFile: (file) => vscode.postMessage({ type: 'editFile', fileName: file }),
    diffWithCurrent: (env) => vscode.postMessage({ type: 'diffEnvironment', environment: env }),
    backupCurrentEnv: () => vscode.postMessage({ type: 'backupCurrentEnv' }),
    diffEnvironments: () => vscode.postMessage({ type: 'diffEnvironment' }),
    editCurrentEnv: () => vscode.postMessage({ type: 'editFile', fileName: '.env' }),
    createEnvFile: () => vscode.postMessage({ type: 'createEnvironment' }),
    pullFromCloud: () => vscode.postMessage({ type: 'pullFromCloud' }),
    pushToCloud: () => vscode.postMessage({ type: 'pushToCloud' }),
    manageGitHook: () => vscode.postMessage({ type: 'manageGitHook' }),
    installHook: () => vscode.postMessage({ type: 'installGitHook' }),
    removeHook: () => vscode.postMessage({ type: 'removeGitHook' }),
    validateEnvironments: () => vscode.postMessage({ type: 'validateEnvironment' }),
    scanSecrets: () => vscode.postMessage({ type: 'scanSecrets' }),
    chooseBackupLocation: () => vscode.postMessage({ type: 'chooseBackupLocation' }),
    restoreFromBackup: () => vscode.postMessage({ type: 'restoreFromBackup' }),
    openWorkspace: () => vscode.postMessage({ type: 'openWorkspace' }),
    openHistoryPanel: () => vscode.postMessage({ type: 'openHistoryPanel' }),
    openAnalyticsPanel: () => vscode.postMessage({ type: 'openAnalyticsPanel' }),
    openTrashBin: () => vscode.postMessage({ type: 'openTrashBin' }),
};

// Expose to window
Object.keys(actions).forEach(key => window[key] = actions[key]);

// Utils
function formatTimeDiff(date) {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    return hours > 0 ? `${hours}h ago` : (minutes > 0 ? `${minutes}m ago` : 'Just now');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

const showNotification = (msg, type = 'info') => {
    const note = document.createElement('div');
    note.className = `notification ${type}`;
    note.textContent = msg;
    note.style.cssText = `position:fixed; bottom:20px; right:20px; padding:10px 20px; background:var(--vscode-notifications-background); color:var(--vscode-notifications-foreground); border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,0.2); z-index:1000; animation:slideIn 0.3s ease;`;
    document.body.appendChild(note);
    setTimeout(() => { note.style.opacity = '0'; setTimeout(() => note.remove(), 300); }, 3000);
};

// ============================
// 7. INITIALIZATION
// ============================

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'refresh':
            updateDashboard(message);
            break;
        case 'scanComplete':
            showNotification('Secret scan completed!', 'success');
            break;
        case 'showNotification':
            showNotification(message.message, message.notificationType);
            break;
        case 'updateStatus':
            if (message.cloudStatus) updateCloudCard(message);
            if (message.gitHookStatus) updateGitHookCard(message);
            break;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DotEnvy UI Initialized');
    addAnimationStyles();

    document.querySelectorAll('.btn').forEach(btn => {
        btn.addEventListener('click', buttonEffects.addRipple);
    });

    // Request dashboard data
    setTimeout(() => {
        vscode.postMessage({ type: 'refresh' });
    }, 100);
});
