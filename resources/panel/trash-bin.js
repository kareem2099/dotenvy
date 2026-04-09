// Trash Bin Webview Script
(function () {
    const vscode = acquireVsCodeApi();
    const listEl  = document.getElementById('trash-list');
    const countEl = document.getElementById('trash-count');
    const clearBtn = document.getElementById('clear-all-btn');

    if (clearBtn) clearBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'clearAll' });
    });

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'refresh') renderEntries(msg.entries);
    });

    function renderEntries(entries) {
        if (!listEl) return;

        if (countEl) countEl.textContent = entries.length;

        if (!entries || entries.length === 0) {
            listEl.innerHTML = '<div class="trash-empty">🎉 Nothing in the bin — your variables are safe!</div>';
            return;
        }

        listEl.innerHTML = entries.map(e => {
            const valueHtml = e.type === 'deleted'
                ? `<span class="trash-old-val">${escHtml(maskValue(e.oldValue))}</span> <span style="font-size:0.72rem;opacity:0.5;">(deleted)</span>`
                : `<span class="trash-old-val">${escHtml(maskValue(e.oldValue))}</span>
                   <span class="trash-arrow">→</span>
                   <span class="trash-new-val">${escHtml(maskValue(e.newValue || ''))}</span>`;

            return `
            <div class="trash-item ${e.type}" data-id="${e.id}">
                <div class="trash-type-badge"></div>
                <div class="trash-info">
                    <span class="trash-key">${escHtml(e.key)}</span>
                    <span class="trash-value-row">${valueHtml}</span>
                    <span class="trash-meta">${e.environmentFile} · ${formatAgo(e.timestamp)}</span>
                </div>
                <button class="btn-restore" data-id="${e.id}">↩ Restore</button>
            </div>`;
        }).join('');

        // Delegate Restore clicks
        listEl.addEventListener('click', handleRestoreClick);
    }

    function handleRestoreClick(event) {
        const btn = event.target.closest('.btn-restore');
        if (!btn) return;
        vscode.postMessage({ type: 'restore', id: btn.dataset.id });
    }

    function maskValue(val) {
        if (!val) return '(empty)';
        // Mask secrets — if it looks like a token/password, show only first 4 chars
        if (val.length > 12 && /[A-Z0-9]{8,}/i.test(val)) {
            return val.slice(0, 4) + '••••••••';
        }
        return val.length > 60 ? val.slice(0, 57) + '…' : val;
    }

    function formatAgo(timestamp) {
        const diff = Date.now() - new Date(timestamp).getTime();
        const s = Math.floor(diff / 1000);
        if (s < 60) return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        return `${Math.floor(m / 60)}h ago`;
    }

    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
})();
