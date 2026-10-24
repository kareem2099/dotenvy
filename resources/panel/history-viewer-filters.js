/**
 * Advanced history filters for the history viewer webview.
 * Attached as window.dotenvyHistoryFilters. State comes from the context
 * object passed to create(); currentWorkspace stays in the list script.
 */
window.dotenvyHistoryFilters = {
    /**
     * @param {object} ctx shared viewer state and DOM elements
     */
    create(ctx) {
        const vscode = ctx.vscode;
        function tr(key, params, fallback) { return ctx.tr(key, params, fallback); }
        function escapeHtml(text) { return ctx.escapeHtml(text); }
        function formatTimestamp(timestamp) { return ctx.formatTimestamp(timestamp); }
        const {
            advancedFiltersPanel,
            advancedFiltersBackdrop,
            advancedFiltersBtn,
            advancedSearchInput,
            regexToggle,
            searchScopeSelect,
            datePresetSelect,
            dateFromInput,
            dateToInput,
            userFilterSelect,
            actionFilterSelect,
            environmentFilterSelect,
            variableFilterSelect,
            filterStats,
        } = ctx.elements;

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
            if (window.dotenvyI18n && window.dotenvyI18n.applyTranslations) {
                window.dotenvyI18n.applyTranslations();
            }
        }
    }

    function loadFilterOptions() {
        if (!ctx.getWorkspace()) return;

        vscode.postMessage({
            type: 'getFilterOptions',
            workspacePath: ctx.getWorkspace()
        });
    }

    function applyAdvancedFilters(keepOpen = false) {
        if (!ctx.getWorkspace()) return;

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
            workspacePath: ctx.getWorkspace(),
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

    function populateMultiSelect(selectElement, options) {
        if (!selectElement) { return; }
        selectElement.innerHTML = '';

        if (!options || options.length === 0) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = tr('history.noFilterOptions', {}, 'No items available');
            empty.disabled = true;
            selectElement.appendChild(empty);
            return;
        }

        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option;
            optionElement.textContent = option;
            selectElement.appendChild(optionElement);
        });
    }


    function presetLabel(presetId) {
        const key = 'history.preset.' + presetId;
        const fallbacks = {
            today: 'Today',
            last7days: 'Last 7 days',
            last30days: 'Last 30 days',
            last3months: 'Last 3 months',
            last6months: 'Last 6 months',
            lastyear: 'Last year',
        };
        return tr(key, {}, fallbacks[presetId] || presetId);
    }

    function populateFilterOptions(options) {
        // Populate date presets
        const datePresets = options.dateRangePresets || [];
        const previousPreset = datePresetSelect ? datePresetSelect.value : '';
        datePresetSelect.innerHTML = `<option value="">${tr('history.presetCustomRange', {}, 'Custom range')}</option>`;
        datePresets.forEach(preset => {
            const option = document.createElement('option');
            const id = preset.id || (preset.label ? preset.label.toLowerCase().replace(/\s+/g, '') : '');
            option.value = id;
            option.textContent = presetLabel(id);
            datePresetSelect.appendChild(option);
        });
        if (previousPreset && datePresetSelect.querySelector(`option[value="${previousPreset}"]`)) {
            datePresetSelect.value = previousPreset;
        }

        // Populate users
        populateMultiSelect(userFilterSelect, options.users || []);

        // Populate environments
        populateMultiSelect(environmentFilterSelect, options.environments || []);

        // Populate variables
        populateMultiSelect(variableFilterSelect, options.variables || []);

        if (window.dotenvyI18n && window.dotenvyI18n.applyTranslations) {
            window.dotenvyI18n.applyTranslations();
        }
    }

    function handleRegexValidation(message) {
        const input = advancedSearchInput;
        if (message.valid) {
            input.classList.remove('invalid');
            input.title = '';
        } else {
            input.classList.add('invalid');
            input.title = tr('history.invalidRegex', { error: message.error }, `Invalid regex: ${message.error}`);
        }
    }


        const results = window.dotenvyHistoryFilterResults.create(ctx);
        return {
            toggleAdvancedFilters,
            loadFilterOptions,
            applyAdvancedFilters,
            clearAdvancedFilters,
            handleDatePresetChange,
            liveUpdateFilters,
            populateFilterOptions,
            handleRegexValidation,
            ...results,
        };
    }
};
