/**
 * Cache Manager for Secret Detection
 * ================================
 *
 * Manages caching of scan results and performance metrics to optimize
 * secret detection operations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DetectedSecret, CacheStats, PerformanceMetrics } from './secretScannerTypes';

export class CacheManager {
    private static cache: Map<string, { results: DetectedSecret[], timestamp: number }> = new Map();
    private static performanceCache: Map<string, { scanTime: number, timestamp: number }> = new Map();
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    private static readonly MAX_CACHE_SIZE = 1000;

    /**
     * Check if file results should be rescanned
     */
    static shouldRescanFile(filePath: string): boolean {
        const cached = this.cache.get(filePath);
        if (!cached) return true;

        const now = Date.now();
        const isExpired = (now - cached.timestamp) > this.CACHE_DURATION;

        // Also check if file has been modified since last scan
        try {
            const stats = fs.statSync(filePath);
            const fileModified = stats.mtime.getTime();
            const wasModifiedAfterScan = fileModified > cached.timestamp;

            return isExpired || wasModifiedAfterScan;
        } catch (error) {
            // File might not exist anymore
            this.invalidateFileCache(filePath);
            return true;
        }
    }

    /**
     * Get cached results for a file
     */
    static getCachedResults(filePath: string): DetectedSecret[] | null {
        const cached = this.cache.get(filePath);
        if (!cached) return null;

        const now = Date.now();
        if ((now - cached.timestamp) > this.CACHE_DURATION) {
            this.cache.delete(filePath);
            return null;
        }

        return cached.results;
    }

    /**
     * Cache scan results for a file
     */
    static cacheResults(filePath: string, results: DetectedSecret[]): void {
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
            // Remove oldest entries
            const entries = Array.from(this.cache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

            // Remove 20% of oldest entries
            const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
            for (let i = 0; i < toRemove; i++) {
                this.cache.delete(entries[i][0]);
            }
        }

        this.cache.set(filePath, {
            results,
            timestamp: Date.now()
        });
    }

    /**
     * Invalidate cache for a specific file
     */
    static invalidateFileCache(filePath: string): void {
        this.cache.delete(filePath);
        this.performanceCache.delete(filePath);
    }

    /**
     * Clear all cached results
     */
    static clearCache(): void {
        this.cache.clear();
        this.performanceCache.clear();
    }

    /**
     * Record scan time for performance tracking
     */
    static recordScanTime(filePath: string, scanTime: number): void {
        if (!fs.existsSync(filePath)) return;

        try {
            const fileSize = fs.statSync(filePath).size;

            this.performanceCache.set(filePath, {
                scanTime,
                timestamp: Date.now()
            });
        } catch (error) {
            // Ignore errors in performance tracking
        }
    }

    /**
     * Get cache statistics
     */
    static getCacheStats(): CacheStats {
        const now = Date.now();
        let hits = 0;
        let misses = 0;
        let totalSize = 0;

        // Count valid cache entries
        for (const entry of this.cache.values()) {
            if ((now - entry.timestamp) <= this.CACHE_DURATION) {
                totalSize += JSON.stringify(entry.results).length;
            } else {
                misses++;
            }
        }

        // Calculate hit rate (this would need to track actual hits/misses)
        const totalRequests = this.cache.size;
        const hitRate = totalRequests > 0 ? hits / totalRequests : 0;

        return {
            hits,
            misses: Math.max(0, this.cache.size - hits), // Approximate misses
            totalRequests,
            hitRate,
            cacheSize: totalSize,
            lastCleanup: this.getLastCleanupTime()
        };
    }

    /**
     * Get performance metrics
     */
    static getPerformanceMetrics(): PerformanceMetrics {
        const now = Date.now();
        const validEntries = Array.from(this.performanceCache.values())
            .filter(entry => (now - entry.timestamp) <= 24 * 60 * 60 * 1000); // Last 24 hours

        if (validEntries.length === 0) {
            return {
                averageScanTime: 0,
                totalScans: 0,
                cacheHitRate: 0,
                lastCleanupTimestamp: Date.now(),
                peakMemoryUsage: 0
            };
        }

        const totalTime = validEntries.reduce((sum, entry) => sum + entry.scanTime, 0);
        const averageScanTime = totalTime / validEntries.length;

        const cacheStats = this.getCacheStats();
        const memoryUsage = this.getMemoryUsage();

        return {
            averageScanTime: Math.round(averageScanTime * 100) / 100, // Round to 2 decimal places
            totalScans: validEntries.length,
            cacheHitRate: cacheStats.hitRate,
            lastCleanupTimestamp: this.getLastCleanupTime(),
            peakMemoryUsage: memoryUsage
        };
    }

    /**
     * Cleanup expired cache entries
     */
    static cleanupExpiredCache(): number {
        const now = Date.now();
        let removedCount = 0;

        // Clean main cache
        for (const [filePath, entry] of this.cache.entries()) {
            if ((now - entry.timestamp) > this.CACHE_DURATION) {
                this.cache.delete(filePath);
                removedCount++;
            }
        }

        // Clean performance cache (older entries)
        for (const [filePath, entry] of this.performanceCache.entries()) {
            if ((now - entry.timestamp) > 24 * 60 * 60 * 1000) { // 24 hours
                this.performanceCache.delete(filePath);
            }
        }

        return removedCount;
    }

    /**
     * Get approximate memory usage
     */
    private static getMemoryUsage(): number {
        let totalSize = 0;

        // Estimate cache size
        for (const [filePath, entry] of this.cache.entries()) {
            totalSize += filePath.length * 2; // String size approximation
            totalSize += JSON.stringify(entry.results).length;
        }

        // Estimate performance cache size
        for (const entry of this.performanceCache.values()) {
            totalSize += JSON.stringify(entry).length;
        }

        return totalSize;
    }

    /**
     * Get last cleanup time (for mocking, returns current time)
     */
    private static getLastCleanupTime(): number {
        return Date.now(); // In a real implementation, this would track last cleanup
    }

    /**
     * Get detailed cache information for debugging
     */
    static getCacheInfo(filePath?: string): {
        fileCount: number;
        totalSize: number;
        averageScanTime: number;
        oldestEntry?: number;
        newestEntry?: number;
    } {
        const fileCount = this.cache.size;
        const totalSize = this.getMemoryUsage();
        const metrics = this.getPerformanceMetrics();
        const averageScanTime = metrics.averageScanTime;

        let oldestEntry: number | undefined;
        let newestEntry: number | undefined;

        for (const entry of this.cache.values()) {
            if (!oldestEntry || entry.timestamp < oldestEntry) {
                oldestEntry = entry.timestamp;
            }
            if (!newestEntry || entry.timestamp > newestEntry) {
                newestEntry = entry.timestamp;
            }
        }

        return {
            fileCount,
            totalSize,
            averageScanTime,
            oldestEntry,
            newestEntry
        };
    }

    /**
     * Initialize cache manager (set up automatic cleanup)
     */
    static initialize(): void {
        // Set up automatic cleanup every 10 minutes
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 10 * 60 * 1000);
    }
}

// Initialize the cache manager
CacheManager.initialize();
