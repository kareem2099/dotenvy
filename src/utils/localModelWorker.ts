import { parentPort, workerData } from 'worker_threads';
import { LocalTransformer } from './localModel';

try {
    const model = LocalTransformer.load(workerData.directory);
    parentPort?.on('message', (request: {id: number; features: number[]}) => {
        try { parentPort?.postMessage({id: request.id, result: model.predict(request.features)}); }
        catch { parentPort?.postMessage({id: request.id, error: 'Local inference failed'}); }
    });
    parentPort?.postMessage({ready: true});
} catch {
    parentPort?.postMessage({error: 'Bundled local model failed validation'});
    parentPort?.close();
}
