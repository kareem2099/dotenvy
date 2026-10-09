import { Worker } from 'worker_threads';
import * as path from 'path';
import { LocalPrediction } from './localModel';

/** One worker owns the model. No raw value, context, or networking enters it. */
export class LocalModelService {
    private worker?: Worker;
    private sequence = 0;
    private closed = false;
    public available = false;
    private pending = new Map<number, {resolve: (value: LocalPrediction) => void; reject: (error: Error) => void; timer: NodeJS.Timeout}>();
    public readonly ready: Promise<void>;

    constructor(directory = path.resolve(__dirname, '../../resources/models')) {
        this.ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { reject(new Error('Local model startup timed out')); this.dispose(); }, 10000);
            try {
                this.worker = new Worker(path.join(__dirname, 'localModelWorker.js'), {workerData: {directory}});
                this.worker.on('message', (message: {ready?: boolean; id?: number; result?: LocalPrediction; error?: string}) => {
                    if (message.ready) { clearTimeout(timer); this.available = true; resolve(); return; }
                    if (message.id === undefined) {
                        clearTimeout(timer); reject(new Error(message.error || 'Local model unavailable')); this.dispose(); return;
                    }
                    const request = this.pending.get(message.id);
                    if (!request) { return; }
                    clearTimeout(request.timer); this.pending.delete(message.id);
                    if (message.result) { request.resolve(message.result); }
                    else { request.reject(new Error('Local inference failed')); }
                });
                this.worker.on('error', () => { clearTimeout(timer); reject(new Error('Local model worker failed')); this.dispose(); });
                this.worker.on('exit', () => { clearTimeout(timer); reject(new Error('Local model worker stopped')); this.dispose(); });
            } catch {
                clearTimeout(timer); reject(new Error('Local worker unavailable')); this.dispose();
            }
        });
    }

    async predict(features: number[]): Promise<LocalPrediction> {
        await this.ready;
        if (!this.worker || this.closed || !this.available || this.pending.size >= 64) { throw new Error('Local model unavailable'); }
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Local inference timed out')); }, 10000);
            this.pending.set(id, {resolve, reject, timer});
            this.worker?.postMessage({id, features});
        });
    }

    dispose(): void {
        if (this.closed) { return; }
        this.closed = true; this.available = false;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Local model stopped')); }
        this.pending.clear();
        void this.worker?.terminate();
        this.worker = undefined;
    }
}
