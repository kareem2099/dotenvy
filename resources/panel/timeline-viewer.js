// Timeline Viewer Standalone Script
(function() {
    const vscode = acquireVsCodeApi();
    let currentWorkspace = null;
    let timelineData = [];
    let timelineZoom = 1;
    let timelinePan = 0;

    // DOM elements
    const statsDiv = document.getElementById('stats');
    const timelineContainer = document.getElementById('timeline-container');
    const timelineSvg = document.getElementById('timeline-svg');
    const timelineContent = document.getElementById('timeline-content');
    const timelineMinimap = document.getElementById('timeline-minimap');
    const minimapSvg = document.getElementById('minimap-svg');
    const refreshBtn = document.getElementById('refresh-btn');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const fitToScreenBtn = document.getElementById('fit-to-screen-btn');
    const zoomLevel = document.getElementById('zoom-level');

    function init() {
        // Event listeners
        if (refreshBtn) refreshBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomTimeline(1.2));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomTimeline(0.8));
        if (fitToScreenBtn) fitToScreenBtn.addEventListener('click', fitTimelineToScreen);

        // Window resize
        window.addEventListener('resize', () => {
            if (timelineData.length > 0) renderTimeline();
        });

        // Mouse wheel zoom
        timelineSvg.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                zoomTimeline(e.deltaY > 0 ? 0.9 : 1.1);
            } else {
                // Horizontal pan
                timelinePan -= e.deltaX;
                timelineContent.setAttribute('transform', `scale(${timelineZoom}) translate(${timelinePan}, 0)`);
            }
        });

        // Draggable pan
        let isDragging = false;
        let startX;

        timelineSvg.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - timelinePan;
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            timelinePan = e.clientX - startX;
            timelineContent.setAttribute('transform', `scale(${timelineZoom}) translate(${timelinePan}, 0)`);
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // Message handling
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'historyLoaded':
                currentWorkspace = message.workspacePath;
                timelineData = [...message.history].reverse(); // Oldest first for timeline
                updateStats(message.stats);
                renderTimeline();
                break;
        }
    });

    function updateStats(stats) {
        if (!stats || !statsDiv) return;
        statsDiv.innerHTML = `
            <div class="stat-item">
                <span class="stat-label">Entries:</span>
                <span class="stat-value">${stats.totalEntries}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Span:</span>
                <span class="stat-value">${calculateDateSpan(stats.oldestEntry, stats.newestEntry)}</span>
            </div>
        `;
    }

    function calculateDateSpan(start, end) {
        if (!start || !end) return 'N/A';
        const s = new Date(start);
        const e = new Date(end);
        const diffDays = Math.ceil(Math.abs(e - s) / (1000 * 60 * 60 * 24));
        return `${diffDays} days`;
    }

    function renderTimeline() {
        if (!timelineContent) return;
        timelineContent.innerHTML = '';

        if (timelineData.length === 0) {
            timelineContainer.innerHTML = '<div class="empty-state">No history recorded yet</div>';
            return;
        }

        const width = timelineSvg.clientWidth || 800;
        const height = timelineSvg.clientHeight || 600;
        const padding = 60;
        const nodeSpacing = 150;
        const centerY = height / 2;

        // Draw main lifeline
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('y1', centerY);
        line.setAttribute('x2', Math.max(width, timelineData.length * nodeSpacing + padding * 2));
        line.setAttribute('y2', centerY);
        line.setAttribute('stroke', 'var(--glass-border)');
        line.setAttribute('stroke-width', '4');
        line.setAttribute('stroke-dasharray', '8,4');
        timelineContent.appendChild(line);

        // Render nodes
        timelineData.forEach((entry, index) => {
            const x = padding + (index * nodeSpacing);
            const isTop = index % 2 === 0;
            const yOffset = isTop ? -80 : 80;

            const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodeGroup.setAttribute('class', 'timeline-node');
            nodeGroup.setAttribute('style', 'cursor: pointer');

            // Connecting vertical line
            const verticalLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            verticalLine.setAttribute('x1', x);
            verticalLine.setAttribute('y1', centerY);
            verticalLine.setAttribute('x2', x);
            verticalLine.setAttribute('y2', centerY + yOffset);
            verticalLine.setAttribute('stroke', 'var(--glass-border)');
            verticalLine.setAttribute('stroke-width', '2');
            nodeGroup.appendChild(verticalLine);

            // Node container for scaling
            const nodeContainer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodeContainer.setAttribute('class', 'node-container');
            nodeGroup.appendChild(nodeContainer);

            // Main circle
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', x);
            circle.setAttribute('cy', centerY + yOffset);
            circle.setAttribute('r', '18');
            circle.setAttribute('fill', getActionColor(entry.action));
            circle.setAttribute('stroke', 'var(--vscode-editor-background)');
            circle.setAttribute('stroke-width', '3');
            nodeContainer.appendChild(circle);

            // Action icon
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            icon.setAttribute('x', x);
            icon.setAttribute('y', centerY + yOffset + 5);
            icon.setAttribute('text-anchor', 'middle');
            icon.setAttribute('font-size', '16');
            icon.textContent = getActionIcon(entry.action);
            nodeContainer.appendChild(icon);

            // Label
            const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            labelText.setAttribute('x', x);
            labelText.setAttribute('y', centerY + yOffset + (isTop ? -30 : 45));
            labelText.setAttribute('text-anchor', 'middle');
            labelText.setAttribute('class', 'node-title');
            labelText.textContent = entry.environmentName;
            labelGroup.appendChild(labelText);

            const timestampText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            timestampText.setAttribute('x', x);
            timestampText.setAttribute('y', centerY + yOffset + (isTop ? -45 : 60));
            timestampText.setAttribute('text-anchor', 'middle');
            timestampText.setAttribute('class', 'node-date');
            timestampText.textContent = formatTimelineDate(entry.timestamp);
            labelGroup.appendChild(timestampText);
            nodeGroup.appendChild(labelGroup);

            // Interaction logic (simplified for standalone)
            nodeGroup.addEventListener('mouseenter', () => {
                nodeContainer.setAttribute('transform', 'scale(1.2)');
            });
            nodeGroup.addEventListener('mouseleave', () => {
                nodeContainer.setAttribute('transform', 'scale(1)');
            });

            // Click handler
            nodeGroup.addEventListener('click', () => viewEntry(entry.id));

            timelineContent.appendChild(nodeGroup);
        });

        updateZoomLevel();
        if (timelineData.length > 5) {
            renderMinimap();
            if (timelineMinimap) timelineMinimap.style.display = 'block';
        } else {
            if (timelineMinimap) timelineMinimap.style.display = 'none';
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
            case 'switch': return '#3b82f6';
            case 'rollback': return '#ef4444';
            case 'manual_edit': return '#f59e0b';
            case 'import': return '#10b981';
            case 'initial': return '#8b5cf6';
            default: return '#64748b';
        }
    }

    function viewEntry(entryId) {
        // Send message to extension that we want to view this entry
        // The extension can then decide to reveal the history panel with this entry
        vscode.postMessage({
            type: 'viewEntry',
            entryId: entryId,
            workspacePath: currentWorkspace
        });
    }

    function formatTimelineDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function zoomTimeline(factor) {
        timelineZoom *= factor;
        timelineZoom = Math.max(0.1, Math.min(5, timelineZoom));
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
        if (zoomLevel) zoomLevel.textContent = `${Math.round(timelineZoom * 100)}%`;
    }

    function renderMinimap() {
        if (!minimapSvg) return;
        minimapSvg.innerHTML = '';
        const minimapWidth = minimapSvg.clientWidth || 200;
        const minimapHeight = 80;
        const padding = 10;

        const startTime = new Date(timelineData[0].timestamp);
        const endTime = new Date(timelineData[timelineData.length - 1].timestamp);
        const timeRange = Math.max(1, endTime - startTime);

        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.setAttribute('width', '100%');
        background.setAttribute('height', '100%');
        background.setAttribute('fill', 'rgba(255, 255, 255, 0.05)');
        background.setAttribute('rx', '8');
        minimapSvg.appendChild(background);

        timelineData.forEach((entry) => {
            const x = padding + ((minimapWidth - 2 * padding) * (new Date(entry.timestamp) - startTime) / timeRange);
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', x);
            dot.setAttribute('cy', minimapHeight / 2);
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', getActionColor(entry.action));
            minimapSvg.appendChild(dot);
        });
    }

    init();
})();
