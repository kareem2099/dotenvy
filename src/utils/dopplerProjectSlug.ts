/**
 * Normalize a workspace or user-provided name into a Doppler project slug.
 * Doppler slugs use hyphens; dots and spaces from package or folder names become "-".
 */
export function normalizeDopplerProjectSlug(name: string): string {
	const unscoped = name.startsWith('@') ? (name.split('/').pop() ?? name) : name;
	return unscoped
		.trim()
		.toLowerCase()
		.replace(/[._\s]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
}
