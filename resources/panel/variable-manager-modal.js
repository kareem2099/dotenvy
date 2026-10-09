/**
 * Add, edit, and delete dialogs for the variable manager.
 * Call bind with tr, vscode, and escHtml from the list script.
 */
window.dotenvyVariableModal = {
    /**
     * @param {{ tr: Function, vscode: { postMessage: Function }, escHtml: Function, escAttr: Function, getCurrentFile: Function, getAllVariables: Function }} ctx
     */
    bind(ctx) {
    function showAddVariableModal() {
        showVariableModal({
            title: ctx.tr('variableManager.addModalTitle', {}, '＋ Add Variable'),
            keyValue: '',
            valueValue: '',
            keyEditable: true,
            submitLabel: ctx.tr('variableManager.addBtn', {}, '＋ Add Variable'),
            onSubmit: ({ key, value }) => {
                if (!key.trim()) return ctx.tr('variableManager.keyEmpty', {}, 'Key cannot be empty');
                if (ctx.getAllVariables().find(v => v.key === key.trim())) return ctx.tr('variableManager.keyExists', { key }, `Key "${key}" already exists`);
                ctx.vscode.postMessage({ type: 'updateVariable', key: key.trim(), value, fileName: ctx.getCurrentFile() });
            }
        });
    }

    function startEditingModal(variable) {
        showVariableModal({
            title: ctx.tr('variableManager.editModalTitle', { key: variable.key }, `✏️ Edit  ${variable.key}`),
            keyValue: variable.key,
            valueValue: variable.encrypted ? '' : variable.value,
            keyEditable: false,
            submitLabel: ctx.tr('variableManager.saveChanges', {}, 'Save Changes'),
            valuePlaceholder: variable.encrypted
                ? ctx.tr('variableManager.encryptedValuePlaceholder', {}, 'Enter new value for encrypted variable')
                : '',
            onSubmit: ({ value }) => {
                ctx.vscode.postMessage({
                    type: 'updateVariable',
                    key: variable.key,
                    value,
                    fileName: ctx.getCurrentFile(),
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
                    <button type="button" class="vm-modal-close" id="vm-modal-close" aria-label="${ctx.escAttr(ctx.tr('variableManager.closeAria', {}, 'Close'))}">✕</button>
                </div>
                <div class="vm-modal-body">
                    <div class="vm-form-group">
                        <label class="vm-form-label" for="modal-key">${ctx.tr('variableManager.keyLabel', {}, 'KEY')}</label>
                        <input
                            id="modal-key"
                            class="vm-form-input vm-mono"
                            type="text"
                            value="${ctx.escAttr(keyValue)}"
                            placeholder="${ctx.escAttr(ctx.tr('variableManager.keyPlaceholder', {}, 'VARIABLE_NAME'))}"
                            ${keyEditable ? '' : 'readonly'}
                            autocomplete="off"
                            spellcheck="false"
                        >
                    </div>
                    <div class="vm-form-group">
                        <label class="vm-form-label" for="modal-value">${ctx.tr('variableManager.valueLabel', {}, 'VALUE')}</label>
                        <textarea
                            id="modal-value"
                            class="vm-form-input vm-form-textarea vm-mono"
                            placeholder="${ctx.escAttr(valuePlaceholder || ctx.tr('variableManager.valuePlaceholder', {}, 'Enter value…'))}"
                            autocomplete="off"
                            spellcheck="false"
                            rows="3"
                        >${ctx.escHtml(valueValue)}</textarea>
                    </div>
                    <div class="vm-form-error" id="vm-form-error"></div>
                </div>
                <div class="vm-modal-footer">
                    <button class="btn btn-secondary" id="vm-modal-cancel">${ctx.tr('variableManager.cancel', {}, 'Cancel')}</button>
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
                    <h3 class="vm-modal-title">🗑 ${ctx.tr('variableManager.deleteConfirmTitle', {}, 'Delete Variable')}</h3>
                    <button type="button" class="vm-modal-close" id="vm-modal-close" aria-label="${ctx.escAttr(ctx.tr('variableManager.closeAria', {}, 'Close'))}">✕</button>
                </div>
                <div class="vm-modal-body">
                    <p class="vm-delete-msg">${ctx.tr('variableManager.deleteConfirmDesc', { key: ctx.escHtml(key) }, `Delete ${ctx.escHtml(key)}?`)}</p>
                    <p class="vm-delete-hint">${ctx.tr('variableManager.deleteTrashHint', {}, 'This will be saved to the Trash Bin and can be restored.')}</p>
                </div>
                <div class="vm-modal-footer">
                    <button class="btn btn-secondary" id="vm-modal-cancel">${ctx.tr('variableManager.cancel', {}, 'Cancel')}</button>
                    <button class="btn btn-danger" id="vm-modal-confirm">${ctx.tr('variableManager.deleteConfirmBtn', {}, 'Delete')}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#vm-modal-cancel').addEventListener('click', removeModal);
        overlay.querySelector('#vm-modal-close').addEventListener('click', removeModal);
        overlay.querySelector('#vm-modal-confirm').addEventListener('click', () => {
            ctx.vscode.postMessage({ type: 'deleteVariable', key, fileName: ctx.getCurrentFile() });
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
        return { showAddVariableModal, startEditingModal, showDeleteConfirm, removeModal };
    }
};
