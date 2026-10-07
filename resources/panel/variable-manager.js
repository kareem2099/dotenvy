(function () {
    const vscode = acquireVsCodeApi();
    const rootEl = document.getElementById('manager-root');
    const searchBox = document.getElementById('search-box');
    const addBtn = document.getElementById('add-var-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const fileBadge = document.getElementById('file-badge');
    const statsBar = document.getElementById('stats-bar');

    let allVariables = [];
    let currentFile = '.env';
    let lastErrorDetail = null;
    const modal = window.dotenvyVariableModal.bind({
        tr,
        vscode,
        escHtml,
        escAttr,
        getCurrentFile: () => currentFile,
        getAllVariables: () => allVariables,
    });


    function tr(key, params, fallback) {
        if (window.dotenvyI18n && typeof window.dotenvyI18n.tr === 'function') {
            return window.dotenvyI18n.tr(key, params, fallback);
        }
        return fallback !== undefined ? fallback : key;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. MESSAGE HANDLING
    // ──────────────────────────────────────────────────────────────────────────

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'variablesLoaded':
                lastErrorDetail = null;
                allVariables = message.variables;
                currentFile = message.fileName;
                if (fileBadge) fileBadge.textContent = currentFile;
                updateStats();
                renderVariables(allVariables);
                break;
            case 'localeChanged':
                if (window.dotenvyI18n && window.dotenvyI18n.applyTranslations) {
                    window.dotenvyI18n.applyTranslations();
                }
                updateStats();
                if (lastErrorDetail !== null) {
                    showError(lastErrorDetail);
                } else {
                    renderVariables(allVariables, searchBox ? searchBox.value.toLowerCase().trim() : '');
                }
                break;
            case 'error':
                showError(message.errorMessage || message.message || '');
                break;
        }
    });

    if (refreshBtn) refreshBtn.addEventListener('click', () => {
        rootEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${tr('variableManager.refreshing', {}, 'Refreshing...')}</p></div>`;
        vscode.postMessage({ type: 'refresh', fileName: currentFile });
    });

    if (searchBox) searchBox.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            renderVariables(allVariables);
            return;
        }
        const filtered = allVariables.filter(v =>
            v.key.toLowerCase().includes(query) ||
            v.value.toLowerCase().includes(query)
        );
        renderVariables(filtered, query);
    });

    if (addBtn) addBtn.addEventListener('click', () => {
        modal.showAddVariableModal();
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 2. STATS BAR
    // ──────────────────────────────────────────────────────────────────────────

    function updateStats() {
        if (!statsBar) return;
        const total = allVariables.length;
        const encrypted = allVariables.filter(v => v.encrypted).length;
        const plain = total - encrypted;
        statsBar.innerHTML = `
            <div class="stat-chip">
                <span class="stat-icon">📦</span>
                <span class="stat-value">${total}</span>
                <span class="stat-label">${tr('variableManager.total', {}, 'Total')}</span>
            </div>
            <div class="stat-chip stat-chip--plain">
                <span class="stat-icon">🔓</span>
                <span class="stat-value">${plain}</span>
                <span class="stat-label">${tr('variableManager.plain', {}, 'Plain')}</span>
            </div>
            <div class="stat-chip stat-chip--encrypted">
                <span class="stat-icon">🔒</span>
                <span class="stat-value">${encrypted}</span>
                <span class="stat-label">${tr('variableManager.encrypted', {}, 'Encrypted')}</span>
            </div>
        `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. RENDERING
    // ──────────────────────────────────────────────────────────────────────────

    function highlightText(text, query) {
        if (!query) return escHtml(text);
        const escaped = escHtml(text);
        const escapedQuery = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escaped.replace(new RegExp(escapedQuery, 'gi'), m => `<mark class="search-highlight">${m}</mark>`);
    }

    function renderVariables(variables, searchQuery = '') {
        if (!rootEl) return;

        if (variables.length === 0) {
            const isFiltered = searchQuery.length > 0;
            rootEl.innerHTML = `
                <div class="vm-empty-state">
                    <div class="vm-empty-icon">${isFiltered ? '🔍' : '📭'}</div>
                    <h3>${isFiltered ? tr('variableManager.noMatching', {}, 'No matching variables') : tr('variableManager.noVariables', {}, 'No variables yet')}</h3>
                    <p>${isFiltered ? tr('variableManager.nothingMatches', { query: escHtml(searchQuery) }, `Nothing matches "${escHtml(searchQuery)}"`) : tr('variableManager.fileEmpty', { file: currentFile }, `${currentFile} is empty`)}</p>
                    ${!isFiltered ? `<button type="button" class="btn btn-primary" id="empty-add-btn">${tr('variableManager.addFirst', {}, '＋ Add First Variable')}</button>` : ''}
                </div>`;
            const emptyAdd = document.getElementById('empty-add-btn');
            if (emptyAdd) emptyAdd.addEventListener('click', modal.showAddVariableModal);
            return;
        }

        const rows = variables.map((v) => {
            const displayValue = v.encrypted ? '••••••••••••' : (v.value === '' ? `<em style="opacity:0.4">${tr('variableManager.emptyVal', {}, 'empty')}</em>` : highlightText(v.value, searchQuery));
            const keyHtml = highlightText(v.key, searchQuery);
            return `
            <div class="vm-row" data-key="${escAttr(v.key)}">
                <div class="vm-cell vm-cell--key">
                    <span class="vm-key-text">${keyHtml}</span>
                    ${v.encrypted ? `<span class="vm-badge vm-badge--enc">${tr('variableManager.badgeEnc', {}, 'ENC')}</span>` : ''}
                </div>
                <div class="vm-cell vm-cell--value">
                    <div class="vm-value-wrap">
                        <span class="vm-value-text ${v.encrypted ? 'is-encrypted' : ''}" data-raw="${escAttr(v.value)}">${displayValue}</span>
                        ${v.encrypted ? `
                            <button class="vm-btn-peek" title="${tr('variableManager.peekValue', {}, 'Peek value')}" data-key="${escAttr(v.key)}">👁</button>
                        ` : ''}
                    </div>
                </div>
                <div class="vm-cell vm-cell--actions">
                    <button class="vm-action-btn vm-action-btn--lock ${v.encrypted ? 'is-active' : ''}" title="${v.encrypted ? tr('variableManager.removeEnc', {}, 'Remove encryption') : tr('variableManager.encryptVal', {}, 'Encrypt value')}" data-key="${escAttr(v.key)}" data-action="toggle">
                        ${v.encrypted ? '🔒' : '🔓'}
                    </button>
                    <button class="vm-action-btn vm-action-btn--edit" title="${tr('variableManager.editVal', {}, 'Edit value')}" data-key="${escAttr(v.key)}" data-action="edit">
                        ✏️
                    </button>
                    <button class="vm-action-btn vm-action-btn--delete" title="${tr('variableManager.deleteVar', {}, 'Delete variable')}" data-key="${escAttr(v.key)}" data-action="delete">
                        🗑
                    </button>
                </div>
            </div>`;
        }).join('');

        rootEl.innerHTML = `
            <div class="vm-table-header">
                <div class="vm-th vm-th--key">${tr('variableManager.thKey', {}, 'KEY')}</div>
                <div class="vm-th vm-th--value">${tr('variableManager.thValue', {}, 'VALUE')}</div>
                <div class="vm-th vm-th--actions">${tr('variableManager.thActions', {}, 'ACTIONS')}</div>
            </div>
            <div class="vm-list" id="vm-list">
                ${rows}
            </div>`;

        attachListListeners();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. LISTENERS
    // ──────────────────────────────────────────────────────────────────────────

    function attachListListeners() {
        const list = document.getElementById('vm-list');
        if (!list) return;

        list.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const key = btn.dataset.key;
            const action = btn.dataset.action;
            const variable = allVariables.find(v => v.key === key);

            if (action === 'edit') {
                modal.startEditingModal(variable);
            } else if (action === 'delete') {
                modal.showDeleteConfirm(key);
            } else if (action === 'toggle') {
                vscode.postMessage({ type: 'toggleVarEncryption', key, fileName: currentFile });
            }
        });

        // Peek button for encrypted values
        list.addEventListener('click', (e) => {
            const peekBtn = e.target.closest('.vm-btn-peek');
            if (!peekBtn) return;
            const key = peekBtn.dataset.key;
            const row = peekBtn.closest('.vm-row');
            const valSpan = row.querySelector('.vm-value-text');
            const variable = allVariables.find(v => v.key === key);
            if (!variable) return;
            if (valSpan.dataset.peeking === 'true') {
                valSpan.innerHTML = '••••••••••••';
                valSpan.dataset.peeking = 'false';
                peekBtn.title = tr('variableManager.peekValue', {}, 'Peek value');
            } else {
                valSpan.textContent = variable.value || `(${tr('variableManager.emptyVal', {}, 'empty')})`;
                valSpan.dataset.peeking = 'true';
                peekBtn.title = tr('variableManager.hideValue', {}, 'Hide value');
            }
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. HELPERS
    // ──────────────────────────────────────────────────────────────────────────

    function showError(msg) {
        lastErrorDetail = msg || '';
        const text = tr(
            'variableManager.loadFailed',
            { message: lastErrorDetail },
            `Failed to load variables: ${lastErrorDetail}`
        );
        rootEl.innerHTML = `
            <div class="vm-error-state">
                <div class="vm-error-icon">⚠️</div>
                <p>${escHtml(text)}</p>
                <button type="button" class="btn btn-secondary" data-action="retry-load">${tr('variableManager.retry', {}, 'Retry')}</button>
            </div>`;
    }

    function escHtml(str) {
        if (str === undefined || str === null) return '';
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    function escAttr(str) {
        if (str === undefined || str === null) return '';
        return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Expose for global usage
    window.addVariable = modal.showAddVariableModal;

    const backupBtn = document.getElementById('backup-selected-btn');
    const restoreBtn = document.getElementById('restore-backup-btn');
    const setLocationBtn = document.getElementById('set-backup-location-btn');

    if (backupBtn) backupBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'backupSelectedEnv', fileName: currentFile });
    });
    if (restoreBtn) restoreBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'restoreFromBackup', fileName: currentFile });
    });
    if (setLocationBtn) setLocationBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'chooseBackupLocation' });
    });

    // Delegated handler for dynamically injected buttons (e.g. error-state Retry)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) { return; }
        if (btn.getAttribute('data-action') === 'retry-load') {
            vscode.postMessage({ type: 'refresh', fileName: currentFile });
        }
    });

})();
