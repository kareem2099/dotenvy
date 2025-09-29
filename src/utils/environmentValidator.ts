import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentValidationRules } from '../types/environment';

export interface ValidationError {
	type: 'syntax' | 'missing' | 'type' | 'custom';
	variable?: string;
	message: string;
	line?: number;
}

export class EnvironmentValidator {
	/**
	 * Validate an environment file against validation rules
	 */
	static validateFile(filePath: string, rules: EnvironmentValidationRules): ValidationError[] {
		const errors: ValidationError[] = [];

		try {
			const content = fs.readFileSync(filePath, 'utf8');
			const variables = this.parseEnvironmentFile(content);

			// Check syntax errors
			const syntaxErrors = this.validateSyntax(content);
			errors.push(...syntaxErrors);

			// Check required variables
			if (rules.requiredVariables) {
				const missingErrors = this.validateRequiredVariables(variables, rules.requiredVariables);
				errors.push(...missingErrors);
			}

			// Check variable types
			if (rules.variableTypes) {
				const typeErrors = this.validateVariableTypes(variables, rules.variableTypes);
				errors.push(...typeErrors);
			}

			// Check custom validators
			if (rules.customValidators) {
				const customErrors = this.validateCustomRules(variables, rules.customValidators);
				errors.push(...customErrors);
			}

		} catch (error) {
			errors.push({
				type: 'syntax',
				message: `Failed to read environment file: ${(error as Error).message}`
			});
		}

		return errors;
	}

	/**
	 * Parse environment file content into key-value pairs
	 */
	private static parseEnvironmentFile(content: string): Map<string, {value: string, line: number}> {
		const variables = new Map<string, {value: string, line: number}>();
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			// Skip empty lines and comments
			if (!line || line.startsWith('#')) {
				continue;
			}

			// Parse key=value
			const equalIndex = line.indexOf('=');
			if (equalIndex === -1) {
				continue; // Invalid line format
			}

			const key = line.substring(0, equalIndex).trim();
			const value = line.substring(equalIndex + 1);

			if (key) {
				variables.set(key, { value, line: i + 1 });
			}
		}

		return variables;
	}

	/**
	 * Validate basic syntax of environment file
	 */
	private static validateSyntax(content: string): ValidationError[] {
		const errors: ValidationError[] = [];
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();

			// Skip empty lines and comments
			if (!line || line.startsWith('#')) {
				continue;
			}

			// Check for basic key=value format
			const equalIndex = line.indexOf('=');
			if (equalIndex === -1) {
				errors.push({
					type: 'syntax',
					message: `Invalid line format: expected KEY=VALUE`,
					line: i + 1
				});
				continue;
			}

			const key = line.substring(0, equalIndex).trim();
			if (!key) {
				errors.push({
					type: 'syntax',
					message: `Missing variable name before '='`,
					line: i + 1
				});
			}

			// Check for unquoted quotes (basic validation)
			const value = line.substring(equalIndex + 1);
			const quoteCount = (value.match(/"/g) || []).length;
			if (quoteCount % 2 !== 0) {
				errors.push({
					type: 'syntax',
					message: `Unmatched quotes in value`,
					line: i + 1
				});
			}
		}

		return errors;
	}

	/**
	 * Validate required variables are present
	 */
	private static validateRequiredVariables(
		variables: Map<string, {value: string, line: number}>,
		requiredVars: string[]
	): ValidationError[] {
		const errors: ValidationError[] = [];

		for (const requiredVar of requiredVars) {
			if (!variables.has(requiredVar)) {
				errors.push({
					type: 'missing',
					variable: requiredVar,
					message: `Required variable '${requiredVar}' is missing`
				});
			}
		}

		return errors;
	}

	/**
	 * Validate variable types
	 */
	private static validateVariableTypes(
		variables: Map<string, {value: string, line: number}>,
		typeRules: {[varName: string]: 'string' | 'number' | 'boolean' | 'url'}
	): ValidationError[] {
		const errors: ValidationError[] = [];

		for (const [varName, expectedType] of Object.entries(typeRules)) {
			const variable = variables.get(varName);
			if (!variable) continue; // Skip if variable doesn't exist (caught by required check)

			const value = variable.value.trim();
			const isValid = this.validateType(value, expectedType);

			if (!isValid) {
				errors.push({
					type: 'type',
					variable: varName,
					message: `Variable '${varName}' should be of type '${expectedType}' but got '${value}'`,
					line: variable.line
				});
			}
		}

		return errors;
	}

	/**
	 * Validate custom regex patterns
	 */
	private static validateCustomRules(
		variables: Map<string, {value: string, line: number}>,
		customRules: {[varName: string]: string}
	): ValidationError[] {
		const errors: ValidationError[] = [];

		for (const [varName, pattern] of Object.entries(customRules)) {
			const variable = variables.get(varName);
			if (!variable) continue; // Skip if variable doesn't exist

			const value = variable.value.trim();
			const regex = new RegExp(pattern);

			if (!regex.test(value)) {
				errors.push({
					type: 'custom',
					variable: varName,
					message: `Variable '${varName}' does not match required pattern`,
					line: variable.line
				});
			}
		}

		return errors;
	}

	/**
	 * Validate a value against expected type
	 */
	private static validateType(value: string, type: 'string' | 'number' | 'boolean' | 'url'): boolean {
		const trimmed = value.trim();

		switch (type) {
			case 'string':
				return trimmed.length > 0;

			case 'number':
				return !isNaN(Number(trimmed)) && trimmed !== '';

			case 'boolean':
				const lower = trimmed.toLowerCase();
				return ['true', 'false', '1', '0', 'yes', 'no'].includes(lower);

			case 'url':
				try {
					new URL(trimmed);
					return true;
				} catch {
					// Check if it's a relative URL or just domain
					const urlPattern = /^https?:\/\/.+/i;
					return urlPattern.test(trimmed);
				}

			default:
				return false;
		}
	}

	/**
	 * Format validation errors for display
	 */
	static formatErrors(errors: ValidationError[]): string {
		if (errors.length === 0) {
			return 'No validation errors found.';
		}

		const groupedErrors = {
			syntax: errors.filter(e => e.type === 'syntax'),
			missing: errors.filter(e => e.type === 'missing'),
			type: errors.filter(e => e.type === 'type'),
			custom: errors.filter(e => e.type === 'custom')
		};

		let result = `Found ${errors.length} validation error(s):\n\n`;

		if (groupedErrors.syntax.length > 0) {
			result += '🔧 Syntax Errors:\n';
			groupedErrors.syntax.forEach(error => {
				result += `  ${error.line ? `Line ${error.line}: ` : ''}${error.message}\n`;
			});
			result += '\n';
		}

		if (groupedErrors.missing.length > 0) {
			result += '❌ Missing Required Variables:\n';
			groupedErrors.missing.forEach(error => {
				result += `  ${error.message}\n`;
			});
			result += '\n';
		}

		if (groupedErrors.type.length > 0) {
			result += '⚠️ Type Validation Errors:\n';
			groupedErrors.type.forEach(error => {
				result += `  ${error.message}\n`;
			});
			result += '\n';
		}

		if (groupedErrors.custom.length > 0) {
			result += '🔍 Custom Validation Errors:\n';
			groupedErrors.custom.forEach(error => {
				result += `  ${error.message}\n`;
			});
			result += '\n';
		}

		return result.trim();
	}
}
