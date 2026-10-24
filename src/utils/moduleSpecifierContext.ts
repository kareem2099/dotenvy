/** Module references can resemble Base64 or hashes without containing credentials. */
export interface ModuleSpecifierSpan { start: number; end: number }
export type ModuleSpecifierIndex = Map<number, ModuleSpecifierSpan[]>;

const STATISTICAL_TYPES = new Set(['Base64 Encoded Data', 'MD5 Hash', 'SHA-1 Hash', 'SHA-256 Hash']);

/** Index ordinary JS/TS module literals, retaining original line/column offsets. */
export function indexModuleSpecifiers(text: string): ModuleSpecifierIndex {
    const literals = new Map<number, { value: string; end: number }>();
    // Mask comments and literal bodies before recognizing declarations. Words in
    // documentation strings/comments must not suppress real credential findings.
    const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g,
        (match: string, quote: string | undefined, offset: number) => {
            const blank = match.replace(/[^\r\n]/g, ' ');
            if (!quote) return blank;
            literals.set(offset, { value: match.slice(1, -1), end: offset + match.length - 1 });
            return quote + blank.slice(1, -1) + quote;
        });
    const lineStarts = [0];
    for (let index = 0; index < text.length; index++) {
        if (text[index] === '\n') lineStarts.push(index + 1);
    }
    const result: ModuleSpecifierIndex = new Map();
    const patterns = [
        /\b(?:import|export)\s+(?:[\w$*{},\s]+?\s+from\s*)?(['"])[^'"]*\1/g,
        /\b(?:import|require(?:\s*\.\s*resolve)?)\s*\(\s*(['"])[^'"]*\1/g,
    ];
    for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
            const opening = (match.index ?? 0) + match[0].indexOf(match[1]);
            const literal = literals.get(opening);
            // URLs, query parameters and embedded credentials remain scan candidates.
            if (!literal || !/^(?:\.{1,2}\/|\/|@|#|[A-Za-z_$])[\w$@./-]*$/.test(literal.value)) continue;
            let low = 0, high = lineStarts.length - 1;
            while (low < high) {
                const mid = Math.ceil((low + high) / 2);
                if (lineStarts[mid] <= opening) low = mid;
                else high = mid - 1;
            }
            const spans = result.get(low) ?? [];
            spans.push({ start: opening + 1 - lineStarts[low], end: literal.end - lineStarts[low] });
            result.set(low, spans);
        }
    }
    return result;
}

/** Only weak statistical findings are suppressed; provider-specific keys remain visible. */
export function isModuleSpecifierFinding(type: string, start: number, length: number,
    spans: readonly ModuleSpecifierSpan[]): boolean {
    return STATISTICAL_TYPES.has(type) && spans.some(span => start >= span.start && start + length <= span.end);
}
