/**
 * Types and Interfaces for Secret Detection
 * ========================================
 */

export interface DetectedSecret {
    file: string;
    line: number;
    column: number;
    content: string;
    type: string;
    confidence: 'high' | 'medium' | 'low';
    suggestedEnvVar: string;
    context: string;
    riskScore: number;
    detectionMethod: string;
    reasoning: string[];
}

export interface ScanProgress {
    current: number;
    total: number;
    percentage: number;
    currentFile: string;
    estimatedTimeRemaining: number;
    startTime: number;
}

export interface CacheStats {
    hits: number;
    misses: number;
    totalRequests: number;
    hitRate: number;
    cacheSize: number;
    lastCleanup: number;
}

export interface PerformanceMetrics {
    averageScanTime: number;
    totalScans: number;
    cacheHitRate: number;
    lastCleanupTimestamp: number;
    peakMemoryUsage: number;
}

export interface PatternDefinition {
    regex: RegExp;
    type: string;
    description: string;
    priority: number;
    requiresEntropyCheck: boolean;
}

export interface SecretContext {
    before: string[];
    after: string[];
    variableName?: string;
    isInString: boolean;
    hasAssignment: boolean;
}

export interface EntropyResult {
    score: number;
    isSecret: boolean;
    details: string;
}

export interface SecurityAssessment {
    confidence: number;
    riskLevel: 'high' | 'medium' | 'low' | 'safe';
    detectionMethod: string;
    reasoning: string[];
}

export interface StringContext {
    variableName?: string;
    isInConfig: boolean;
    isInAuth: boolean;
    isInComment: boolean;
    isInString: boolean;
    lineContent: string;
    surroundingCode: string;
}

export interface SecretScore {
    isLikelySecret: boolean;
    confidence: number;
    category: string;
    riskLevel: 'critical' | 'high' | 'medium' | 'low';
    reasoning: string[];
    detectionMethod: 'statistical' | 'contextual' | 'pattern' | 'hybrid';
}

export interface ScanCache {
    filePath: string;
    lastModified: number;
    scanResults: DetectedSecret[];
    fileHash: string;
}
