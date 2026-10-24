/**
 * Installs a vscode module stub before any compiled extension code is loaded.
 * Logger constructs an output channel on import, so the stub must exist first.
 */

const Module = require('module');
const path = require('path');

function createMemento() {
    const data = new Map();
    return {
        get(key, fallback) {
            return data.has(key) ? data.get(key) : fallback;
        },
        update(key, value) {
            if (value === undefined) {
                data.delete(key);
            } else {
                data.set(key, value);
            }
            return Promise.resolve();
        },
    };
}

function createSecrets() {
    const data = new Map();
    return {
        get(key) {
            return Promise.resolve(data.get(key));
        },
        store(key, value) {
            if (value === undefined) {
                data.delete(key);
            } else {
                data.set(key, value);
            }
            return Promise.resolve();
        },
        delete(key) {
            data.delete(key);
            return Promise.resolve();
        },
        _clear() {
            data.clear();
        },
    };
}

function createHarness() {
    const secrets = createSecrets();
    const workspaceState = createMemento();
    const configValues = {};

    const vscode = {
        ExtensionMode: { Development: 1, Test: 2, Production: 3 },
        ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
        TreeItem: class TreeItem {
            constructor(label, collapsibleState) {
                this.label = label;
                this.collapsibleState = collapsibleState;
            }
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: class ThemeIcon {
            constructor(id) {
                this.id = id;
            }
        },
        EventEmitter: class EventEmitter {
            constructor() {
                this.event = () => {};
            }
            fire() {}
            dispose() {}
        },
        ConfigurationTarget: { Global: 1, Workspace: 2 },
        version: '1.90.0',
        Uri: {
            file: (filePath) => ({ fsPath: filePath, path: filePath }),
            joinPath: (base, ...parts) => {
                const joined = path.join(base.fsPath || base, ...parts);
                return { fsPath: joined, path: joined };
            },
        },
        workspace: {
            workspaceFolders: [],
            name: 'test-workspace',
            getConfiguration: () => ({
                get: (key, fallback) => (
                    Object.prototype.hasOwnProperty.call(configValues, key)
                        ? configValues[key]
                        : fallback
                ),
                update: (key, value) => {
                    configValues[key] = value;
                    return Promise.resolve();
                },
            }),
            openTextDocument: () => Promise.resolve({}),
            findFiles: () => Promise.resolve([]),
            asRelativePath: (filePath) => filePath,
        },
        window: {
            showInformationMessage: () => Promise.resolve(),
            showWarningMessage: () => Promise.resolve(),
            showErrorMessage: () => Promise.resolve(),
            showInputBox: () => Promise.resolve(),
            showQuickPick: () => Promise.resolve(),
            showTextDocument: () => Promise.resolve(),
            showOpenDialog: () => Promise.resolve(),
            createOutputChannel: () => ({
                appendLine: () => {},
                append: () => {},
                show: () => {},
                clear: () => {},
                dispose: () => {},
            }),
            withProgress: async (_options, task) => task({ report: () => {} }),
        },
        commands: {
            registerCommand: () => ({ dispose: () => {} }),
            executeCommand: () => Promise.resolve(),
        },
        env: { machineId: 'dotenvy-test-machine' },
        extensions: { getExtension: () => undefined },
    };

    const context = {
        secrets,
        workspaceState,
        extensionMode: vscode.ExtensionMode.Development,
        subscriptions: [],
        globalState: createMemento(),
    };

    return { vscode, secrets, workspaceState, configValues, context };
}

let installed = false;

function installVscodeMock(harness) {
    if (installed) {
        return harness;
    }
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (packageName) {
        if (packageName === 'vscode') {
            return harness.vscode;
        }
        return originalRequire.apply(this, arguments);
    };
    installed = true;
    return harness;
}

function useWorkspace(harness, rootPath, name = 'test-workspace') {
    harness.vscode.workspace.workspaceFolders = [
        { name, uri: { fsPath: rootPath, path: rootPath } },
    ];
    harness.vscode.workspace.name = name;
}

function bindExtensionContext(harness) {
    const extension = require(path.join(__dirname, '..', '..', 'out', 'extension.js'));
    extension.extensionContext = harness.context;
}

module.exports = {
    createHarness,
    installVscodeMock,
    useWorkspace,
    bindExtensionContext,
};
