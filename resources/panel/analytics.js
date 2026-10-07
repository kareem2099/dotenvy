// Analytics WebView Script
// Renders environment usage analytics in a full WebviewPanel tab
(function () {
    const vscode = acquireVsCodeApi();
    let currentWorkspace = null;

    let currentAnalytics = null;
    let lastErrorDetail = null;

    function tr(key, params, fallback) {
        if (window.dotenvyI18n && typeof window.dotenvyI18n.tr === 'function') {
            return window.dotenvyI18n.tr(key, params, fallback);
        }
        return fallback !== undefined ? fallback : key;
    }

    function notAvailable() {
        return tr('analytics.notAvailable', {}, 'N/A');
    }

    function emptyRowHtml() {
        return `<div class="empty-row">${tr('analytics.noDataYet', {}, 'No data yet')}</div>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    const safeEntries = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
    const safeArr    = (arr) => (Array.isArray(arr) ? arr : []);

    function formatHour(h) {
        const locale = (window.dotenvyI18n && window.dotenvyI18n.getLocale)
            ? window.dotenvyI18n.getLocale()
            : 'en';
        const d = new Date();
        d.setHours(h, 0, 0, 0);
        return d.toLocaleTimeString(locale, { hour: 'numeric', hour12: true });
    }

    function getHeatmapColor(intensity) {
        if (intensity === 0)       return '#ebedf0';
        if (intensity < 0.25)      return '#9be9a8';
        if (intensity < 0.5)       return '#40c463';
        if (intensity < 0.75)      return '#30a14e';
        return '#216e39';
    }

    function generateHeatmapGrid(calendar) {
        if (!calendar || typeof calendar !== 'object') {
            return `<div class="empty-state">${tr('analytics.noHeatmapData', {}, 'No heatmap data yet')}</div>`;
        }
        const today = new Date();
        let html = '';
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const ds = d.toISOString().split('T')[0];
            const count = calendar[ds] || 0;
            const color = getHeatmapColor(Math.min(count / 5, 1));
            const title = tr('analytics.heatmapCellTitle', { date: ds, count }, `${ds}: ${count} changes`);
            html += `<div class="heatmap-cell" style="background:${color}" title="${title}"></div>`;
        }
        return html;
    }

    // ──────────────────────────────────────────────────────────────
    // Render
    // ──────────────────────────────────────────────────────────────
    function displayAnalytics(analytics) {
        const container = document.getElementById('analytics-root');
        if (!container) { return; }

        if (!analytics) {
            container.innerHTML = `
                <div class="empty-panel">
                    <div class="empty-icon">📊</div>
                    <h3>${tr('analytics.noData', {}, 'No Analytics Data Yet')}</h3>
                    <p>${tr('analytics.noDataDesc', {}, 'Make some environment changes and come back to see detailed insights!')}</p>
                    <button type="button" class="btn btn-primary" data-action="retry">${tr('analytics.tryAgain', {}, '🔄 Try Again')}</button>
                </div>`;
            return;
        }

        const envFreq     = safeEntries(analytics.usagePatterns?.environmentFrequency).sort(([,a],[,b]) => b-a).slice(0, 8);
        const peakHours   = safeEntries(analytics.usagePatterns?.peakHours).sort(([,a],[,b]) => b-a).slice(0, 8);
        const transitions = safeArr(analytics.usagePatterns?.commonTransitions).slice(0, 8);
        const stability   = safeEntries(analytics.stabilityMetrics?.stabilityScore).sort(([,a],[,b]) => b-a).slice(0, 8);
        const churn       = safeEntries(analytics.stabilityMetrics?.churnRate).sort(([,a],[,b]) => b-a).slice(0, 8);
        const avgTime     = safeEntries(analytics.stabilityMetrics?.avgTimeBetweenChanges).sort(([,a],[,b]) => a-b).slice(0, 8);
        const varFreq     = safeEntries(analytics.variableAnalytics?.changeFrequency).sort(([,a],[,b]) => b-a).slice(0, 15);

        const locale = (window.dotenvyI18n && window.dotenvyI18n.getLocale)
            ? window.dotenvyI18n.getLocale()
            : undefined;
        const totalEntries = analytics.dataRange?.totalEntries ?? 0;
        const start  = analytics.dataRange?.start ? new Date(analytics.dataRange.start).toLocaleDateString(locale) : notAvailable();
        const end    = analytics.dataRange?.end   ? new Date(analytics.dataRange.end).toLocaleDateString(locale)   : notAvailable();
        const genAt  = analytics.generatedAt ? new Date(analytics.generatedAt).toLocaleString(locale) : notAvailable();
        const totalVars = Object.keys(analytics.variableAnalytics?.changeFrequency ?? {}).length;

        const noVarData = `<div class="empty-row" style="grid-column:1/-1">${tr('analytics.noVariableDataYet', {}, 'No variable data yet')}</div>`;

        container.innerHTML = `
        <!-- ── OVERVIEW STRIP ────────────────────────────────── -->
        <div class="overview-strip">
            <div class="overview-card">
                <div class="ov-value">${totalEntries}</div>
                <div class="ov-label">${tr('analytics.totalEntries', {}, 'Total Entries')}</div>
            </div>
            <div class="overview-card">
                <div class="ov-value">${envFreq.length}</div>
                <div class="ov-label">${tr('analytics.environments', {}, 'Environments')}</div>
            </div>
            <div class="overview-card">
                <div class="ov-value">${totalVars}</div>
                <div class="ov-label">${tr('analytics.uniqueVariables', {}, 'Unique Variables')}</div>
            </div>
            <div class="overview-card">
                <div class="ov-value">${peakHours.length > 0 ? formatHour(parseInt(peakHours[0][0])) : notAvailable()}</div>
                <div class="ov-label">${tr('analytics.peakHour', {}, 'Peak Hour')}</div>
            </div>
        </div>

        <!-- ── USAGE PATTERNS ───────────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">${tr('analytics.usagePatterns', {}, '📊 Usage Patterns')}</h2>
            <div class="card-grid">
                <div class="a-card">
                    <div class="a-card-title">${tr('analytics.mostUsedEnvironments', {}, 'Most Used Environments')}</div>
                    <div class="top-list">
                        ${envFreq.length
                            ? envFreq.map(([env, count]) => `
                                <div class="top-row">
                                    <span class="top-name" title="${env}">${env}</span>
                                    <div class="top-bar-wrap">
                                        <div class="top-bar" style="width:${Math.round((count / (envFreq[0][1] || 1)) * 100)}%"></div>
                                    </div>
                                    <span class="top-count">${count}</span>
                                </div>`).join('')
                            : emptyRowHtml()}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">${tr('analytics.peakActivityHours', {}, 'Peak Activity Hours')}</div>
                    <div class="top-list">
                        ${peakHours.length
                            ? peakHours.map(([h, c]) => `
                                <div class="top-row">
                                    <span class="top-name">${formatHour(parseInt(h))}</span>
                                    <div class="top-bar-wrap">
                                        <div class="top-bar" style="width:${Math.round((c / (peakHours[0][1] || 1)) * 100)}%; background:var(--secondary-gradient)"></div>
                                    </div>
                                    <span class="top-count">${c}</span>
                                </div>`).join('')
                            : emptyRowHtml()}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">${tr('analytics.commonTransitions', {}, 'Common Transitions')}</div>
                    <div class="top-list">
                        ${transitions.length
                            ? transitions.map(t => `
                                <div class="top-row">
                                    <span class="top-name">${t.from} → ${t.to}</span>
                                    <span class="top-count">${t.count}×</span>
                                </div>`).join('')
                            : emptyRowHtml()}
                    </div>
                </div>
            </div>
        </section>

        <!-- ── STABILITY METRICS ────────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">${tr('analytics.stabilityMetrics', {}, '📈 Stability Metrics')}</h2>
            <div class="card-grid">
                <div class="a-card">
                    <div class="a-card-title">${tr('analytics.environmentStability', {}, 'Environment Stability')}</div>
                    <div class="stability-list">
                        ${stability.length
                            ? stability.map(([env, score]) => `
                                <div class="stab-row">
                                    <span class="stab-name" title="${env}">${env}</span>
                                    <div class="stab-bar-wrap">
                                        <div class="stab-fill" style="width:${score}%; background:${score >= 75 ? 'var(--success-gradient)' : score >= 40 ? 'var(--warning-gradient)' : 'var(--danger-gradient)'}"></div>
                                    </div>
                                    <span class="stab-pct">${Math.round(score)}%</span>
                                </div>`).join('')
                            : emptyRowHtml()}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">${tr('analytics.changeFrequencyPerDay', {}, 'Change Frequency / Day')}</div>
                    <div class="top-list">
                        ${churn.length
                            ? churn.map(([env, rate]) => `
                                <div class="top-row">
                                    <span class="top-name" title="${env}">${env}</span>
                                    <span class="top-count">${tr('analytics.ratePerDay', { rate: rate.toFixed(2) }, `${rate.toFixed(2)}/day`)}</span>
                                </div>`).join('')
                            : emptyRowHtml()}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">${tr('analytics.avgTimeBetweenChanges', {}, 'Avg Time Between Changes')}</div>
                    <div class="top-list">
                        ${avgTime.length
                            ? avgTime.map(([env, h]) => `
                                <div class="top-row">
                                    <span class="top-name" title="${env}">${env}</span>
                                    <span class="top-count">${tr('analytics.hoursShort', { hours: h.toFixed(1) }, `${h.toFixed(1)}h`)}</span>
                                </div>`).join('')
                            : emptyRowHtml()}
                    </div>
                </div>
            </div>
        </section>

        <!-- ── VARIABLE ANALYTICS ───────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">${tr('analytics.variableChangeFreq', {}, '🔄 Variable Change Frequency')}</h2>
            <div class="a-card full-width">
                <div class="a-card-title">${tr('analytics.mostChangedVariablesTop15', {}, 'Most Frequently Changed Variables (Top 15)')}</div>
                <div class="var-table">
                    <div class="var-header">
                        <span>${tr('analytics.colVariable', {}, 'Variable')}</span>
                        <span>${tr('analytics.colCurrentValue', {}, 'Current Value')}</span>
                        <span>${tr('analytics.colChanges', {}, 'Changes')}</span>
                        <span>${tr('analytics.colVelocity', {}, 'Velocity')}</span>
                    </div>
                    ${varFreq.length
                        ? varFreq.map(([variable, changes], idx) => {
                            const vel = analytics.variableAnalytics?.changeVelocity?.[variable];
                            const velText = vel
                                ? tr('analytics.ratePerDay', { rate: vel.toFixed(2) }, `${vel.toFixed(2)}/day`)
                                : '—';
                            return `
                            <div class="var-row ${idx % 2 === 0 ? 'var-row-even' : ''}">
                                <span class="var-name">${variable}</span>
                                <span class="var-val">${analytics.variableAnalytics?.currentValue?.[variable] || '—'}</span>
                                <span class="var-changes">${changes}</span>
                                <span class="var-vel">${velText}</span>
                            </div>`;
                        }).join('')
                        : noVarData}
                </div>
            </div>
        </section>

        <!-- ── ACTIVITY HEATMAP ──────────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">${tr('analytics.activityHeatmapTitle', {}, '📅 Activity Heatmap — Last 30 Days')}</h2>
            <div class="a-card full-width">
                <div class="heatmap-wrap">
                    <div class="heatmap-grid">${generateHeatmapGrid(analytics.activityHeatmap?.calendar)}</div>
                    <div class="heatmap-legend">
                        <span>${tr('analytics.heatmapLess', {}, 'Less')}</span>
                        <div class="legend-dots">
                            <div class="legend-dot" style="background:#ebedf0"></div>
                            <div class="legend-dot" style="background:#9be9a8"></div>
                            <div class="legend-dot" style="background:#40c463"></div>
                            <div class="legend-dot" style="background:#30a14e"></div>
                            <div class="legend-dot" style="background:#216e39"></div>
                        </div>
                        <span>${tr('analytics.heatmapMore', {}, 'More')}</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- ── FOOTER ────────────────────────────────────────── -->
        <footer class="a-footer">
            <span>${tr('analytics.footerData', { start, end }, `📆 Data: ${start} — ${end}`)}</span>
            <span>${tr('analytics.footerEntries', { count: totalEntries }, `📊 ${totalEntries} entries`)}</span>
            <span>${tr('analytics.footerGenerated', { time: genAt }, `🕒 Generated: ${genAt}`)}</span>
        </footer>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Load / refresh
    // ──────────────────────────────────────────────────────────────
    function showError(detail) {
        lastErrorDetail = detail || '';
        currentAnalytics = null;
        const root = document.getElementById('analytics-root');
        if (!root) { return; }
        root.replaceChildren();
        const el = document.createElement('div');
        el.className = 'error-state';
        const text = tr(
            'analytics.loadFailed',
            { message: lastErrorDetail },
            `Failed to load analytics: ${lastErrorDetail}`
        );
        el.textContent = `⚠️ ${text}`;
        root.appendChild(el);
    }

    function showLoading() {
        lastErrorDetail = null;
        const container = document.getElementById('analytics-root');
        if (container) {
            container.innerHTML = `
                <div class="loading-state">
                    <div class="spinner"></div>
                    <p>${tr('analytics.loading', {}, 'Loading analytics…')}</p>
                </div>`;
        }
    }

    function loadData() {
        showLoading();
        if (currentWorkspace) {
            vscode.postMessage({ type: 'loadAnalytics', workspacePath: currentWorkspace });
        } else {
            vscode.postMessage({ type: 'refresh' });
        }
    }

    window.loadData = loadData;

    // ──────────────────────────────────────────────────────────────
    // Messages from extension
    // ──────────────────────────────────────────────────────────────
    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.type) {
            case 'analyticsLoaded':
                if (msg.workspacePath) { currentWorkspace = msg.workspacePath; }
                lastErrorDetail = null;
                currentAnalytics = msg.analytics;
                displayAnalytics(currentAnalytics);
                break;
            case 'localeChanged':
                if (window.dotenvyI18n && window.dotenvyI18n.applyTranslations) {
                    window.dotenvyI18n.applyTranslations();
                }
                if (lastErrorDetail !== null) {
                    showError(lastErrorDetail);
                } else if (currentAnalytics !== null) {
                    displayAnalytics(currentAnalytics);
                } else {
                    const root = document.getElementById('analytics-root');
                    const loading = root && root.querySelector('.loading-state p');
                    if (loading) {
                        loading.textContent = tr('analytics.loading', {}, 'Loading analytics…');
                    }
                }
                break;
            case 'error':
                showError(msg.errorMessage || msg.message || '');
                break;
        }
    });

    // ──────────────────────────────────────────────────────────────
    // Refresh button
    // ──────────────────────────────────────────────────────────────
    function bootstrap() {
        const btn = document.getElementById('refresh-btn');
        if (btn) { btn.addEventListener('click', loadData); }
        vscode.postMessage({ type: 'webviewReady' });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }

    // Delegated handler for dynamically injected buttons (e.g. "Try Again")
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) { return; }
        if (btn.getAttribute('data-action') === 'retry') { loadData(); }
    });
})();
