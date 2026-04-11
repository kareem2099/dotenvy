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

    // ──────────────────────────────────────────────────────────────────────────
    // 1. MESSAGE HANDLING
    // ──────────────────────────────────────────────────────────────────────────

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'variablesLoaded':
                allVariables = message.variables;
                currentFile = message.fileName;
                if (fileBadge) fileBadge.textContent = currentFile;
                updateStats();
                renderVariables(allVariables);
                break;
            case 'error':
                showError(message.message);
                break;
        }
    });

    if (refreshBtn) refreshBtn.addEventListener('click', () => {
        rootEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Refreshing...</p></div>`;
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
        showAddVariableModal();
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
                <span class="stat-label">Total</span>
            </div>
            <div class="stat-chip stat-chip--plain">
                <span class="stat-icon">🔓</span>
                <span class="stat-value">${plain}</span>
                <span class="stat-label">Plain</span>
            </div>
            <div class="stat-chip stat-chip--encrypted">
                <span class="stat-icon">🔒</span>
                <span class="stat-value">${encrypted}</span>
                <span class="stat-label">Encrypted</span>
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
                    <h3>${isFiltered ? 'No matching variables' : 'No variables yet'}</h3>
                    <p>${isFiltered ? `Nothing matches "${escHtml(searchQuery)}"` : `${currentFile} is empty`}</p>
                    ${!isFiltered ? `<button class="btn btn-primary" id="empty-add-btn">＋ Add First Variable</button>` : ''}
                </div>`;
            const emptyAdd = document.getElementById('empty-add-btn');
            if (emptyAdd) emptyAdd.addEventListener('click', showAddVariableModal);
            return;
        }

        const rows = variables.map((v) => {
            const displayValue = v.encrypted ? '••••••••••••' : (v.value === '' ? '<em style="opacity:0.4">empty</em>' : highlightText(v.value, searchQuery));
            const keyHtml = highlightText(v.key, searchQuery);
            return `
            <div class="vm-row" data-key="${escAttr(v.key)}">
                <div class="vm-cell vm-cell--key">
                    <span class="vm-key-text">${keyHtml}</span>
                    ${v.encrypted ? '<span class="vm-badge vm-badge--enc">ENC</span>' : ''}
                </div>
                <div class="vm-cell vm-cell--value">
                    <div class="vm-value-wrap">
                        <span class="vm-value-text ${v.encrypted ? 'is-encrypted' : ''}" data-raw="${escAttr(v.value)}">${displayValue}</span>
                        ${v.encrypted ? `
                            <button class="vm-btn-peek" title="Peek value" data-key="${escAttr(v.key)}">👁</button>
                        ` : ''}
                    </div>
                </div>
                <div class="vm-cell vm-cell--actions">
                    <button class="vm-action-btn vm-action-btn--lock ${v.encrypted ? 'is-active' : ''}" title="${v.encrypted ? 'Remove encryption' : 'Encrypt value'}" data-key="${escAttr(v.key)}" data-action="toggle">
                        ${v.encrypted ? '🔒' : '🔓'}
                    </button>
                    <button class="vm-action-btn vm-action-btn--edit" title="Edit value" data-key="${escAttr(v.key)}" data-action="edit">
                        ✏️
                    </button>
                    <button class="vm-action-btn vm-action-btn--delete" title="Delete variable" data-key="${escAttr(v.key)}" data-action="delete">
                        🗑
                    </button>
                </div>
            </div>`;
        }).join('');

        rootEl.innerHTML = `
            <div class="vm-table-header">
                <div class="vm-th vm-th--key">KEY</div>
                <div class="vm-th vm-th--value">VALUE</div>
                <div class="vm-th vm-th--actions">ACTIONS</div>
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
                startEditingModal(variable);
            } else if (action === 'delete') {
                showDeleteConfirm(key);
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
                peekBtn.title = 'Peek value';
            } else {
                valSpan.textContent = variable.value || '(empty)';
                valSpan.dataset.peeking = 'true';
                peekBtn.title = 'Hide value';
            }
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. MODALS
    // ──────────────────────────────────────────────────────────────────────────

    function showAddVariableModal() {
        showVariableModal({
            title: '＋ Add Variable',
            keyValue: '',
            valueValue: '',
            keyEditable: true,
            submitLabel: 'Add Variable',
            onSubmit: ({ key, value }) => {
                if (!key.trim()) return 'Key cannot be empty';
                if (allVariables.find(v => v.key === key.trim())) return `Key "${key}" already exists`;
                vscode.postMessage({ type: 'updateVariable', key: key.trim(), value, fileName: currentFile });
            }
        });
    }

    function startEditingModal(variable) {
        showVariableModal({
            title: `✏️ Edit  ${variable.key}`,
            keyValue: variable.key,
            valueValue: variable.encrypted ? '' : variable.value,
            keyEditable: false,
            submitLabel: 'Save Changes',
            valuePlaceholder: variable.encrypted ? '(enter new value for encrypted var)' : '',
            onSubmit: ({ value }) => {
                vscode.postMessage({
                    type: 'updateVariable',
                    key: variable.key,
                    value,
                    fileName: currentFile,
                    encrypted: variable.encrypted
                });
            }
        });
    }

    function showVariableModal({ title, keyValue, valueValue, keyEditable, submitLabel, valuePlaceholder = '', onSubmit }) {
        removeModal();
        const overlay = document.createElement('div');
        overlay.className = 'vm-overlay';
        overlay.id = 'vm-modal-overlay';
        overlay.innerHTML = `
            <div class="vm-modal" role="dialog" aria-modal="true">
                <div class="vm-modal-header">
                    <h3 class="vm-modal-title">${title}</h3>
                    <button class="vm-modal-close" id="vm-modal-close" aria-label="Close">✕</button>
                </div>
                <div class="vm-modal-body">
                    <div class="vm-form-group">
                        <label class="vm-form-label" for="modal-key">Key</label>
                        <input
                            id="modal-key"
                            class="vm-form-input vm-mono"
                            type="text"
                            value="${escAttr(keyValue)}"
                            placeholder="VARIABLE_NAME"
                            ${keyEditable ? '' : 'readonly'}
                            autocomplete="off"
                            spellcheck="false"
                        >
                    </div>
                    <div class="vm-form-group">
                        <label class="vm-form-label" for="modal-value">Value</label>
                        <textarea
                            id="modal-value"
                            class="vm-form-input vm-form-textarea vm-mono"
                            placeholder="${escAttr(valuePlaceholder || 'Enter value...')}"
                            autocomplete="off"
                            spellcheck="false"
                            rows="3"
                        >${escHtml(valueValue)}</textarea>
                    </div>
                    <div class="vm-form-error" id="vm-form-error"></div>
                </div>
                <div class="vm-modal-footer">
                    <button class="btn btn-secondary" id="vm-modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="vm-modal-submit">${submitLabel}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const keyInput = overlay.querySelector('#modal-key');
        const valInput = overlay.querySelector('#modal-value');
        const errorEl = overlay.querySelector('#vm-form-error');
        const submitBtn = overlay.querySelector('#vm-modal-submit');

        // Focus
        setTimeout(() => (keyEditable ? keyInput : valInput).focus(), 50);

        const doSubmit = () => {
            const key = keyInput.value;
            const value = valInput.value;
            const err = onSubmit({ key, value });
            if (err) {
                errorEl.textContent = err;
                errorEl.style.display = 'block';
                return;
            }
            removeModal();
        };

        submitBtn.addEventListener('click', doSubmit);
        overlay.querySelector('#vm-modal-cancel').addEventListener('click', removeModal);
        overlay.querySelector('#vm-modal-close').addEventListener('click', removeModal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) removeModal(); });

        // Keyboard submit
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') removeModal();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSubmit();
        });
    }

    function showDeleteConfirm(key) {
        removeModal();
        const overlay = document.createElement('div');
        overlay.className = 'vm-overlay';
        overlay.id = 'vm-modal-overlay';
        overlay.innerHTML = `
            <div class="vm-modal vm-modal--sm" role="dialog" aria-modal="true">
                <div class="vm-modal-header">
                    <h3 class="vm-modal-title">🗑 Delete Variable</h3>
                    <button class="vm-modal-close" id="vm-modal-close" aria-label="Close">✕</button>
                </div>
                <div class="vm-modal-body">
                    <p class="vm-delete-msg">Delete <code class="vm-inline-code">${escHtml(key)}</code>?</p>
                    <p class="vm-delete-hint">This will be saved to the Trash Bin and can be restored.</p>
                </div>
                <div class="vm-modal-footer">
                    <button class="btn btn-secondary" id="vm-modal-cancel">Cancel</button>
                    <button class="btn btn-danger" id="vm-modal-confirm">Delete</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#vm-modal-cancel').addEventListener('click', removeModal);
        overlay.querySelector('#vm-modal-close').addEventListener('click', removeModal);
        overlay.querySelector('#vm-modal-confirm').addEventListener('click', () => {
            vscode.postMessage({ type: 'deleteVariable', key, fileName: currentFile });
            removeModal();
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) removeModal(); });
        overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') removeModal(); });
        setTimeout(() => overlay.querySelector('#vm-modal-confirm').focus(), 50);
    }

    function removeModal() {
        const existing = document.getElementById('vm-modal-overlay');
        if (existing) existing.remove();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. HELPERS
    // ──────────────────────────────────────────────────────────────────────────

    function showError(msg) {
        rootEl.innerHTML = `
            <div class="vm-error-state">
                <div class="vm-error-icon">⚠️</div>
                <p>${escHtml(msg)}</p>
                <button class="btn btn-secondary" onclick="this.closest('.vm-error-state').parentElement && vscode.postMessage({type:'refresh',fileName:'${currentFile}'})">Retry</button>
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
    window.addVariable = showAddVariableModal;

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

})();
