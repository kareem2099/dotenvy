import * as vscode from 'vscode';
import { LocalizationService } from './localization';

export function getWebviewLocalePayload(prefix?: string): {
	locale: string;
	strings: Record<string, string>;
	locales: Array<{ code: string; label: string }>;
} {
	const localization = LocalizationService.getInstance();
	const strings = prefix
		? localization.getStringsByPrefix(prefix)
		: { ...localization.getPanelStrings(), ...localization.getStringsByPrefix('history.') };

	return {
		locale: localization.getLocale(),
		strings,
		locales: localization.getAvailableLocales(),
	};
}

export function postLocaleToPanel(panel: vscode.WebviewPanel | undefined, prefix: string): void {
	if (!panel) {
		return;
	}
	const payload = getWebviewLocalePayload(prefix);
	panel.webview.postMessage({ type: 'localeChanged', ...payload });
}
