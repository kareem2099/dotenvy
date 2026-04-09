// Analytics WebView Script
// Renders environment usage analytics in a full WebviewPanel tab
(function () {
    const vscode = acquireVsCodeApi();
    let currentWorkspace = null;

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    const safeEntries = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
    const safeArr    = (arr) => (Array.isArray(arr) ? arr : []);

    function formatHour(h) {
        const period = h >= 12 ? 'PM' : 'AM';
        const d = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${d} ${period}`;
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
            return '<div class="empty-state">No heatmap data yet</div>';
        }
        const today = new Date();
        let html = '';
        for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const ds = d.toISOString().split('T')[0];
            const count = calendar[ds] || 0;
            const color = getHeatmapColor(Math.min(count / 5, 1));
            html += `<div class="heatmap-cell" style="background:${color}" title="${ds}: ${count} changes"></div>`;
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
                    <h3>No Analytics Data Yet</h3>
                    <p>Make some environment changes and come back to see detailed insights!</p>
                    <button class="btn btn-primary" onclick="loadData()">🔄 Try Again</button>
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

        const totalEntries = analytics.dataRange?.totalEntries ?? 0;
        const start  = analytics.dataRange?.start ? new Date(analytics.dataRange.start).toLocaleDateString() : 'N/A';
        const end    = analytics.dataRange?.end   ? new Date(analytics.dataRange.end).toLocaleDateString()   : 'N/A';
        const genAt  = analytics.generatedAt ? new Date(analytics.generatedAt).toLocaleString() : 'N/A';
        const totalVars = Object.keys(analytics.variableAnalytics?.changeFrequency ?? {}).length;

        container.innerHTML = `
        <!-- ── OVERVIEW STRIP ────────────────────────────────── -->
        <div class="overview-strip">
            <div class="overview-card">
                <div class="ov-value">${totalEntries}</div>
                <div class="ov-label">Total Entries</div>
            </div>
            <div class="overview-card">
                <div class="ov-value">${envFreq.length}</div>
                <div class="ov-label">Environments</div>
            </div>
            <div class="overview-card">
                <div class="ov-value">${totalVars}</div>
                <div class="ov-label">Unique Variables</div>
            </div>
            <div class="overview-card">
                <div class="ov-value">${peakHours.length > 0 ? formatHour(parseInt(peakHours[0][0])) : 'N/A'}</div>
                <div class="ov-label">Peak Hour</div>
            </div>
        </div>

        <!-- ── USAGE PATTERNS ───────────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">📊 Usage Patterns</h2>
            <div class="card-grid">
                <div class="a-card">
                    <div class="a-card-title">Most Used Environments</div>
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
                            : '<div class="empty-row">No data yet</div>'}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">Peak Activity Hours</div>
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
                            : '<div class="empty-row">No data yet</div>'}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">Common Transitions</div>
                    <div class="top-list">
                        ${transitions.length
                            ? transitions.map(t => `
                                <div class="top-row">
                                    <span class="top-name">${t.from} → ${t.to}</span>
                                    <span class="top-count">${t.count}×</span>
                                </div>`).join('')
                            : '<div class="empty-row">No data yet</div>'}
                    </div>
                </div>
            </div>
        </section>

        <!-- ── STABILITY METRICS ────────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">📈 Stability Metrics</h2>
            <div class="card-grid">
                <div class="a-card">
                    <div class="a-card-title">Environment Stability</div>
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
                            : '<div class="empty-row">No data yet</div>'}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">Change Frequency / Day</div>
                    <div class="top-list">
                        ${churn.length
                            ? churn.map(([env, rate]) => `
                                <div class="top-row">
                                    <span class="top-name" title="${env}">${env}</span>
                                    <span class="top-count">${rate.toFixed(2)}/day</span>
                                </div>`).join('')
                            : '<div class="empty-row">No data yet</div>'}
                    </div>
                </div>
                <div class="a-card">
                    <div class="a-card-title">Avg Time Between Changes</div>
                    <div class="top-list">
                        ${avgTime.length
                            ? avgTime.map(([env, h]) => `
                                <div class="top-row">
                                    <span class="top-name" title="${env}">${env}</span>
                                    <span class="top-count">${h.toFixed(1)}h</span>
                                </div>`).join('')
                            : '<div class="empty-row">No data yet</div>'}
                    </div>
                </div>
            </div>
        </section>

        <!-- ── VARIABLE ANALYTICS ───────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">🔄 Variable Change Frequency</h2>
            <div class="a-card full-width">
                <div class="a-card-title">Most Frequently Changed Variables (Top 15)</div>
                <div class="var-table">
                    <div class="var-header">
                        <span>Variable</span>
                        <span>Current Value</span>
                        <span>Changes</span>
                        <span>Velocity</span>
                    </div>
                    ${varFreq.length
                        ? varFreq.map(([variable, changes], idx) => `
                            <div class="var-row ${idx % 2 === 0 ? 'var-row-even' : ''}">
                                <span class="var-name">${variable}</span>
                                <span class="var-val">${analytics.variableAnalytics?.currentValue?.[variable] || '—'}</span>
                                <span class="var-changes">${changes}</span>
                                <span class="var-vel">${analytics.variableAnalytics?.changeVelocity?.[variable] ? analytics.variableAnalytics.changeVelocity[variable].toFixed(2) + '/day' : '—'}</span>
                            </div>`).join('')
                        : '<div class="empty-row" style="grid-column:1/-1">No variable data yet</div>'}
                </div>
            </div>
        </section>

        <!-- ── ACTIVITY HEATMAP ──────────────────────────────── -->
        <section class="a-section">
            <h2 class="section-title">📅 Activity Heatmap — Last 30 Days</h2>
            <div class="a-card full-width">
                <div class="heatmap-wrap">
                    <div class="heatmap-grid">${generateHeatmapGrid(analytics.activityHeatmap?.calendar)}</div>
                    <div class="heatmap-legend">
                        <span>Less</span>
                        <div class="legend-dots">
                            <div class="legend-dot" style="background:#ebedf0"></div>
                            <div class="legend-dot" style="background:#9be9a8"></div>
                            <div class="legend-dot" style="background:#40c463"></div>
                            <div class="legend-dot" style="background:#30a14e"></div>
                            <div class="legend-dot" style="background:#216e39"></div>
                        </div>
                        <span>More</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- ── FOOTER ────────────────────────────────────────── -->
        <footer class="a-footer">
            <span>📆 Data: ${start} — ${end}</span>
            <span>📊 ${totalEntries} entries</span>
            <span>🕒 Generated: ${genAt}</span>
        </footer>`;
    }

    // ──────────────────────────────────────────────────────────────
    // Load / refresh
    // ──────────────────────────────────────────────────────────────
    function showLoading() {
        const container = document.getElementById('analytics-root');
        if (container) {
            container.innerHTML = `
                <div class="loading-state">
                    <div class="spinner"></div>
                    <p>Loading analytics…</p>
                </div>`;
        }
    }

    function loadData() {
        if (!currentWorkspace) { return; }
        showLoading();
        vscode.postMessage({ type: 'loadAnalytics', workspacePath: currentWorkspace });
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
                displayAnalytics(msg.analytics);
                break;
            case 'error':
                const root = document.getElementById('analytics-root');
                if (root) {
                    root.innerHTML = `<div class="error-state">⚠️ ${msg.message}</div>`;
                }
                break;
        }
    });

    // ──────────────────────────────────────────────────────────────
    // Refresh button
    // ──────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('refresh-btn');
        if (btn) { btn.addEventListener('click', loadData); }
    });
})();
