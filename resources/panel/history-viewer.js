// History Viewer WebView Script

(function() {
    const vscode = acquireVsCodeApi();
    let currentWorkspace = null;
    let currentHistory = [];
    let filteredHistory = [];

    // DOM elements
    const statsDiv = document.getElementById('stats');
    const historyList = document.getElementById('history-list');
    const timelineContainer = document.getElementById('timeline-container');
    const timelineSvg = document.getElementById('timeline-svg');
    const timelineContent = document.getElementById('timeline-content');
    const timelineMinimap = document.getElementById('timeline-minimap');
    const minimapSvg = document.getElementById('minimap-svg');
    const analyticsContainer = document.getElementById('analytics-container');
    const analyticsContent = document.getElementById('analytics-content');
    const searchInput = document.getElementById('search-input');
    const filterSelect = document.getElementById('filter-select');
    const refreshBtn = document.getElementById('refresh-btn');
    const listViewBtn = document.getElementById('list-view-btn');
    const timelineViewBtn = document.getElementById('timeline-view-btn');
    const analyticsViewBtn = document.getElementById('analytics-view-btn');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const fitToScreenBtn = document.getElementById('fit-to-screen-btn');
    const zoomLevel = document.getElementById('zoom-level');
    const historyDetail = document.getElementById('history-detail');
    const backBtn = document.getElementById('back-btn');
    const detailTitle = document.getElementById('detail-title');
    const detailContent = document.getElementById('detail-content');
    const detailActions = document.getElementById('detail-actions');

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
    const filterStats = document.getElementById('filter-stats');

    // Timeline state
    let currentView = 'list';
    let timelineZoom = 1;
    let timelinePan = 0;
    let timelineData = [];

    // Advanced filtering functions
    function toggleAdvancedFilters(show) {
        const isVisible = advancedFiltersPanel.style.display !== 'none';
        const shouldShow = show !== undefined ? show : !isVisible;

        advancedFiltersPanel.style.display = shouldShow ? 'block' : 'none';
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

    function applyAdvancedFilters() {
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

        // Close the filter panel
        toggleAdvancedFilters(false);
    }

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

        detailContent.innerHTML = html;
        detailTitle.textContent = `Variable History: ${variableName}`;
        detailActions.innerHTML = '<button class="btn-secondary" data-action="back">Back to History</button>';

        // Add event listeners for detail action buttons
        detailActions.addEventListener('click', handleDetailActionClick);

        historyList.style.display = 'none';
        historyDetail.style.display = 'block';
    }

    // Initialize
    function init() {
        // Event listeners with null checks
        if (refreshBtn) refreshBtn.addEventListener('click', loadHistory);
        if (searchInput) searchInput.addEventListener('input', filterHistory);
        if (filterSelect) filterSelect.addEventListener('change', filterHistory);
        if (backBtn) backBtn.addEventListener('click', showHistoryList);

        // Advanced filter listeners with null checks
        if (advancedFiltersBtn) advancedFiltersBtn.addEventListener('click', toggleAdvancedFilters);
        if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', applyAdvancedFilters);
        if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearAdvancedFilters);
        if (closeFiltersBtn) closeFiltersBtn.addEventListener('click', () => toggleAdvancedFilters(false));

        // Date preset listener with null check
        if (datePresetSelect) datePresetSelect.addEventListener('change', handleDatePresetChange);

        // Regex validation with null checks
        if (advancedSearchInput) advancedSearchInput.addEventListener('input', validateRegexInput);
        if (regexToggle) regexToggle.addEventListener('change', validateRegexInput);

        // View toggle listeners with null checks
        if (listViewBtn) listViewBtn.addEventListener('click', () => switchView('list'));
        if (timelineViewBtn) timelineViewBtn.addEventListener('click', () => switchView('timeline'));
        if (analyticsViewBtn) analyticsViewBtn.addEventListener('click', () => switchView('analytics'));

        // Timeline control listeners with null checks
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomTimeline(1.2));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomTimeline(0.8));
        if (fitToScreenBtn) fitToScreenBtn.addEventListener('click', fitTimelineToScreen);

        // Event delegation for history item buttons
        if (historyList) historyList.addEventListener('click', handleHistoryItemClick);

        // Listen for messages from extension
        window.addEventListener('message', handleMessage);

        // Load filter options on init
        loadFilterOptions();
    }

    function loadHistory() {
        if (!currentWorkspace) return;

        vscode.postMessage({
            type: 'loadHistory',
            workspacePath: currentWorkspace
        });

        showLoading();
    }

    function loadAnalytics() {
        if (!currentWorkspace) return;

        vscode.postMessage({
            type: 'loadAnalytics',
            workspacePath: currentWorkspace
        });

        analyticsContent.innerHTML = '<div class="loading">Loading analytics...</div>';
    }

    function showLoading() {
        historyList.innerHTML = '<div class="loading">Loading history...</div>';
    }

    function handleHistoryItemClick(event) {
        const target = event.target;
        if (!target.classList.contains('btn-small')) return;

        const action = target.getAttribute('data-action');
        const entryId = target.getAttribute('data-entry-id');

        if (!action || !entryId) return;

        switch (action) {
            case 'view':
                viewEntry(entryId);
                break;
            case 'diff':
                showDiff(entryId);
                break;
            case 'rollback':
                rollback(entryId);
                break;
        }
    }

    function handleDetailActionClick(event) {
        const target = event.target;
        if (!target.matches('button[data-action]')) return;

        const action = target.getAttribute('data-action');
        const entryId = target.getAttribute('data-entry-id');

        switch (action) {
            case 'copy':
                if (entryId) copyContent(entryId);
                break;
            case 'diff':
                if (entryId) showDiff(entryId);
                break;
            case 'rollback':
                if (entryId) rollback(entryId);
                break;
            case 'view':
                if (entryId) viewEntry(entryId);
                break;
            case 'back':
                showHistoryList();
                break;
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
                displayHistory(message.history, message.stats);
                break;
            case 'analyticsLoaded':
                displayAnalytics(message.analytics);
                break;
            case 'entryContent':
                showEntryContent(message.entry);
                break;
            case 'diffContent':
                showDiffContent(message.diff, message.entry);
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

    // View switching functions
    function switchView(view) {
        currentView = view;

        // Update button states
        document.querySelectorAll('.view-toggle').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-view="${view}"]`).classList.add('active');

        // Show/hide views
        if (view === 'list') {
            historyList.style.display = 'block';
            timelineContainer.style.display = 'none';
            analyticsContainer.style.display = 'none';
            renderHistoryList();
        } else if (view === 'timeline') {
            historyList.style.display = 'none';
            timelineContainer.style.display = 'block';
            analyticsContainer.style.display = 'none';
            renderTimeline();
        } else if (view === 'analytics') {
            historyList.style.display = 'none';
            timelineContainer.style.display = 'none';
            analyticsContainer.style.display = 'block';
            loadAnalytics();
        }
    }

    // Timeline functions
    function renderTimeline() {
        if (filteredHistory.length === 0) {
            timelineContent.innerHTML = `
                <defs>
                    <linearGradient id="emptyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#64748b;stop-opacity:0.3" />
                        <stop offset="100%" style="stop-color:#64748b;stop-opacity:0.1" />
                    </linearGradient>
                </defs>
                <rect x="0" y="0" width="100%" height="100%" fill="url(#emptyGradient)" rx="12"/>
                <text x="50%" y="40%" text-anchor="middle" fill="#64748b" font-size="18" font-weight="500">No history entries found</text>
                <text x="50%" y="55%" text-anchor="middle" fill="#64748b" font-size="14" opacity="0.7">Try adjusting your search filters</text>
            `;
            return;
        }

        // Prepare timeline data (oldest to newest)
        timelineData = [...filteredHistory].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const containerWidth = timelineSvg.clientWidth || 800;
        const containerHeight = 400;
        const margin = { top: 60, right: 60, bottom: 80, left: 60 };
        const width = containerWidth - margin.left - margin.right;
        const height = containerHeight - margin.top - margin.bottom;

        // Calculate time range
        const startTime = new Date(timelineData[0].timestamp);
        const endTime = new Date(timelineData[timelineData.length - 1].timestamp);
        const timeRange = endTime - startTime;

        // Clear previous content
        timelineContent.innerHTML = '';

        // Create gradient definitions
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        gradient.setAttribute('id', 'timelineGradient');
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y2', '0%');
        gradient.innerHTML = `
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:0.1" />
            <stop offset="50%" style="stop-color:#764ba2;stop-opacity:0.1" />
            <stop offset="100%" style="stop-color:#667eea;stop-opacity:0.1" />
        `;
        defs.appendChild(gradient);

        // Add shadow filter
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'timelineShadow');
        filter.innerHTML = `
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.2)"/>
        `;
        defs.appendChild(filter);

        timelineContent.appendChild(defs);

        // Create background gradient
        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.setAttribute('x', '0');
        background.setAttribute('y', '0');
        background.setAttribute('width', containerWidth);
        background.setAttribute('height', containerHeight);
        background.setAttribute('fill', 'url(#timelineGradient)');
        background.setAttribute('rx', '12');
        timelineContent.appendChild(background);

        // Create time axis with enhanced styling
        const timeAxis = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        timeAxis.setAttribute('class', 'time-axis');

        // Add time labels with better positioning
        const numLabels = Math.min(12, timelineData.length);
        for (let i = 0; i < numLabels; i++) {
            const index = Math.floor((i / (numLabels - 1)) * (timelineData.length - 1));
            const entry = timelineData[index];
            const x = margin.left + (width * (new Date(entry.timestamp) - startTime) / timeRange);

            // Time label background
            const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            labelBg.setAttribute('x', x - 30);
            labelBg.setAttribute('y', height + margin.top + 25);
            labelBg.setAttribute('width', '60');
            labelBg.setAttribute('height', '20');
            labelBg.setAttribute('fill', 'rgba(255,255,255,0.9)');
            labelBg.setAttribute('stroke', 'rgba(0,0,0,0.1)');
            labelBg.setAttribute('stroke-width', '1');
            labelBg.setAttribute('rx', '10');
            labelBg.setAttribute('filter', 'url(#timelineShadow)');
            timeAxis.appendChild(labelBg);

            // Time label text
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', x);
            label.setAttribute('y', height + margin.top + 38);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('class', 'time-label');
            label.setAttribute('font-size', '11');
            label.setAttribute('font-weight', '500');
            label.setAttribute('fill', '#374151');
            label.textContent = formatTimelineDate(entry.timestamp);
            timeAxis.appendChild(label);
        }

        timelineContent.appendChild(timeAxis);

        // Create timeline nodes with enhanced visuals
        timelineData.forEach((entry, index) => {
            const x = margin.left + (width * (new Date(entry.timestamp) - startTime) / timeRange);
            const y = margin.top + height / 2;

            // Create node group
            const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodeGroup.setAttribute('class', 'timeline-node');
            nodeGroup.setAttribute('data-entry-id', entry.id);
            nodeGroup.style.cursor = 'pointer';

            // Create connecting line (except for first node) with gradient
            if (index > 0) {
                const prevEntry = timelineData[index - 1];
                const prevX = margin.left + (width * (new Date(prevEntry.timestamp) - startTime) / timeRange);

                // Line gradient
                const lineGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                lineGradient.setAttribute('id', `lineGradient-${index}`);
                lineGradient.setAttribute('x1', '0%');
                lineGradient.setAttribute('y1', '0%');
                lineGradient.setAttribute('x2', '100%');
                lineGradient.setAttribute('y2', '0%');

                const startColor = getActionColor(prevEntry.action);
                const endColor = getActionColor(entry.action);

                lineGradient.innerHTML = `
                    <stop offset="0%" style="stop-color:${startColor}" />
                    <stop offset="100%" style="stop-color:${endColor}" />
                `;
                defs.appendChild(lineGradient);

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', prevX);
                line.setAttribute('y1', y);
                line.setAttribute('x2', x);
                line.setAttribute('y2', y);
                line.setAttribute('stroke', `url(#lineGradient-${index})`);
                line.setAttribute('stroke-width', '3');
                line.setAttribute('filter', 'url(#timelineShadow)');
                line.style.opacity = '0.8';
                timelineContent.appendChild(line);
            }

            // Create enhanced node with multiple layers
            const nodeContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodeContainer.setAttribute('class', 'timeline-node-container');

            // Outer glow ring
            const glowRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            glowRing.setAttribute('cx', x);
            glowRing.setAttribute('cy', y);
            glowRing.setAttribute('r', '18');
            glowRing.setAttribute('fill', getActionColor(entry.action));
            glowRing.setAttribute('opacity', '0.2');
            glowRing.setAttribute('filter', 'blur(4px)');
            nodeContainer.appendChild(glowRing);

            // Main node circle with gradient
            const circleGradient = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
            circleGradient.setAttribute('id', `circleGradient-${entry.id}`);
            circleGradient.setAttribute('cx', '50%');
            circleGradient.setAttribute('cy', '30%');
            circleGradient.setAttribute('r', '70%');
            circleGradient.innerHTML = `
                <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.9" />
                <stop offset="70%" style="stop-color:${getActionColor(entry.action)};stop-opacity:0.9" />
                <stop offset="100%" style="stop-color:${getActionColor(entry.action)};stop-opacity:1" />
            `;
            defs.appendChild(circleGradient);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', y);
            circle.setAttribute('r', '14');
            circle.setAttribute('fill', `url(#circleGradient-${entry.id})`);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '2');
            circle.setAttribute('filter', 'url(#timelineShadow)');
            circle.setAttribute('class', `timeline-circle action-${entry.action}`);
            nodeContainer.appendChild(circle);

            // Action icon with better positioning
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            icon.setAttribute('x', x);
            icon.setAttribute('y', y + 5);
            icon.setAttribute('text-anchor', 'middle');
            icon.setAttribute('class', 'timeline-icon');
            icon.setAttribute('font-size', '12');
            icon.setAttribute('font-weight', 'bold');
            icon.setAttribute('fill', '#ffffff');
            icon.setAttribute('filter', 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))');
            icon.textContent = getActionIcon(entry.action);
            icon.style.pointerEvents = 'none';
            nodeContainer.appendChild(icon);

            nodeGroup.appendChild(nodeContainer);

            // Enhanced tooltip with HTML content
            const tooltipGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tooltipGroup.setAttribute('class', 'timeline-tooltip');
            tooltipGroup.setAttribute('opacity', '0');
            tooltipGroup.setAttribute('pointer-events', 'none');

            // Tooltip background
            const tooltipBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            tooltipBg.setAttribute('x', x - 100);
            tooltipBg.setAttribute('y', y - 80);
            tooltipBg.setAttribute('width', '200');
            tooltipBg.setAttribute('height', '60');
            tooltipBg.setAttribute('fill', 'rgba(0,0,0,0.9)');
            tooltipBg.setAttribute('stroke', 'rgba(255,255,255,0.2)');
            tooltipBg.setAttribute('stroke-width', '1');
            tooltipBg.setAttribute('rx', '8');
            tooltipBg.setAttribute('filter', 'url(#timelineShadow)');
            tooltipGroup.appendChild(tooltipBg);

            // Tooltip text
            const tooltipTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            tooltipTitle.setAttribute('x', x);
            tooltipTitle.setAttribute('y', y - 60);
            tooltipTitle.setAttribute('text-anchor', 'middle');
            tooltipTitle.setAttribute('font-size', '12');
            tooltipTitle.setAttribute('font-weight', 'bold');
            tooltipTitle.setAttribute('fill', '#ffffff');
            tooltipTitle.textContent = `${entry.action.toUpperCase()}: ${entry.environmentName}`;
            tooltipGroup.appendChild(tooltipTitle);

            const tooltipDetails = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            tooltipDetails.setAttribute('x', x);
            tooltipDetails.setAttribute('y', y - 45);
            tooltipDetails.setAttribute('text-anchor', 'middle');
            tooltipDetails.setAttribute('font-size', '10');
            tooltipDetails.setAttribute('fill', '#cccccc');
            tooltipDetails.textContent = formatTimestamp(entry.timestamp);
            tooltipGroup.appendChild(tooltipDetails);

            if (entry.user) {
                const tooltipUser = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tooltipUser.setAttribute('x', x);
                tooltipUser.setAttribute('y', y - 30);
                tooltipUser.setAttribute('text-anchor', 'middle');
                tooltipUser.setAttribute('font-size', '10');
                tooltipUser.setAttribute('fill', '#cccccc');
                tooltipUser.textContent = `👤 ${entry.user}`;
                tooltipGroup.appendChild(tooltipUser);
            }

            nodeGroup.appendChild(tooltipGroup);

            // Enhanced hover interactions
            nodeGroup.addEventListener('mouseenter', () => {
                // Scale up the node
                nodeContainer.setAttribute('transform', `scale(1.2) translate(${(x * -0.2)}, ${(y * -0.2)})`);

                // Show tooltip
                tooltipGroup.setAttribute('opacity', '1');

                // Animate the glow
                glowRing.setAttribute('r', '22');
                glowRing.setAttribute('opacity', '0.4');
            });

            nodeGroup.addEventListener('mouseleave', () => {
                // Reset scale
                nodeContainer.setAttribute('transform', 'scale(1)');

                // Hide tooltip
                tooltipGroup.setAttribute('opacity', '0');

                // Reset glow
                glowRing.setAttribute('r', '18');
                glowRing.setAttribute('opacity', '0.2');
            });

            // Click handler
            nodeGroup.addEventListener('click', () => viewEntry(entry.id));

            timelineContent.appendChild(nodeGroup);
        });

        // Update zoom level display
        updateZoomLevel();

        // Render enhanced minimap
        if (timelineData.length > 5) {
            renderMinimap();
            timelineMinimap.style.display = 'block';
        } else {
            timelineMinimap.style.display = 'none';
        }
    }

    function getActionIcon(action) {
        switch (action) {
            case 'switch': return '🔄';
            case 'rollback': return '↩️';
            case 'manual_edit': return '✏️';
            case 'import': return '📥';
            case 'initial': return '🎯';
            default: return '●';
        }
    }

    function getActionColor(action) {
        switch (action) {
            case 'switch': return '#3b82f6'; // Blue
            case 'rollback': return '#ef4444'; // Red
            case 'manual_edit': return '#f59e0b'; // Orange
            case 'import': return '#10b981'; // Green
            case 'initial': return '#8b5cf6'; // Purple
            default: return '#64748b'; // Gray
        }
    }

    function formatTimelineDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString();
    }

    function zoomTimeline(factor) {
        timelineZoom *= factor;
        timelineZoom = Math.max(0.1, Math.min(5, timelineZoom));

        // Apply zoom transform
        timelineContent.setAttribute('transform', `scale(${timelineZoom}) translate(${timelinePan}, 0)`);

        updateZoomLevel();
    }

    function fitTimelineToScreen() {
        timelineZoom = 1;
        timelinePan = 0;
        timelineContent.setAttribute('transform', 'scale(1) translate(0, 0)');
        updateZoomLevel();
    }

    function updateZoomLevel() {
        zoomLevel.textContent = `${Math.round(timelineZoom * 100)}%`;
    }

    function renderMinimap() {
        // Clear previous minimap
        minimapSvg.innerHTML = '';

        if (timelineData.length === 0) return;

        const minimapWidth = minimapSvg.clientWidth || 200;
        const minimapHeight = 60;
        const padding = 10;

        // Calculate time range for minimap
        const startTime = new Date(timelineData[0].timestamp);
        const endTime = new Date(timelineData[timelineData.length - 1].timestamp);
        const timeRange = endTime - startTime;

        // Create minimap background
        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.setAttribute('x', '0');
        background.setAttribute('y', '0');
        background.setAttribute('width', minimapWidth);
        background.setAttribute('height', minimapHeight);
        background.setAttribute('fill', 'rgba(255, 255, 255, 0.1)');
        background.setAttribute('stroke', 'rgba(255, 255, 255, 0.2)');
        background.setAttribute('stroke-width', '1');
        background.setAttribute('rx', '4');
        minimapSvg.appendChild(background);

        // Create minimap nodes
        timelineData.forEach((entry) => {
            const x = padding + ((minimapWidth - 2 * padding) * (new Date(entry.timestamp) - startTime) / timeRange);
            const y = minimapHeight / 2;

            // Create minimap dot
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', x);
            dot.setAttribute('cy', y);
            dot.setAttribute('r', '3');

            // Color based on action type
            let color = '#64748b'; // default
            switch (entry.action) {
                case 'switch': color = '#3b82f6'; break;
                case 'rollback': color = '#ef4444'; break;
                case 'manual_edit': color = '#f59e0b'; break;
                case 'import': color = '#10b981'; break;
                case 'initial': color = '#8b5cf6'; break;
            }
            dot.setAttribute('fill', color);
            dot.setAttribute('stroke', 'white');
            dot.setAttribute('stroke-width', '1');

            minimapSvg.appendChild(dot);
        });

        // Add viewport indicator (showing current visible area)
        const viewportIndicator = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const viewportWidth = Math.min(minimapWidth - 2 * padding, (minimapWidth - 2 * padding) / timelineZoom);
        const viewportX = padding + Math.max(0, Math.min(minimapWidth - 2 * padding - viewportWidth, timelinePan * (minimapWidth - 2 * padding) / 100));

        viewportIndicator.setAttribute('x', viewportX);
        viewportIndicator.setAttribute('y', '2');
        viewportIndicator.setAttribute('width', viewportWidth);
        viewportIndicator.setAttribute('height', minimapHeight - 4);
        viewportIndicator.setAttribute('fill', 'none');
        viewportIndicator.setAttribute('stroke', '#3b82f6');
        viewportIndicator.setAttribute('stroke-width', '2');
        viewportIndicator.setAttribute('stroke-dasharray', '2,2');
        viewportIndicator.setAttribute('rx', '2');

        minimapSvg.appendChild(viewportIndicator);
    }

    function displayHistory(history, stats) {
        currentHistory = history;
        updateStats(stats);
        filterHistory();

        // Re-render timeline if currently viewing it
        if (currentView === 'timeline') {
            renderTimeline();
        }
    }

    function displayAnalytics(analytics) {
        if (!analytics) {
            analyticsContent.innerHTML = '<div class="empty-state">No analytics data available</div>';
            return;
        }

        const html = `
            <div class="analytics-dashboard">
                <div class="analytics-section">
                    <h3>📊 Usage Patterns</h3>
                    <div class="analytics-grid">
                        <div class="analytics-card">
                            <h4>Most Used Environments</h4>
                            <div class="top-list">
                                ${Object.entries(analytics.usagePatterns.environmentFrequency)
                                    .sort(([,a], [,b]) => b - a)
                                    .slice(0, 5)
                                    .map(([env, count]) => `<div class="list-item"><span>${env}</span><span class="count">${count}</span></div>`)
                                    .join('')}
                            </div>
                        </div>
                        <div class="analytics-card">
                            <h4>Peak Activity Hours</h4>
                            <div class="top-list">
                                ${Object.entries(analytics.usagePatterns.peakHours)
                                    .sort(([,a], [,b]) => b - a)
                                    .slice(0, 5)
                                    .map(([hour, count]) => `<div class="list-item"><span>${formatHour(parseInt(hour))}</span><span class="count">${count}</span></div>`)
                                    .join('')}
                            </div>
                        </div>
                        <div class="analytics-card">
                            <h4>Common Transitions</h4>
                            <div class="top-list">
                                ${analytics.usagePatterns.commonTransitions.slice(0, 5)
                                    .map(t => `<div class="list-item"><span>${t.from} → ${t.to}</span><span class="count">${t.count}</span></div>`)
                                    .join('')}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="analytics-section">
                    <h3>📈 Stability Metrics</h3>
                    <div class="analytics-grid">
                        <div class="analytics-card">
                            <h4>Environment Stability</h4>
                            <div class="stability-list">
                                ${Object.entries(analytics.stabilityMetrics.stabilityScore)
                                    .sort(([,a], [,b]) => b - a)
                                    .slice(0, 5)
                                    .map(([env, score]) => `
                                        <div class="stability-item">
                                            <span>${env}</span>
                                            <div class="stability-bar">
                                                <div class="stability-fill" style="width: ${score}%"></div>
                                            </div>
                                            <span class="score">${Math.round(score)}%</span>
                                        </div>
                                    `)
                                    .join('')}
                            </div>
                        </div>
                        <div class="analytics-card">
                            <h4>Change Frequency</h4>
                            <div class="top-list">
                                ${Object.entries(analytics.stabilityMetrics.churnRate)
                                    .sort(([,a], [,b]) => b - a)
                                    .slice(0, 5)
                                    .map(([env, rate]) => `<div class="list-item"><span>${env}</span><span class="count">${rate.toFixed(1)}/day</span></div>`)
                                    .join('')}
                            </div>
                        </div>
                        <div class="analytics-card">
                            <h4>Average Time Between Changes</h4>
                            <div class="top-list">
                                ${Object.entries(analytics.stabilityMetrics.avgTimeBetweenChanges)
                                    .sort(([,a], [,b]) => a - b)
                                    .slice(0, 5)
                                    .map(([env, hours]) => `<div class="list-item"><span>${env}</span><span class="count">${hours.toFixed(1)}h</span></div>`)
                                    .join('')}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="analytics-section">
                    <h3>🔄 Variable Change Frequency</h3>
                    <div class="analytics-card full-width">
                        <h4>Most Frequently Changed Variables</h4>
                        <div class="variable-list">
                            ${Object.entries(analytics.variableAnalytics.changeFrequency)
                                .sort(([,a], [,b]) => b - a)
                                .slice(0, 10)
                                .map(([variable, changes]) => `
                                    <div class="variable-item">
                                        <div class="variable-info">
                                            <span class="variable-name">${variable}</span>
                                            <span class="variable-value">${analytics.variableAnalytics.currentValue[variable] || 'N/A'}</span>
                                        </div>
                                        <div class="variable-stats">
                                            <span class="changes">${changes} changes</span>
                                            <span class="velocity">${analytics.variableAnalytics.changeVelocity[variable] ? analytics.variableAnalytics.changeVelocity[variable].toFixed(1) + '/day' : 'N/A'}</span>
                                        </div>
                                    </div>
                                `)
                                .join('')}
                        </div>
                    </div>
                </div>

                <div class="analytics-section">
                    <h3>📅 Activity Heatmap</h3>
                    <div class="analytics-card full-width">
                        <h4>Daily Activity (Last 30 Days)</h4>
                        <div class="heatmap-container">
                            <div class="heatmap-grid">
                                ${generateHeatmapGrid(analytics.activityHeatmap.calendar)}
                            </div>
                            <div class="heatmap-legend">
                                <span>Less</span>
                                <div class="legend-colors">
                                    <div class="legend-color" style="background-color: #ebedf0"></div>
                                    <div class="legend-color" style="background-color: #9be9a8"></div>
                                    <div class="legend-color" style="background-color: #40c463"></div>
                                    <div class="legend-color" style="background-color: #30a14e"></div>
                                    <div class="legend-color" style="background-color: #216e39"></div>
                                </div>
                                <span>More</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="analytics-footer">
                    <p class="analytics-meta">
                        Generated: ${new Date(analytics.generatedAt).toLocaleString()} |
                        Data Range: ${new Date(analytics.dataRange.start).toLocaleDateString()} - ${new Date(analytics.dataRange.end).toLocaleDateString()} |
                        Total Entries: ${analytics.dataRange.totalEntries}
                    </p>
                </div>
            </div>
        `;

        analyticsContent.innerHTML = html;
    }

    function generateHeatmapGrid(calendarData) {
        const today = new Date();
        const days = [];
        
        // Generate last 30 days
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const count = calendarData[dateStr] || 0;
            days.push({ date, dateStr, count });
        }

        return days.map(day => {
            const intensity = Math.min(day.count / 5, 1); // Max 5 changes = full intensity
            const color = getHeatmapColor(intensity);
            return `<div class="heatmap-cell" style="background-color: ${color}" title="${day.dateStr}: ${day.count} changes"></div>`;
        }).join('');
    }

    function getHeatmapColor(intensity) {
        if (intensity === 0) return '#ebedf0';
        if (intensity < 0.25) return '#9be9a8';
        if (intensity < 0.5) return '#40c463';
        if (intensity < 0.75) return '#30a14e';
        return '#216e39';
    }

    function formatHour(hour) {
        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour} ${period}`;
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

        // Render appropriate view
        if (currentView === 'list') {
            renderHistoryList();
        } else if (currentView === 'timeline') {
            renderTimeline();
        }
    }

    function renderHistoryList() {
        if (filteredHistory.length === 0) {
            historyList.innerHTML = '<div class="empty-state">No history entries found</div>';
            return;
        }

        const html = filteredHistory.map(entry => `
            <div class="history-item" data-entry-id="${entry.id}">
                <div class="history-item-header">
                    <span class="action-badge action-${entry.action}">${entry.action.toUpperCase()}</span>
                    <span class="environment-name">${entry.environmentName}</span>
                    <span class="filename">(${getDisplayFileName(entry)})</span>
                    <span class="timestamp">${formatTimestamp(entry.timestamp)}</span>
                </div>
                <div class="history-item-details">
                    ${entry.previousEnvironment ?
                        `<span class="transition">From: ${entry.previousEnvironment} → To: ${entry.environmentName}</span>` :
                        `<span class="environment">Environment: ${entry.environmentName}</span>`
                    }
                    ${entry.user ? `<span class="user">User: ${entry.user}</span>` : ''}
                    ${entry.metadata.reason ? `<span class="reason">${entry.metadata.reason}</span>` : ''}
                </div>
                <div class="history-item-actions">
                    <button class="btn-small" data-action="view" data-entry-id="${entry.id}">View</button>
                    <button class="btn-small" data-action="diff" data-entry-id="${entry.id}">Diff</button>
                    <button class="btn-small btn-danger" data-action="rollback" data-entry-id="${entry.id}">Rollback</button>
                </div>
            </div>
        `).join('');

        historyList.innerHTML = html;

        // Add click handlers
        document.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const entryId = item.dataset.entryId;
                if (entryId) {
                    viewEntry(entryId);
                }
            });
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

    function viewEntry(entryId) {
        vscode.postMessage({
            type: 'viewEntry',
            entryId: entryId,
            workspacePath: currentWorkspace
        });
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

    function showEntryContent(entry) {
        detailTitle.textContent = `${entry.action.toUpperCase()}: ${entry.environmentName}`;
        detailContent.innerHTML = `
            <pre class="env-content">${escapeHtml(entry.fileContent)}</pre>
        `;

        detailActions.innerHTML = `
            <button class="btn-primary" data-action="copy" data-entry-id="${entry.id}">Copy Content</button>
            <button class="btn-secondary" data-action="diff" data-entry-id="${entry.id}">View Diff</button>
            <button class="btn-danger" data-action="rollback" data-entry-id="${entry.id}">Rollback</button>
        `;

        // Add event listeners for detail action buttons
        detailActions.addEventListener('click', handleDetailActionClick);

        historyList.style.display = 'none';
        historyDetail.style.display = 'block';
    }

    function showDiffContent(diffText, entry) {
        detailTitle.textContent = `Diff: ${entry.environmentName} vs Current`;

        // Enhanced diff display with syntax highlighting
        const highlightedDiff = highlightDiff(diffText);

        detailContent.innerHTML = `
            <div class="diff-container">
                <div class="diff-header">
                    <span class="diff-title">Changes Overview</span>
                    <div class="diff-stats">
                        ${entry.diff && entry.diff.added ? `<span class="diff-added">+${entry.diff.added.length}</span>` : ''}
                        ${entry.diff && entry.diff.removed ? `<span class="diff-removed">-${entry.diff.removed.length}</span>` : ''}
                        ${entry.diff && entry.diff.changed ? `<span class="diff-changed">~${entry.diff.changed.length}</span>` : ''}
                    </div>
                </div>
                <pre class="diff-content">${highlightedDiff}</pre>
                ${entry.diff && entry.diff.changed && entry.diff.changed.length > 0 ? `
                    <div class="blame-info">
                        <h4>Change Details with Blame Information</h4>
                        <div class="blame-list">
                            ${entry.diff.changed.map(change => `
                                <div class="blame-item">
                                    <div class="blame-variable">
                                        <strong>${change.variable.key}</strong>
                                        <span class="blame-change">${change.oldValue} → ${change.newValue}</span>
                                    </div>
                                    ${change.blame ? `
                                        <div class="blame-details">
                                            <span class="blame-user">👤 ${change.blame.user || 'Unknown'}</span>
                                            <span class="blame-time">🕒 ${change.blame.timestamp ? new Date(change.blame.timestamp).toLocaleString() : 'Unknown'}</span>
                                            ${change.blame.commitHash ? `<span class="blame-commit">🔗 ${change.blame.commitHash.substring(0, 7)}</span>` : ''}
                                        </div>
                                    ` : `
                                        <div class="blame-details">
                                            <span class="blame-unknown">No blame information available</span>
                                        </div>
                                    `}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        detailActions.innerHTML = `
            <button class="btn-secondary" data-action="view" data-entry-id="${entry.id}">View Content</button>
            <button class="btn-danger" data-action="rollback" data-entry-id="${entry.id}">Rollback</button>
        `;

        // Add event listeners for detail action buttons
        detailActions.addEventListener('click', handleDetailActionClick);

        historyList.style.display = 'none';
        historyDetail.style.display = 'block';
    }

    function highlightDiff(diffText) {
        if (!diffText) return escapeHtml(diffText);

        // Split into lines and process each line
        const lines = diffText.split('\n');
        const highlightedLines = lines.map(line => {
            if (line.startsWith('+')) {
                return `<span class="diff-line-added">${escapeHtml(line)}</span>`;
            } else if (line.startsWith('-')) {
                return `<span class="diff-line-removed">${escapeHtml(line)}</span>`;
            } else if (line.startsWith('@@')) {
                return `<span class="diff-line-hunk">${escapeHtml(line)}</span>`;
            } else {
                return `<span class="diff-line-context">${escapeHtml(line)}</span>`;
            }
        });

        return highlightedLines.join('\n');
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

    function showHistoryList() {
        historyDetail.style.display = 'none';
        historyList.style.display = 'block';
    }

    function copyContent(entryId) {
        vscode.postMessage({
            type: 'copyContent',
            entryId: entryId,
            workspacePath: currentWorkspace
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Make functions global for onclick handlers
    window.viewEntry = viewEntry;
    window.showDiff = showDiff;
    window.rollback = rollback;
    window.copyContent = copyContent;

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
