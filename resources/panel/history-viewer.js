// History Viewer WebView Script

(function() {
    const vscode = acquireVsCodeApi();
    let currentWorkspace = null;
    let currentHistory = [];
    let filteredHistory = [];
    let lastFilterResult = null;
    let lastErrorDetail = null;

    // DOM elements
    const statsDiv = document.getElementById('stats');
    const historyList = document.getElementById('history-list');
    const searchInput = document.getElementById('search-input');
    const filterSelect = document.getElementById('filter-select');
    const refreshBtn = document.getElementById('refresh-btn');
    const viewTimelineBtn = document.getElementById('view-timeline-btn');

    // Advanced filter elements
    const advancedFiltersBtn = document.getElementById('advanced-filters-btn');
    const advancedFiltersPanel = document.getElementById('advanced-filters-panel');
    const advancedSearchInput = document.getElementById('advanced-search-input');
    const regexToggle = document.getElementById('regex-toggle');
    const searchScopeSelect = document.getElementById('search-scope-select');
    const datePresetSelect = document.getElementById('date-preset-select');
    const dateFromInput = document.getElementById('date-from-input');
    const dateToInput = document.getElementById('date-to-input');
    const userFilterSelect = document.getElementById('user-filter-select');
    const actionFilterSelect = document.getElementById('action-filter-select');
    const environmentFilterSelect = document.getElementById('environment-filter-select');
    const variableFilterSelect = document.getElementById('variable-filter-select');
    const applyFiltersBtn = document.getElementById('apply-filters-btn');
    const clearFiltersBtn = document.getElementById('clear-filters-btn');
    const closeFiltersBtn = document.getElementById('close-filters-btn');
    const closeFiltersBtnIcon = document.getElementById('close-filters-btn-icon');
    const advancedFiltersBackdrop = document.getElementById('advanced-filters-backdrop');
    const filterStats = document.getElementById('filter-stats');

    // Timeline state removed
    let currentView = 'list';


    const filters = window.dotenvyHistoryFilters.create({
        getWorkspace: () => currentWorkspace,
        vscode,
        tr,
        escapeHtml,
        formatTimestamp,
        elements: {
            advancedFiltersPanel, advancedFiltersBackdrop, advancedFiltersBtn, advancedSearchInput,
            regexToggle, searchScopeSelect, datePresetSelect, dateFromInput, dateToInput,
            userFilterSelect, actionFilterSelect, environmentFilterSelect, variableFilterSelect, filterStats,
        },
        setFilteredEntries(entries) {
            filteredHistory = entries;
            currentHistory = entries;
        },
        updateStats,
        renderHistoryList,
        getCurrentView: () => currentView,
    });

    // Initialize
    function init() {
        // Event listeners with null checks
        if (refreshBtn) refreshBtn.addEventListener('click', loadHistory);
        if (searchInput) searchInput.addEventListener('input', filterHistory);
        if (filterSelect) filterSelect.addEventListener('change', filterHistory);

        // Advanced filter listeners with null checks
        if (advancedFiltersBtn) advancedFiltersBtn.addEventListener('click', () => filters.toggleAdvancedFilters());
        if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', () => filters.applyAdvancedFilters(false));
        if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', filters.clearAdvancedFilters);
        if (closeFiltersBtn) closeFiltersBtn.addEventListener('click', () => filters.toggleAdvancedFilters(false));
        if (closeFiltersBtnIcon) closeFiltersBtnIcon.addEventListener('click', () => filters.toggleAdvancedFilters(false));
        if (advancedFiltersBackdrop) advancedFiltersBackdrop.addEventListener('click', () => filters.toggleAdvancedFilters(false));

        // Live update listeners
        const filterInputs = [
            advancedSearchInput, regexToggle, searchScopeSelect, 
            dateFromInput, dateToInput, userFilterSelect, 
            actionFilterSelect, environmentFilterSelect, variableFilterSelect
        ];

        filterInputs.forEach(input => {
            if (input) {
                const eventType = input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'date' ? 'change' : 'input';
                input.addEventListener(eventType, filters.liveUpdateFilters);
            }
        });

        // Date preset listener with null check
        if (datePresetSelect) {
            datePresetSelect.addEventListener('change', () => {
                filters.handleDatePresetChange();
                filters.liveUpdateFilters();
            });
        }
        // analytics tab removed – analytics now lives in the sidebar panel

        if (viewTimelineBtn) viewTimelineBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'openTimeline' });
        });

        // Listen for messages from extension
        window.addEventListener('message', handleMessage);

        // Request initial data
        setTimeout(() => {
            vscode.postMessage({ type: 'refresh' });
        }, 100);
    }

    function loadHistory() {
        if (!currentWorkspace) return;

        vscode.postMessage({
            type: 'loadHistory',
            workspacePath: currentWorkspace
        });

        showLoading();
    }


    let currentStats = null;

    function tr(key, params, fallback) {
        if (window.dotenvyI18n && typeof window.dotenvyI18n.tr === 'function') {
            return window.dotenvyI18n.tr(key, params, fallback);
        }
        return fallback !== undefined ? fallback : key;
    }

    function showLoading() {
        const tbody = document.getElementById('history-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="5" class="loading" data-i18n="history.loading">${tr('history.loading', {}, 'Loading history…')}</td></tr>`;
        }
    }


    function handleMessage(event) {
        const message = event.data;

        switch (message.type) {
            case 'historyLoaded':
                // Set workspace path when history is loaded
                if (message.workspacePath) {
                    currentWorkspace = message.workspacePath;
                }
                lastErrorDetail = null;
                currentHistory = message.history;
                currentStats = message.stats;
                updateStats(message.stats);
                filterHistory();
                filters.loadFilterOptions();
                break;
            case 'localeChanged':
                if (window.dotenvyI18n && window.dotenvyI18n.applyTranslations) {
                    window.dotenvyI18n.applyTranslations();
                }
                if (currentStats) updateStats(currentStats);
                filterHistory();
                if (lastFilterResult) filters.updateFilterStats(lastFilterResult);
                if (lastErrorDetail !== null) {
                    showError(lastErrorDetail);
                } else if (currentWorkspace) {
                    filters.loadFilterOptions();
                }
                break;
            case 'analyticsLoaded':
                break;
            case 'rollbackResult':
                handleRollbackResult(message);
                break;
            case 'filtersApplied':
                lastFilterResult = message.result;
                filters.displayFilteredHistory(message.result);
                filters.updateFilterStats(message.result);
                break;
            case 'filterOptionsLoaded':
                filters.populateFilterOptions(message.options);
                break;
            case 'regexValidated':
                filters.handleRegexValidation(message);
                break;
            case 'variableHistoryLoaded':
                filters.displayVariableHistory(message.variableName, message.history);
                break;
            case 'error':
                showError(message.errorMessage || message.message || '');
                break;
        }
    }

    function updateStats(stats) {
        if (!stats) return;

        statsDiv.innerHTML = `
            <div class="stat-chip">
                <span class="stat-label">${tr('history.total', {}, 'Total')}</span>
                <span class="stat-value">${stats.totalEntries}</span>
            </div>
            <div class="stat-chip">
                <span class="stat-label">${tr('history.size', {}, 'Size')}</span>
                <span class="stat-value">${formatBytes(stats.storageSize)}</span>
            </div>
        `;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function filterHistory() {
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const filterValue = filterSelect ? filterSelect.value : 'all';

        filteredHistory = currentHistory.filter(entry => {
            // Search filter
            const matchesSearch = !searchTerm ||
                entry.environmentName.toLowerCase().includes(searchTerm) ||
                (entry.user && entry.user.toLowerCase().includes(searchTerm)) ||
                (entry.metadata.reason && entry.metadata.reason.toLowerCase().includes(searchTerm));

            // Action filter
            const matchesFilter = filterValue === 'all' || entry.action === filterValue;

            return matchesSearch && matchesFilter;
        });

        // Render only history list
        renderHistoryList();
    }

    function renderHistoryList() {
        const tbody = document.getElementById('history-body');
        if (!tbody) return;

        if (filteredHistory.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state">${tr('history.empty', {}, 'No history entries found')}</td></tr>`;
            return;
        }

        tbody.innerHTML = filteredHistory.map(entry => {
            const note = entry.metadata?.reason
                ? escapeHtml(entry.metadata.reason)
                : (entry.previousEnvironment
                    ? tr('history.noteFromEnv', { env: escapeHtml(entry.previousEnvironment) }, `from ${entry.previousEnvironment}`)
                    : '');
            return `
            <tr class="history-row" data-entry-id="${entry.id}">
                <td class="col-time" title="${new Date(entry.timestamp).toLocaleString()}">${formatTimestamp(entry.timestamp)}</td>
                <td class="col-env">
                    <span class="env-pill">${escapeHtml(entry.environmentName)}</span>
                    <span class="env-file">${escapeHtml(getDisplayFileName(entry))}</span>
                </td>
                <td class="col-action"><span class="action-badge action-${entry.action}">${filters.formatAction(entry.action)}</span></td>
                <td class="col-note">${note}</td>
                <td class="col-actions">
                    <button type="button" class="btn-table" data-action="diff" data-entry-id="${entry.id}" title="${tr('history.diffTitle', {}, 'Open native VS Code diff')}">${tr('history.diffBtn', {}, '⟷ Diff')}</button>
                    <button type="button" class="btn-table btn-table-danger" data-action="rollback" data-entry-id="${entry.id}" title="${tr('history.rollbackTitle', {}, 'Rollback to this state')}">${tr('history.rollbackBtn', {}, '↩ Rollback')}</button>
                </td>
            </tr>`;
        }).join('');

        // Remove old listeners to avoid memory leaks
        const newTbody = tbody.cloneNode(true);
        tbody.parentNode.replaceChild(newTbody, tbody);
        
        newTbody.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-action]');
            if (!btn) return;
            event.stopPropagation();
            const action  = btn.dataset.action;
            const entryId = btn.dataset.entryId;
            if (action === 'diff')     showDiff(entryId);
            if (action === 'rollback') rollback(entryId);
        });
    }

    function getDisplayFileName(entry) {
        // If fileName is explicitly set, use it
        if (entry.fileName) {
            return entry.fileName;
        }

        // Otherwise, derive filename from environment name
        if (entry.environmentName === 'local') {
            return '.env';
        } else {
            return `.env.${entry.environmentName}`;
        }
    }

    function formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);
        const locale = (window.dotenvyI18n && window.dotenvyI18n.getLocale)
            ? window.dotenvyI18n.getLocale()
            : undefined;

        if (diffMinutes < 1) return tr('history.timeJustNow', {}, 'Just now');
        if (diffMinutes < 60) return tr('history.timeMinutesAgo', { minutes: diffMinutes }, `${diffMinutes}m ago`);
        if (diffHours < 24) return tr('history.timeHoursAgo', { hours: diffHours }, `${diffHours}h ago`);
        if (diffDays < 7) return tr('history.timeDaysAgo', { days: diffDays }, `${diffDays}d ago`);

        return date.toLocaleDateString(locale);
    }

    function showDiff(entryId) {
        if (!currentWorkspace) {
            alert(tr('history.workspaceNotReady', {}, 'Workspace not initialized. Please refresh the history view.'));
            return;
        }
        vscode.postMessage({
            type: 'diff',
            entryId: entryId,
            workspacePath: currentWorkspace
        });
    }

    function rollback(entryId) {
        if (!currentWorkspace) {
            alert(tr('history.workspaceNotReady', {}, 'Workspace not initialized. Please refresh the history view.'));
            return;
        }
        const entry = currentHistory.find(e => e.id === entryId);
        if (!entry) {
            alert(tr('history.entryNotFound', {}, 'Entry not found.'));
            return;
        }

        vscode.postMessage({
            type: 'confirmRollback',
            entryId: entryId,
            workspacePath: currentWorkspace,
            timestamp: new Date(entry.timestamp).toISOString(),
            environmentName: entry.environmentName
        });
    }

    function handleRollbackResult(message) {
        if (message.success) {
            alert(tr('history.rollbackSuccess', {}, 'Successfully rolled back to the historical environment state.'));
        } else {
            alert(tr('history.rollbackFailed', {}, 'Failed to rollback to the selected environment state.'));
        }
    }

    function showError(message) {
        lastErrorDetail = message || '';
        const text = tr(
            'history.loadFailed',
            { message: lastErrorDetail },
            `Failed to load history: ${lastErrorDetail}`
        );
        const tbody = document.getElementById('history-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="5" class="error-state">${escapeHtml(text)}</td></tr>`;
        } else if (historyList) {
            historyList.innerHTML = `<div class="error-state">${escapeHtml(text)}</div>`;
        }
    }


    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Make functions global for onclick handlers
    window.showDiff = showDiff;
    window.rollback = rollback;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
