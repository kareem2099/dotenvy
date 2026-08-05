import * as vscode from 'vscode';
import { en } from './en';
import { it } from './it';
import type { Locale, TranslationParams } from './types';

export type TranslationKey = keyof typeof en;

const LOCALES: Record<Locale, Record<string, string>> = { en, it };
const LOCALE_STORAGE_KEY = 'dotenvy.locale';

export function resolveDefaultLocale(): Locale {
	return vscode.env.language.toLowerCase().startsWith('it') ? 'it' : 'en';
}

export class LocalizationService {
	private static instance: LocalizationService;
	private context?: vscode.ExtensionContext;
	private locale: Locale = 'en';
	private readonly onDidChangeLocaleEmitter = new vscode.EventEmitter<Locale>();
	readonly onDidChangeLocale = this.onDidChangeLocaleEmitter.event;

	static getInstance(): LocalizationService {
		if (!LocalizationService.instance) {
			LocalizationService.instance = new LocalizationService();
		}
		return LocalizationService.instance;
	}

	async initialize(context: vscode.ExtensionContext): Promise<void> {
		this.context = context;
		const stored = context.globalState.get<Locale>(LOCALE_STORAGE_KEY);
		this.locale = stored ?? resolveDefaultLocale();
	}

	getLocale(): Locale {
		return this.locale;
	}

	async setLocale(locale: string): Promise<void> {
		if (locale !== 'en' && locale !== 'it') {
			return;
		}
		this.locale = locale;
		await this.context?.globalState.update(LOCALE_STORAGE_KEY, locale);
		this.onDidChangeLocaleEmitter.fire(locale);
	}

	t(key: TranslationKey | string, params?: TranslationParams): string {
		const catalog = LOCALES[this.locale];
		let text = catalog[key] ?? LOCALES.en[key] ?? String(key);
		if (params) {
			for (const [paramKey, value] of Object.entries(params)) {
				text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
			}
		}
		return text;
	}

	getStringsByPrefix(prefix: string): Record<string, string> {
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(LOCALES[this.locale])) {
			if (key.startsWith(prefix)) {
				result[key] = value;
			}
		}
		return result;
	}

	getPanelStrings(): Record<string, string> {
		return this.getStringsByPrefix('panel.');
	}
}

export function t(key: TranslationKey | string, params?: TranslationParams): string {
	return LocalizationService.getInstance().t(key, params);
}

export function getLocalization(): LocalizationService {
	return LocalizationService.getInstance();
}
