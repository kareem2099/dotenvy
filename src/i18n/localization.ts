import * as vscode from 'vscode';
import { en } from './en';
import { it } from './it';
import { ar } from './ar';
import { ru } from './ru';
import type { Locale, TranslationParams } from './types';

export type TranslationKey = keyof typeof en;

const LOCALES: Record<Locale, Record<string, string>> = { en, it, ar, ru };
const LOCALE_STORAGE_KEY = 'dotenvy.locale';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'it', 'ar', 'ru'];

const LOCALE_LABEL_KEYS: Record<Locale, TranslationKey> = {
	en: 'panel.language.en',
	it: 'panel.language.it',
	ar: 'panel.language.ar',
	ru: 'panel.language.ru',
};

export function isSupportedLocale(locale: string): locale is Locale {
	return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export function resolveDefaultLocale(): Locale {
	const lang = (vscode.env.language ?? 'en').toLowerCase();
	if (lang.startsWith('ar')) {
		return 'ar';
	}
	if (lang.startsWith('ru')) {
		return 'ru';
	}
	if (lang.startsWith('it')) {
		return 'it';
	}
	return 'en';
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

	getAvailableLocales(): Array<{ code: Locale; label: string }> {
		return SUPPORTED_LOCALES.map(code => ({
			code,
			label: this.t(LOCALE_LABEL_KEYS[code]),
		}));
	}

	async setLocale(locale: string): Promise<void> {
		if (!isSupportedLocale(locale)) {
			return;
		}
		this.locale = locale;
		await this.context?.globalState.update(LOCALE_STORAGE_KEY, locale);
		this.onDidChangeLocaleEmitter.fire(this.locale);
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
		for (const [key, value] of Object.entries(LOCALES.en)) {
			if (key.startsWith(prefix)) {
				result[key] = LOCALES[this.locale][key] ?? value;
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
