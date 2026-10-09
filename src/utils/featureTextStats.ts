/**
 * Text statistics used by the 35-feature secret vector.
 * Formulas mirror python-llm/feature_extractor.py helpers.
 */

/** Count chars matching a predicate — replaces Python generator expressions */
export function countMatching(text: string, pred: (c: string) => boolean): number {
    let n = 0;
    for (const c of text) { if (pred(c)) { n++; } }
    return n;
}

/**
 * Shannon entropy H = -Σ p(x) * log2(p(x))
 * Mirrors _shannon_entropy() in Python exactly.
 */
export function shannonEntropy(text: string): number {
    if (!text) { return 0.0; }
    const freq: Record<string, number> = {};
    for (const c of text) { freq[c] = (freq[c] ?? 0) + 1; }
    const n = text.length;
    let h = 0;
    for (const v of Object.values(freq)) {
        const p = v / n;
        h -= p * Math.log2(p);
    }
    return h;
}

/**
 * N-gram entropy.
 * Mirrors _ngram_entropy() / _bigram_entropy() / _trigram_entropy().
 */
export function ngramEntropy(text: string, n: number): number {
    if (text.length < n) { return 0.0; }
    const freq: Record<string, number> = {};
    for (let i = 0; i <= text.length - n; i++) {
        const gram = text.slice(i, i + n);
        freq[gram] = (freq[gram] ?? 0) + 1;
    }
    const total = text.length - n + 1;
    let h = 0;
    for (const v of Object.values(freq)) {
        const p = v / total;
        h -= p * Math.log2(p);
    }
    return h;
}

/**
 * Length of the longest run of repeated characters.
 * Mirrors _max_run_length().
 */
export function maxRunLength(text: string): number {
    if (!text) { return 0; }
    let maxRun = 1;
    let curRun = 1;
    for (let i = 1; i < text.length; i++) {
        if (text[i] === text[i - 1]) {
            curRun++;
            if (curRun > maxRun) { maxRun = curRun; }
        } else {
            curRun = 1;
        }
    }
    return maxRun;
}

/**
 * Local entropy variance.
 * Mirrors _local_entropy_variance(text, window=8).
 *
 * Low std-dev with high mean → consistently random → likely secret.
 * Formula: (consistency + level) / 2
 *   consistency = 1.0 - min(1.0, std / 2.0)
 *   level       = min(1.0, mean / 4.0)
 */
export function localEntropyVariance(text: string, window = 8): number {
    if (text.length < window) { return 0.0; }

    const entropies: number[] = [];
    for (let i = 0; i <= text.length - window; i++) {
        entropies.push(shannonEntropy(text.slice(i, i + window)));
    }
    if (entropies.length === 0) { return 0.0; }

    const mean = entropies.reduce((a, b) => a + b, 0) / entropies.length;
    const variance = entropies.reduce((a, b) => a + (b - mean) ** 2, 0) / entropies.length;
    const std  = Math.sqrt(variance);

    const consistency = 1.0 - Math.min(1.0, std / 2.0);
    const level       = Math.min(1.0, mean / 4.0);
    return (consistency + level) / 2.0;
}

/**
 * Base64-like check.
 * Mirrors _is_base64_like():
 *   len % 4 == 0  AND  len >= 16  AND  all chars in b64_chars
 */
export function isBase64Like(text: string): boolean {
    if (text.length < 16 || text.length % 4 !== 0) { return false; }
    return /^[A-Za-z0-9+/=]+$/.test(text);
}

/**
 * Hex string check.
 * Mirrors _is_hex_string():
 *   len >= 32  AND  all hexdigits  AND  len % 2 == 0
 */
export function isHexString(text: string): boolean {
    return (
        text.length >= 32 &&
        text.length % 2 === 0 &&
        /^[0-9a-fA-F]+$/.test(text)
    );
}

/**
 * Alternating alpha-digit score.
 * Mirrors _alternating_alpha_digit_score():
 *   switches / (len * 0.35)  capped at 1.0
 */
export function alternatingAlphaDigitScore(text: string): number {
    if (text.length < 8) { return 0.0; }
    let switches = 0;
    for (let i = 0; i < text.length - 1; i++) {
        const a = text[i];
        const b = text[i + 1];
        const aAlpha = /[a-zA-Z]/.test(a);
        const bAlpha = /[a-zA-Z]/.test(b);
        const aDigit = /[0-9]/.test(a);
        const bDigit = /[0-9]/.test(b);
        if ((aAlpha && bDigit) || (aDigit && bAlpha)) { switches++; }
    }
    return Math.min(1.0, switches / (text.length * 0.35));
}

/**
 * Separator structure score.
 * Mirrors _separator_structure_score():
 *   rewards consistent segment lengths in patterns like xxxx-yyyy-zzzz
 */
export function separatorStructureScore(text: string): number {
    const SEPS = ['-', '_', '.'];
    const sepCount = SEPS.reduce((sum, s) => sum + (text.split(s).length - 1), 0);
    if (sepCount === 0) { return 0.0; }

    for (const sep of SEPS) {
        if (text.includes(sep)) {
            const parts   = text.split(sep).filter(p => p.length > 0);
            const lengths = parts.map(p => p.length);
            const maxLen  = Math.max(...lengths);
            const minLen  = Math.min(...lengths);
            if (maxLen > 0) {
                const consistency = 1.0 - (maxLen - minLen) / maxLen;
                return Math.min(1.0, consistency * 0.8 + 0.2);
            }
        }
    }
    return Math.min(1.0, sepCount * 0.2);
}

/**
 * Character class balance.
 * Mirrors _character_class_balance():
 *   score = sum([has_alpha, has_digit, has_upper AND has_lower]) / 3.0
 */
export function characterClassBalance(text: string): number {
    if (!text) { return 0.0; }
    const hasAlpha = /[a-zA-Z]/.test(text);
    const hasDigit = /[0-9]/.test(text);
    const hasUpper = /[A-Z]/.test(text);
    const hasLower = /[a-z]/.test(text);
    const score = [hasAlpha, hasDigit, hasUpper && hasLower]
        .filter(Boolean).length / 3.0;
    return score;
}
