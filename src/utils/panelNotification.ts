import * as vscode from 'vscode';

export type PanelNotificationType = 'success' | 'error' | 'info' | 'warning';

const notifiers = new Set<(message: unknown) => void>();

export function registerPanelNotifier(postMessage: (message: unknown) => void): vscode.Disposable {
	notifiers.add(postMessage);
	return {
		dispose: () => {
			notifiers.delete(postMessage);
		}
	};
}

export function showPanelToast(message: string, notificationType: PanelNotificationType = 'info'): void {
	const payload = { type: 'showNotification', message, notificationType };
	for (const notify of notifiers) {
		notify(payload);
	}
}

/** VS Code notification + in-panel toast (when the dashboard is open). */
export function showSyncToast(message: string, notificationType: PanelNotificationType): void {
	switch (notificationType) {
		case 'error':
			void vscode.window.showErrorMessage(message);
			break;
		case 'warning':
			void vscode.window.showWarningMessage(message);
			break;
		default:
			void vscode.window.showInformationMessage(message);
	}

	showPanelToast(message, notificationType);
}

/** In-panel toast only — for immediate feedback when a long action starts. */
export function showActionStart(message: string): void {
	showPanelToast(message, 'info');
}
