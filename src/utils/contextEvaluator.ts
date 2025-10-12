/**
 * Context Evaluator for Secret Detection
 * ====================================
 *
 * Analyzes the context around potential secrets to provide additional
 * insights and confidence scoring for secret detection.
 */

import { DetectedSecret, SecretContext } from './secretScannerTypes';

export class ContextEvaluator {
    private static readonly KEYWORDS = [
        // Common variable/assignment keywords
        'const', 'let', 'var', 'export',
        // Assignment and configuration keywords
        'process.env', 'env', 'config', 'settings', 'secrets', 'keys', 'tokens',
        'auth', 'api', 'credentials', 'access', 'secret', 'private', 'secure',
        // Database related
        'database', 'db', 'mongo', 'postgres', 'mysql', 'redis', 'connection',
        // Cloud services
        'aws', 'azure', 'gcp', 'firebase', 'heroku', 'vercel', 'netlify'
    ];

    private static readonly HIGH_RISK_KEYWORDS = [
        'password', 'passwd', 'pwd', 'token', 'key', 'secret', 'private_key',
        'access_token', 'api_key', 'auth_token', 'bearer_token', 'refresh_token',
        'secret_key', 'privatekey', 'apikey', 'bearer'
    ];

    /**
     * Get context lines around a detected secret
     */
    static getContextLine(lines: string[], lineIndex: number, charIndex: number): string {
        const startLine = Math.max(0, lineIndex - 1);
        const endLine = Math.min(lines.length - 1, lineIndex + 1);

        let context = lines[lineIndex]; // Current line containing the secret

        // Add surrounding lines with line numbers for better context
        if (startLine !== lineIndex) {
            context = `... ${lines[startLine].trim()}\n${context}`;
        }
        if (endLine !== lineIndex) {
            context += `\n${lines[endLine].trim()} ...`;
        }

        return context;
    }

    /**
     * Calculate comprehensive secret score based on context analysis
     */
    static calculateSecretScore(secretValue: string, context: string): {
        confidence: number;
        score: number;
        riskLevel: 'high' | 'medium' | 'low';
        detectionMethod: string;
        reasoning: string[];
    } {
        let score = 0;
        const reasoning: string[] = [];

        // Analyze keyword proximity
        const keywordScore = this.analyzeKeywordProximity(context);
        score += keywordScore.score;
        reasoning.push(keywordScore.reasoning);

        // Analyze assignment context
        const assignment = this.analyzeAssignmentContext(context);
        score += assignment.score;
        reasoning.push(assignment.reasoning);

        // Analyze variable naming
        const naming = this.analyzeVariableNaming(context);
        score += naming.score;
        reasoning.push(naming.reasoning);

        // Analyze string context
        const stringContext = this.analyzeStringContext(context, secretValue);
        score += stringContext.score;
        reasoning.push(stringContext.reasoning);

        // Analyze neighboring assignments
        const neighbors = this.analyzeNeighboringAssignments(context);
        score += neighbors.score;
        reasoning.push(neighbors.reasoning);

        // Normalize score to 0-1 range and classify
        const normalizedScore = Math.min(1, Math.max(0, score / 10));
        const riskLevel = this.getRiskLevelFromScore(normalizedScore);
        const detectionMethod = this.getDetectionMethod(reasoning);

        return {
            confidence: normalizedScore,
            score,
            riskLevel,
            detectionMethod,
            reasoning
        };
    }

    /**
     * Analyze proximity to security-related keywords
     */
    private static analyzeKeywordProximity(context: string): { score: number; reasoning: string } {
        const lowerContext = context.toLowerCase();
        let score = 0;
        let keywords: string[] = [];

        // Check high-risk keywords first
        for (const keyword of this.HIGH_RISK_KEYWORDS) {
            if (lowerContext.includes(keyword)) {
                score += 6;
                keywords.push(keyword);
                break; // One high-risk keyword is enough
            }
        }

        // Check general keywords
        if (keywords.length === 0) {
            for (const keyword of this.KEYWORDS) {
                if (lowerContext.includes(keyword)) {
                    score += 3;
                    keywords.push(keyword);
                    break; // One keyword is enough
                }
            }
        }

        const reasoning = keywords.length > 0
            ? `Security keywords nearby: ${keywords.join(', ')}`
            : 'No security keywords detected in context';

        return { score, reasoning };
    }

    /**
     * Analyze assignment context patterns
     */
    private static analyzeAssignmentContext(context: string): { score: number; reasoning: string } {
        let score = 0;
        let patterns: string[] = [];

        // Check for assignment patterns
        if (context.includes('=') || context.includes(': ')) {
            score += 2;
            patterns.push('assignment syntax');
        }

        // Check for environment variable patterns
        if (context.includes('process.env.') || context.includes('process.env[')) {
            score += 4;
            patterns.push('environment variable assignment');
        }

        // Check for config object patterns
        if (context.includes('{') && context.includes('}')) {
            score += 2;
            patterns.push('object property');
        }

        // Check for variable declaration
        if (context.match(/\b(const|let|var)\s+(?:\w+\s*[:=])?/)) {
            score += 3;
            patterns.push('variable declaration');
        }

        const reasoning = patterns.length > 0
            ? `Assignment context: ${patterns.join(', ')}`
            : 'No clear assignment context detected';

        return { score, reasoning };
    }

    /**
     * Analyze variable naming conventions
     */
    private static analyzeVariableNaming(context: string): { score: number; reasoning: string } {
        let score = 0;

        // Extract variable name from assignment
        const assignmentMatch = context.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)[\s]*[:=]/);
        if (assignmentMatch) {
            const varName = assignmentMatch[1].toLowerCase();

            // Check for security-related naming
            if (this.HIGH_RISK_KEYWORDS.some(keyword => varName.includes(keyword))) {
                score += 5;
                return { score, reasoning: `Variable name "${assignmentMatch[1]}" suggests sensitive data` };
            }

            // Check for common secret patterns
            const secretPatterns = ['api', 'key', 'token', 'secret', 'auth', 'password'];
            if (secretPatterns.some(pattern => varName.includes(pattern))) {
                score += 3;
                return { score, reasoning: `Variable name "${assignmentMatch[1]}" matches common secret patterns` };
            }

            // Uppercase variables often indicate environment variables
            if (assignmentMatch[1] === assignmentMatch[1].toUpperCase()) {
                score += 2;
                return { score, reasoning: `Uppercase variable name "${assignmentMatch[1]}" (environment variable pattern)` };
            }
        }

        return { score: 0, reasoning: 'Variable naming analysis neutral' };
    }

    /**
     * Analyze string context (quotes, formats)
     */
    private static analyzeStringContext(context: string, secretValue: string): { score: number; reasoning: string } {
        let score = 0;
        let patterns: string[] = [];

        // Check for quotes around secret
        if ((context.includes('"') || context.includes("'") || context.includes('`'))) {
            score += 2;
            patterns.push('quoted value');
        }

        // Check for command-line or config file patterns
        if (context.includes('export ') || context.includes('set ')) {
            score += 3;
            patterns.push('environment export');
        }

        // Check for JSON-like patterns
        if (context.includes('"') && context.includes(':')) {
            score += 2;
            patterns.push('JSON property');
        }

        // Negative factors: might be code comments or documentation
        if (context.includes('//') || context.includes('#') || context.includes('/*')) {
            score -= 3;
            patterns.push('appears in comment');
        }

        // Negative factors: might be example/test values
        if (secretValue.includes('test') || secretValue.includes('example') || secretValue.includes('sample')) {
            score -= 2;
            patterns.push('possible test/example value');
        }

        const reasoning = patterns.length > 0
            ? `String context analysis: ${patterns.join(', ')}`
            : 'String context analysis neutral';

        return { score, reasoning };
    }

    /**
     * Analyze neighboring assignments for patterns
     */
    private static analyzeNeighboringAssignments(context: string): { score: number; reasoning: string } {
        let score = 0;

        // Look for multiple similar assignments (common in config files)
        const assignmentCount = (context.match(/[:=]/g) || []).length;

        if (assignmentCount > 1) {
            score += 1;
        }

        // Look for patterns of sensitive data clustering
        const sensitiveLines = context.split('\n').filter(line =>
            this.HIGH_RISK_KEYWORDS.some(keyword =>
                line.toLowerCase().includes(keyword)
            )
        );

        if (sensitiveLines.length > 1) {
            score += 2;
        }

        return { score, reasoning: `${assignmentCount} assignments detected in context` };
    }

    /**
     * Convert normalized score to risk level
     */
    private static getRiskLevelFromScore(score: number): 'high' | 'medium' | 'low' {
        if (score >= 0.8) return 'high';
        if (score >= 0.5) return 'medium';
        return 'low';
    }

    /**
     * Determine primary detection method from reasoning
     */
    private static getDetectionMethod(reasoning: string[]): string {
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

    /**
     * Get detailed context analysis for debugging
     */
    static getDetailedContextAnalysis(context: string): {
        keywords: string[];
        assignmentPatterns: string[];
        variablePatterns: string[];
        overallScore: number;
        riskAssessment: string;
    } {
        const keywords: string[] = [];
        const assignmentPatterns: string[] = [];
        const variablePatterns: string[] = [];

        // Analyze keywords
        const lowerContext = context.toLowerCase();
        for (const keyword of this.HIGH_RISK_KEYWORDS) {
            if (lowerContext.includes(keyword)) {
                keywords.push(keyword);
            }
        }

        // Analyze assignments
        if (context.includes('process.env.')) assignmentPatterns.push('environment variable');
        if (context.includes('=')) assignmentPatterns.push('equals assignment');
        if (context.includes(': ')) assignmentPatterns.push('colon assignment');
        if (context.match(/\b(const|let|var)\s+/)) assignmentPatterns.push('variable declaration');

        // Analyze variable naming
        const assignmentMatch = context.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)[\s]*[:=]/);
        if (assignmentMatch) {
            variablePatterns.push(assignmentMatch[1]);
        }

        const score = (keywords.length * 2) + (assignmentPatterns.length * 1);
        let assessment: string;

        if (score >= 5) assessment = 'High risk: Multiple security indicators';
        else if (score >= 3) assessment = 'Medium risk: Some security indicators';
        else if (score >= 1) assessment = 'Low risk: Minimal security indicators';
        else assessment = 'Safe: No security indicators detected';

        return {
            keywords,
            assignmentPatterns,
            variablePatterns,
            overallScore: score,
            riskAssessment: assessment
        };
    }
}
