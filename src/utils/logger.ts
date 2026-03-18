/**
 * DotEnvy Logger
 * ==============
 * Centralized logger with:
 * - VS Code Output Channel (shows in Output panel)
 * - Log levels: DEBUG / INFO / WARN / ERROR
 * - Emoji-free clean format for production
 * - Timestamps on every line
 * - Easy to disable in production
 */

import * as vscode from 'vscode';

// ─── Log Levels ────────────────────────────────────────────────────────────────

export enum LogLevel {
    DEBUG = 0,
    INFO  = 1,
    WARN  = 2,
    ERROR = 3,
    NONE  = 4,   // silence everything
}

// ─── Logger Class ──────────────────────────────────────────────────────────────

export class Logger {

    private static instance: Logger | null = null;
    private readonly channel: vscode.OutputChannel;
    private level: LogLevel = LogLevel.INFO;

    // ─── Constructor ──────────────────────────────────────────────────────────

    private constructor() {
        // Creates the "DotEnvy" tab in VS Code's Output panel
        this.channel = vscode.window.createOutputChannel('DotEnvy');
    }

    // ─── Singleton ────────────────────────────────────────────────────────────

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    // ─── Configuration ────────────────────────────────────────────────────────

    /**
     * Set minimum log level.
     * - Development: LogLevel.DEBUG
     * - Production:  LogLevel.WARN
     */
    public setLevel(level: LogLevel): void {
        this.level = level;
    }

    /**
     * Show the Output channel in the VS Code UI.
     */
    public show(): void {
        this.channel.show();
    }

    /**
     * Dispose the Output channel (call in deactivate()).
     */
    public dispose(): void {
        this.channel.dispose();
        Logger.instance = null;
    }

    // ─── Log Methods ──────────────────────────────────────────────────────────

    public debug(message: string, context?: string): void {
        this.log(LogLevel.DEBUG, 'DEBUG', message, context);
    }

    public info(message: string, context?: string): void {
        this.log(LogLevel.INFO, 'INFO ', message, context);
    }

    public warn(message: string, context?: string): void {
        this.log(LogLevel.WARN, 'WARN ', message, context);
    }

    public error(message: string, error?: unknown, context?: string): void {
        const errorDetail = this.formatError(error);
        this.log(LogLevel.ERROR, 'ERROR', errorDetail ? `${message} | ${errorDetail}` : message, context);
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    private log(level: LogLevel, label: string, message: string, context?: string): void {
        if (level < this.level) { return; }

        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
        const ctx       = context ? `[${context}]` : '[DotEnvy]';
        const line      = `${timestamp} ${label} ${ctx} ${message}`;

        // Always write to Output channel (visible in VS Code UI)
        this.channel.appendLine(line);

        // Mirror to devtools console only in debug mode
        if (this.level === LogLevel.DEBUG) {
            if      (level === LogLevel.ERROR) { console.error(line); }
            else if (level === LogLevel.WARN)  { console.warn(line);  }
            else                               { console.log(line);   }
        }
    }

    private formatError(error: unknown): string {
        if (!error) { return ''; }
        if (error instanceof Error) {
            return error.stack ? `${error.message}\n${error.stack}` : error.message;
        }
        return String(error);
    }
}

// ─── Convenience export ────────────────────────────────────────────────────────
// Use this anywhere instead of console.log:
//   import { logger } from './utils/logger';
//   logger.info('Environment loaded', 'HistoryManager');
//   logger.error('Failed to load file', err, 'HistoryManager');

export const logger = Logger.getInstance();