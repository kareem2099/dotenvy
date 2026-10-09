/**
 * Context Evaluator for Secret Detection
 * ====================================
 *
 * Analyzes the context around potential secrets to provide additional
 * insights and confidence scoring for secret detection.
 */

import { DetectedSecret, SecretContext } from './secretScannerTypes';
import {
    analyzeAssignmentContext,
    analyzeKeywordProximity,
    analyzeNeighboringAssignments,
    analyzeStringContext,
    analyzeVariableNaming,
    getDetectionMethod,
    getRiskLevelFromScore,
} from './secretContextHeuristics';

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

        // Highlight the exact position of the secret in the line
        if (charIndex >= 0) {
            const lineContent = lines[lineIndex];
            const beforeSecret = lineContent.substring(0, charIndex);
            const afterSecret = lineContent.substring(charIndex);
            context = `${beforeSecret}[SECRET]${afterSecret}`;
        }

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
        const keywordScore = analyzeKeywordProximity(context, this.KEYWORDS, this.HIGH_RISK_KEYWORDS);
        score += keywordScore.score;
        reasoning.push(keywordScore.reasoning);

        const assignment = analyzeAssignmentContext(context);
        score += assignment.score;
        reasoning.push(assignment.reasoning);

        const naming = analyzeVariableNaming(context, this.HIGH_RISK_KEYWORDS);
        score += naming.score;
        reasoning.push(naming.reasoning);

        const stringContext = analyzeStringContext(context, secretValue);
        score += stringContext.score;
        reasoning.push(stringContext.reasoning);

        const neighbors = analyzeNeighboringAssignments(context, this.HIGH_RISK_KEYWORDS);
        score += neighbors.score;
        reasoning.push(neighbors.reasoning);

        const normalizedScore = Math.min(1, Math.max(0, score / 10));
        const riskLevel = getRiskLevelFromScore(normalizedScore);
        const detectionMethod = getDetectionMethod(reasoning);

        return {
            confidence: normalizedScore,
            score,
            riskLevel,
            detectionMethod,
            reasoning
        };
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

    /**
     * Enhance detected secret with context analysis
     */
    static enhanceDetectedSecret(secret: DetectedSecret, fileContent: string): DetectedSecret {
        // Get context around the secret
        const lines = fileContent.split('\n');
        const context = this.getContextLine(lines, secret.line - 1, secret.column - 1);

        // Calculate secret score based on context
        const score = this.calculateSecretScore(secret.content, context);

        // Return enhanced secret
        const confidenceMap = { 'low': 0, 'medium': 0.5, 'high': 1 };
        const currentConfidence = confidenceMap[secret.confidence] || 0;
        const newConfidence = score.confidence;
        const finalConfidence = newConfidence > currentConfidence ? score.confidence : secret.confidence;

        return {
            ...secret,
            confidence: finalConfidence as 'high' | 'medium' | 'low',
            context,
            reasoning: [...(secret.reasoning || []), ...score.reasoning]
        };
    }

    /**
     * Analyze secret context from SecretContext interface
     */
    static analyzeSecretContext(secret: string, context: SecretContext): {
        confidence: number;
        riskLevel: 'high' | 'medium' | 'low';
        analysis: string[];
    } {
        const analysis: string[] = [];

        // Analyze variable name from context
        if (context.variableName) {
            const varNameLower = context.variableName.toLowerCase();
            if (this.HIGH_RISK_KEYWORDS.some(keyword => varNameLower.includes(keyword))) {
                analysis.push(`Variable name '${context.variableName}' indicates sensitive data`);
            }
        }

        // Analyze string context
        if (context.isInString) {
            analysis.push('Located within quoted string');
        }

        // Analyze assignment context
        if (context.hasAssignment) {
            analysis.push('Located in assignment statement');
        }

        // Analyze surrounding code context (before and after lines)
        const surroundingCode = [...context.before, ...context.after].join('\n');
        if (surroundingCode) {
            const surroundingScore = this.calculateSecretScore(secret, surroundingCode);
            analysis.push(`Surrounding code analysis: ${surroundingScore.riskLevel} risk`);
        }

        // Analyze lines before/after for patterns
        const allLines = [...context.before, ...context.after].join(' ').toLowerCase();

        // Check for auth-related context
        if (allLines.includes('auth') || allLines.includes('login') || allLines.includes('authentication')) {
            analysis.push('Located in authentication-related code');
        }

        // Check for config context
        if (allLines.includes('config') || allLines.includes('settings')) {
            analysis.push('Located in configuration context');
        }

        // Calculate confidence based on analysis
        let confidence = 0.5; // Base confidence
        if (context.variableName) {
            const varNameLower = context.variableName.toLowerCase();
            if (this.HIGH_RISK_KEYWORDS.some(keyword => varNameLower.includes(keyword))) {
                confidence += 0.3;
            }
        }
        if (context.hasAssignment) confidence += 0.2;
        if (allLines.includes('auth') || allLines.includes('login')) confidence += 0.15;

        confidence = Math.max(0, Math.min(1, confidence));

        const riskLevel = getRiskLevelFromScore(confidence);

        return {
            confidence,
            riskLevel,
            analysis
        };
    }

    /**
     * Get comprehensive security analysis for a detected secret
     */
    static getComprehensiveSecurityAnalysis(secret: DetectedSecret, fileContent: string): {
        securityScore: number;
        recommendations: string[];
        riskFactors: string[];
        mitigationSteps: string[];
        analysis: string[];
    } {
        const analysis: string[] = [];
        const recommendations: string[] = [];
        const riskFactors: string[] = [];
        const mitigationSteps: string[] = [];

        // Analyze secret properties
        if (secret.type.includes('key') || secret.type.includes('token')) {
            riskFactors.push('API key or token detected');
            recommendations.push('Consider rotating this credential');
            mitigationSteps.push('Implement key rotation policy');
        }

        if (secret.confidence === 'high') {
            riskFactors.push('High confidence secret detection');
            recommendations.push('Move to environment variables');
        }

        // Analyze context
        const lines = fileContent.split('\n');
        const context = this.getContextLine(lines, secret.line - 1, secret.column - 1);

        if (context.includes('hardcoded') || context.includes('const ')) {
            riskFactors.push('Potentially hardcoded secret');
            recommendations.push('Never commit hardcoded secrets to version control');
            mitigationSteps.push('Use .env files or secret management services');
        }

        // Calculate security score
        let securityScore = secret.riskScore;
        if (riskFactors.includes('Potentially hardcoded secret')) securityScore += 0.3;
        if (secret.type.includes('password')) securityScore += 0.2;

        securityScore = Math.min(1, securityScore);

        return {
            securityScore,
            recommendations,
            riskFactors,
            mitigationSteps,
            analysis
        };
    }
}
