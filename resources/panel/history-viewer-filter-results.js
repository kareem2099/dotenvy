/**
 * Renders filtered history results and per-variable history in the history viewer.
 */
window.dotenvyHistoryFilterResults = {
    /**
     * @param {object} ctx shared viewer state passed through from the filter binder
     */
    create(ctx) {
        function tr(key, params, fallback) { return ctx.tr(key, params, fallback); }
        function escapeHtml(text) { return ctx.escapeHtml(text); }
        function formatTimestamp(timestamp) { return ctx.formatTimestamp(timestamp); }
        const filterStats = ctx.elements.filterStats;

    function displayFilteredHistory(result) {
        ctx.setFilteredEntries(result.entries);

        // Update stats
        ctx.updateStats({
            totalEntries: result.totalCount,
            storageSize: 0 // We don't have storage size for filtered results
        });

        // Render appropriate view
        if (ctx.getCurrentView() === 'list') {
            ctx.renderHistoryList();
        } else if (ctx.getCurrentView() === 'timeline' && typeof ctx.renderTimeline === 'function') {
            ctx.renderTimeline();
        }
    }

    function formatSearchScope(scope) {
        const scopeKeys = {
            all: 'history.scopeAll',
            environments: 'history.scopeEnvs',
            variables: 'history.scopeVars',
            values: 'history.scopeVals',
        };
        const key = scopeKeys[scope] || scopeKeys.all;
        return tr(key, {}, scope);
    }

    function formatAppliedFilterTag(tag) {
        if (!tag || !tag.kind) { return ''; }
        switch (tag.kind) {
            case 'dateRange':
                return tr('history.appliedTagDateRange', {}, 'Date range');
            case 'search':
                return tr(
                    'history.appliedTagSearch',
                    { scope: formatSearchScope(tag.scope || 'all') },
                    `Search (${tag.scope || 'all'})`
                );
            case 'users':
                return tr('history.appliedTagUsers', { count: tag.count }, `Users (${tag.count})`);
            case 'environments':
                return tr('history.appliedTagEnvironments', { count: tag.count }, `Environments (${tag.count})`);
            case 'actions':
                return tr('history.appliedTagActions', { count: tag.count }, `Actions (${tag.count})`);
            case 'variables':
                return tr('history.appliedTagVariables', { count: tag.count }, `Variables (${tag.count})`);
            default:
                return '';
        }
    }

    function getAppliedFilterLabels(result) {
        const tags = result.appliedFilterTags || [];
        if (tags.length > 0) {
            return tags.map(formatAppliedFilterTag).filter(Boolean);
        }
        if (result.appliedFilters && result.appliedFilters.length > 0) {
            return result.appliedFilters;
        }
        return [];
    }

    function updateFilterStats(result) {
        if (!result || result.totalCount === undefined) {
            if (filterStats) { filterStats.innerHTML = ''; }
            return;
        }
        const labels = getAppliedFilterLabels(result);

        const showing = tr(
            'history.filterStatsShowing',
            { filtered: result.filteredCount, total: result.totalCount },
            `Showing ${result.filteredCount} of ${result.totalCount} entries`
        );
        const applied = labels.length > 0
            ? tr(
                'history.filterStatsApplied',
                { list: labels.join(', ') },
                `Filters: ${labels.join(', ')}`
            )
            : '';
        filterStats.innerHTML = `
            <div class="filter-stats-content">
                <span class="filter-count">${showing}</span>
                ${applied ? `<span class="applied-filters">${applied}</span>` : ''}
            </div>
        `;
    }

    function formatAction(action) {
        const map = {
            switch: tr('history.actionSwitch', {}, 'Switch'),
            rollback: tr('history.actionRollback', {}, 'Rollback'),
            manual_edit: tr('history.actionEdit', {}, 'Edit'),
            import: tr('history.actionImport', {}, 'Import'),
            initial: tr('history.actionInitial', {}, 'Initial'),
        };
        return map[action] || action.replace(/_/g, ' ');
    }

    function displayVariableHistory(variableName, history) {
        if (!ctx.detailContent) { return; }
        if (history.length === 0) {
            detailContent.innerHTML = `<div class="empty-state">${tr('history.varHistoryEmpty', { name: variableName }, `No history found for variable "${variableName}"`)}</div>`;
            return;
        }

        const html = `
            <div class="variable-history">
                <h4>${tr('history.varHistoryTitle', { name: variableName }, `Change history for "${variableName}"`)}</h4>
                <div class="variable-timeline">
                    ${history.map(item => `
                        <div class="variable-change-item">
                            <div class="variable-change-header">
                                <span class="variable-value">"${escapeHtml(item.value)}"</span>
                                <span class="variable-timestamp">${formatTimestamp(item.timestamp)}</span>
                            </div>
                            <div class="variable-change-details">
                                <span class="variable-environment">${item.entry.environmentName}</span>
                                ${item.entry.user ? `<span class="variable-user">${tr('history.byUser', { user: item.entry.user }, `by ${item.entry.user}`)}</span>` : ''}
                                ${item.entry.metadata.reason ? `<span class="variable-reason">${item.entry.metadata.reason}</span>` : ''}
                            </div>
                            <div class="variable-change-actions">
                                <button type="button" class="btn-small" data-action="view" data-entry-id="${item.entry.id}">${tr('history.viewEntryBtn', {}, 'View entry')}</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

    }

        return {
            displayFilteredHistory,
            updateFilterStats,
            formatAction,
            displayVariableHistory,
        };
    }
};
