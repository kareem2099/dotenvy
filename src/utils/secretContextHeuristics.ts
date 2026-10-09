/**
 * Scoring heuristics for secret context. Keyword lists are passed in so the
 * evaluator keeps ownership of its dictionaries.
 */

export function analyzeKeywordProximity(
    context: string,
    keywords: readonly string[],
    highRiskKeywords: readonly string[],
): { score: number; reasoning: string } {
    const lowerContext = context.toLowerCase();
    let score = 0;
    const found: string[] = [];

    for (const keyword of highRiskKeywords) {
        if (lowerContext.includes(keyword)) {
            score += 6;
            found.push(keyword);
            break;
        }
    }

    if (found.length === 0) {
        for (const keyword of keywords) {
            if (lowerContext.includes(keyword)) {
                score += 3;
                found.push(keyword);
                break;
            }
        }
    }

    const reasoning = found.length > 0
        ? `Security keywords nearby: ${found.join(', ')}`
        : 'No security keywords detected in context';

    return { score, reasoning };
}

export function analyzeAssignmentContext(context: string): { score: number; reasoning: string } {
    let score = 0;
    const patterns: string[] = [];

    if (context.includes('=') || context.includes(': ')) {
        score += 2;
        patterns.push('assignment syntax');
    }

    if (context.includes('process.env.') || context.includes('process.env[')) {
        score += 4;
        patterns.push('environment variable assignment');
    }

    if (context.includes('{') && context.includes('}')) {
        score += 2;
        patterns.push('object property');
    }

    if (context.match(/\b(const|let|var)\s+(?:\w+\s*[:=])?/)) {
        score += 3;
        patterns.push('variable declaration');
    }

    const reasoning = patterns.length > 0
        ? `Assignment context: ${patterns.join(', ')}`
        : 'No clear assignment context detected';

    return { score, reasoning };
}

export function analyzeVariableNaming(
    context: string,
    highRiskKeywords: readonly string[],
): { score: number; reasoning: string } {
    const assignmentMatch = context.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)[\s]*[:=]/);
    if (assignmentMatch) {
        const varName = assignmentMatch[1].toLowerCase();

        if (highRiskKeywords.some(keyword => varName.includes(keyword))) {
            return { score: 5, reasoning: `Variable name "${assignmentMatch[1]}" suggests sensitive data` };
        }

        const secretPatterns = ['api', 'key', 'token', 'secret', 'auth', 'password'];
        if (secretPatterns.some(pattern => varName.includes(pattern))) {
            return { score: 3, reasoning: `Variable name "${assignmentMatch[1]}" matches common secret patterns` };
        }

        if (assignmentMatch[1] === assignmentMatch[1].toUpperCase()) {
            return { score: 2, reasoning: `Uppercase variable name "${assignmentMatch[1]}" (environment variable pattern)` };
        }
    }

    return { score: 0, reasoning: 'Variable naming analysis neutral' };
}

export function analyzeStringContext(context: string, secretValue: string): { score: number; reasoning: string } {
    let score = 0;
    const patterns: string[] = [];

    if ((context.includes('"') || context.includes("'") || context.includes('`'))) {
        score += 2;
        patterns.push('quoted value');
    }

    if (context.includes('export ') || context.includes('set ')) {
        score += 3;
        patterns.push('environment export');
    }

    if (context.includes('"') && context.includes(':')) {
        score += 2;
        patterns.push('JSON property');
    }

    if (context.includes('//') || context.includes('#') || context.includes('/*')) {
        score -= 3;
        patterns.push('appears in comment');
    }

    if (secretValue.includes('test') || secretValue.includes('example') || secretValue.includes('sample')) {
        score -= 2;
        patterns.push('possible test/example value');
    }

    const reasoning = patterns.length > 0
        ? `String context analysis: ${patterns.join(', ')}`
        : 'String context analysis neutral';

    return { score, reasoning };
}

export function analyzeNeighboringAssignments(
    context: string,
    highRiskKeywords: readonly string[],
): { score: number; reasoning: string } {
    let score = 0;
    const assignmentCount = (context.match(/[:=]/g) || []).length;

    if (assignmentCount > 1) {
        score += 1;
    }

    const sensitiveLines = context.split('\n').filter(line =>
        highRiskKeywords.some(keyword => line.toLowerCase().includes(keyword))
    );

    if (sensitiveLines.length > 1) {
        score += 2;
    }

    return { score, reasoning: `${assignmentCount} assignments detected in context` };
}

export function getRiskLevelFromScore(score: number): 'high' | 'medium' | 'low' {
    if (score >= 0.8) return 'high';
    if (score >= 0.5) return 'medium';
    return 'low';
}

export function getDetectionMethod(reasoning: string[]): string {
    const patterns = [
        { key: 'Security keywords', method: 'Keyword Proximity' },
        { key: 'Variable name', method: 'Variable Naming' },
        { key: 'Assignment context', method: 'Assignment Pattern' },
        { key: 'String context', method: 'String Context' }
    ];

    for (const pattern of patterns) {
        if (reasoning.some(reason => reason.includes(pattern.key))) {
            return pattern.method;
        }
    }

    return 'Pattern Matching';
}
