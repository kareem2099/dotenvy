// History Viewer WebView Script

(function() {
    const vscode = acquireVsCodeApi();
    let currentWorkspace = null;
    let currentHistory = [];
    let filteredHistory = [];

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

    // Advanced filtering functions
    function toggleAdvancedFilters(show) {
        const isVisible = advancedFiltersPanel.classList.contains('is-open');
        const shouldShow = show !== undefined ? show : !isVisible;

        advancedFiltersPanel.classList.toggle('is-open', shouldShow);
        if (advancedFiltersBackdrop) {
            advancedFiltersBackdrop.classList.toggle('is-open', shouldShow);
        }
        advancedFiltersBtn.classList.toggle('active', shouldShow);

        if (shouldShow && !isVisible) {
            loadFilterOptions();
        }
    }

    function loadFilterOptions() {
        if (!currentWorkspace) return;

        vscode.postMessage({
            type: 'getFilterOptions',
            workspacePath: currentWorkspace
        });
    }

    function applyAdvancedFilters(keepOpen = false) {
        if (!currentWorkspace) return;

        const filters = {
            searchQuery: advancedSearchInput.value.trim() || undefined,
            searchRegex: regexToggle.checked,
            searchScope: searchScopeSelect.value,
            dateRange: getDateRangeFromInputs(),
            users: getSelectedValues(userFilterSelect),
            environments: getSelectedValues(environmentFilterSelect),
            actions: getSelectedValues(actionFilterSelect),
            variables: getSelectedValues(variableFilterSelect)
        };

        vscode.postMessage({
            type: 'applyFilters',
            workspacePath: currentWorkspace,
            filters: filters
        });

        // Close the filter panel only if not live update
        if (keepOpen !== true) {
            toggleAdvancedFilters(false);
        }
    }

    // Debounce function for live updates
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    const liveUpdateFilters = debounce(() => applyAdvancedFilters(true), 300);

    function clearAdvancedFilters() {
        // Clear all inputs
        advancedSearchInput.value = '';
        regexToggle.checked = false;
        searchScopeSelect.value = 'all';
        datePresetSelect.value = '';
        dateFromInput.value = '';
        dateToInput.value = '';

        // Clear all multi-selects
        clearMultiSelect(userFilterSelect);
        clearMultiSelect(actionFilterSelect);
        clearMultiSelect(environmentFilterSelect);
        clearMultiSelect(variableFilterSelect);

        // Apply empty filters to show all results
        applyAdvancedFilters();
    }

    function getDateRangeFromInputs() {
        const fromDate = dateFromInput.value;
        const toDate = dateToInput.value;

        if (!fromDate && !toDate) return undefined;

        return {
            start: fromDate ? new Date(fromDate) : undefined,
            end: toDate ? new Date(toDate + 'T23:59:59') : undefined
        };
    }

    function handleDatePresetChange() {
        const preset = datePresetSelect.value;
        if (!preset) {
            dateFromInput.value = '';
            dateToInput.value = '';
            return;
        }

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        let startDate, endDate;

        switch (preset) {
            case 'today':
                startDate = today;
                endDate = new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1);
                break;
            case 'last7days':
                startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'last30days':
                startDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case 'last3months':
                startDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case 'last6months':
                startDate = new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000);
                break;
            case 'lastyear':
                startDate = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
        }

        dateFromInput.value = startDate ? startDate.toISOString().split('T')[0] : '';
        dateToInput.value = endDate ? endDate.toISOString().split('T')[0] : '';
    }

    function validateRegexInput() {
        const pattern = advancedSearchInput.value;
        const useRegex = regexToggle.checked;

        if (!pattern || !useRegex) {
            advancedSearchInput.classList.remove('invalid');
            return;
        }

        vscode.postMessage({
            type: 'validateRegex',
            pattern: pattern
        });
    }

    function getSelectedValues(selectElement) {
        const selected = Array.from(selectElement.selectedOptions).map(option => option.value);
        return selected.length > 0 ? selected : undefined;
    }

    function clearMultiSelect(selectElement) {
        Array.from(selectElement.options).forEach(option => {
            option.selected = false;
        });
    }

    function populateMultiSelect(selectElement, options, placeholder = 'All') {
        // Clear existing options except the first one if it's a placeholder
        while (selectElement.options.length > 1) {
            selectElement.remove(1);
        }

        // Add new options
        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option;
            optionElement.textContent = option;
            selectElement.appendChild(optionElement);
        });
    }

    function displayFilteredHistory(result) {
        filteredHistory = result.entries;
        currentHistory = result.entries; // Update current history to filtered results

        // Update stats
        updateStats({
            totalEntries: result.totalCount,
            storageSize: 0 // We don't have storage size for filtered results
        });

        // Render appropriate view
        if (currentView === 'list') {
            renderHistoryList();
        } else if (currentView === 'timeline') {
            renderTimeline();
        }
    }

    function updateFilterStats(result) {
        if (!result.appliedFilters || result.appliedFilters.length === 0) {
            filterStats.innerHTML = '';
            return;
        }

        filterStats.innerHTML = `
            <div class="filter-stats-content">
                <span class="filter-count">Showing ${result.filteredCount} of ${result.totalCount} entries</span>
                <span class="applied-filters">Filters: ${result.appliedFilters.join(', ')}</span>
            </div>
        `;
    }

    function populateFilterOptions(options) {
        // Populate date presets
        const datePresets = options.dateRangePresets || [];
        datePresetSelect.innerHTML = '<option value="">Custom Range</option>';
        datePresets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.label.toLowerCase().replace(/\s+/g, '');
            option.textContent = preset.label;
            datePresetSelect.appendChild(option);
        });

        // Populate users
        populateMultiSelect(userFilterSelect, options.users || []);

        // Populate environments
        populateMultiSelect(environmentFilterSelect, options.environments || []);

        // Populate variables
        populateMultiSelect(variableFilterSelect, options.variables || []);
    }

    function handleRegexValidation(message) {
        const input = advancedSearchInput;
        if (message.valid) {
            input.classList.remove('invalid');
            input.title = '';
        } else {
            input.classList.add('invalid');
            input.title = `Invalid regex: ${message.error}`;
        }
    }

    function displayVariableHistory(variableName, history) {
        if (history.length === 0) {
            detailContent.innerHTML = `<div class="empty-state">No history found for variable "${variableName}"</div>`;
            return;
        }

        const html = `
            <div class="variable-history">
                <h4>Change History for "${variableName}"</h4>
                <div class="variable-timeline">
                    ${history.map(item => `
                        <div class="variable-change-item">
                            <div class="variable-change-header">
                                <span class="variable-value">"${escapeHtml(item.value)}"</span>
                                <span class="variable-timestamp">${formatTimestamp(item.timestamp)}</span>
                            </div>
                            <div class="variable-change-details">
                                <span class="variable-environment">${item.entry.environmentName}</span>
                                ${item.entry.user ? `<span class="variable-user">by ${item.entry.user}</span>` : ''}
                                ${item.entry.metadata.reason ? `<span class="variable-reason">${item.entry.metadata.reason}</span>` : ''}
                            </div>
                            <div class="variable-change-actions">
                                <button class="btn-small" data-action="view" data-entry-id="${item.entry.id}">View Entry</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

    }

    // Initialize
    function init() {
        // Event listeners with null checks
        if (refreshBtn) refreshBtn.addEventListener('click', loadHistory);
        if (searchInput) searchInput.addEventListener('input', filterHistory);
        if (filterSelect) filterSelect.addEventListener('change', filterHistory);

        // Advanced filter listeners with null checks
        if (advancedFiltersBtn) advancedFiltersBtn.addEventListener('click', () => toggleAdvancedFilters());
        if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', () => applyAdvancedFilters(false));
        if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearAdvancedFilters);
        if (closeFiltersBtn) closeFiltersBtn.addEventListener('click', () => toggleAdvancedFilters(false));
        if (closeFiltersBtnIcon) closeFiltersBtnIcon.addEventListener('click', () => toggleAdvancedFilters(false));
        if (advancedFiltersBackdrop) advancedFiltersBackdrop.addEventListener('click', () => toggleAdvancedFilters(false));

        // Live update listeners
        const filterInputs = [
            advancedSearchInput, regexToggle, searchScopeSelect, 
            dateFromInput, dateToInput, userFilterSelect, 
            actionFilterSelect, environmentFilterSelect, variableFilterSelect
        ];

        filterInputs.forEach(input => {
            if (input) {
                const eventType = input.tagName === 'SELECT' || input.type === 'checkbox' || input.type === 'date' ? 'change' : 'input';
                input.addEventListener(eventType, liveUpdateFilters);
            }
        });

        // Date preset listener with null check
        if (datePresetSelect) {
            datePresetSelect.addEventListener('change', () => {
                handleDatePresetChange();
                liveUpdateFilters();
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


    function showLoading() {
        const tbody = document.getElementById('history-body');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading history...</td></tr>';
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
                currentHistory = message.history;
                updateStats(message.stats);
                filterHistory();
                loadFilterOptions();
                break;
            case 'analyticsLoaded':
                break;
            case 'rollbackResult':
                handleRollbackResult(message);
                break;
            case 'filtersApplied':
                displayFilteredHistory(message.result);
                updateFilterStats(message.result);
                break;
            case 'filterOptionsLoaded':
                populateFilterOptions(message.options);
                break;
            case 'regexValidated':
                handleRegexValidation(message);
                break;
            case 'variableHistoryLoaded':
                displayVariableHistory(message.variableName, message.history);
                break;
            case 'error':
                showError(message.message);
                break;
        }
    }

    function updateStats(stats) {
        if (!stats) return;

        statsDiv.innerHTML = `
            <div class="stat-item">
                <span class="stat-label">Total:</span>
                <span class="stat-value">${stats.totalEntries}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Size:</span>
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
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No history entries found</td></tr>';
            return;
        }

        tbody.innerHTML = filteredHistory.map(entry => {
            const note = entry.metadata?.reason
                ? escapeHtml(entry.metadata.reason)
                : (entry.previousEnvironment ? `from ${entry.previousEnvironment}` : '');
            return `
            <tr class="history-row" data-entry-id="${entry.id}">
                <td class="col-time" title="${new Date(entry.timestamp).toLocaleString()}">${formatTimestamp(entry.timestamp)}</td>
                <td class="col-env">
                    <span class="env-pill">${escapeHtml(entry.environmentName)}</span>
                    <span class="env-file">${escapeHtml(getDisplayFileName(entry))}</span>
                </td>
                <td class="col-action"><span class="action-badge action-${entry.action}">${entry.action.replace('_', ' ')}</span></td>
                <td class="col-note">${note}</td>
                <td class="col-actions">
                    <button class="btn-table" data-action="diff" data-entry-id="${entry.id}" title="Open native VS Code diff">⟷ Diff</button>
                    <button class="btn-table btn-table-danger" data-action="rollback" data-entry-id="${entry.id}" title="Rollback to this state">↩ Rollback</button>
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

        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString();
    }

    function showDiff(entryId) {
        if (!currentWorkspace) {
            alert('Error: Workspace not initialized. Please refresh the history view.');
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
            alert('Error: Workspace not initialized. Please refresh the history view.');
            return;
        }
        const entry = currentHistory.find(e => e.id === entryId);
        if (!entry) {
            alert('Error: Entry not found.');
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
            alert(`Successfully rolled back to historical environment state!`);
        } else {
            alert('Failed to rollback to the selected environment state.');
        }
    }

    function showError(message) {
        historyList.innerHTML = `<div class="error-state">Error: ${message}</div>`;
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
