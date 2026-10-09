/** Offline port of DotAegis' exact feature-token transformer forward pass. */
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { createHash } from 'crypto';
import * as path from 'path';

export const MODEL_LABELS = ['high', 'medium', 'low', 'false_positive'] as const;
export interface LocalPrediction {
    prediction: typeof MODEL_LABELS[number];
    confidence: number;
    probabilities: number[];
}
type Matrix = Float64Array;
const N = 35, D = 64, HEADS = 4, HEAD_DIM = D / HEADS, FF = D * 4;

function weight(value: unknown, shape: number[]): Matrix {
    const flat: number[] = [];
    const visit = (item: unknown, depth: number): void => {
        if (depth === shape.length) {
            if (typeof item !== 'number' || !Number.isFinite(item)) { throw new Error('Invalid model weight'); }
            flat.push(item);
        } else {
            if (!Array.isArray(item) || item.length !== shape[depth]) { throw new Error('Invalid model shape'); }
            item.forEach(v => visit(v, depth + 1));
        }
    };
    visit(value, 0);
    return Float64Array.from(flat);
}

function multiply(x: Matrix, w: Matrix, rows: number, inner: number, cols: number): Matrix {
    const output = new Float64Array(rows * cols);
    for (let row = 0; row < rows; row++) {
        for (let k = 0; k < inner; k++) {
            const v = x[row * inner + k];
            for (let col = 0; col < cols; col++) { output[row * cols + col] += v * w[k * cols + col]; }
        }
    }
    return output;
}

function softmax(values: Matrix): Matrix {
    const maximum = Math.max(...values);
    const out = Float64Array.from(values, value => Math.exp(value - maximum));
    const sum = out.reduce((a, b) => a + b, 0);
    return out.map(value => value / sum);
}

interface Layer {
    q: Matrix; k: Matrix; v: Matrix; o: Matrix;
    w1: Matrix; b1: Matrix; w2: Matrix; b2: Matrix; lnWeight: Matrix; lnBias: Matrix;
}

export class LocalTransformer {
    private readonly embedding: Matrix;
    private readonly positions = new Float64Array(N * D);
    private readonly classifier: Matrix;
    private readonly bias: Matrix;
    private readonly layers: Layer[];

    public static load(directory: string): LocalTransformer {
        const manifest = JSON.parse(readFileSync(path.join(directory, 'aegis-v2.manifest.json'), 'utf8'));
        const compressed = readFileSync(path.join(directory, 'aegis-v2.json.gz'));
        if (manifest.format !== 'dotenvy-local-transformer-v1' || manifest.feature_schema !== 2 ||
            createHash('sha256').update(compressed).digest('hex') !== manifest.sha256) {
            throw new Error('Local model checksum or schema mismatch');
        }
        return new LocalTransformer(JSON.parse(gunzipSync(compressed, {maxOutputLength: 8 * 1024 * 1024}).toString()));
    }

    private constructor(data: {
        format: string; is_trained: boolean; config: Record<string, unknown>; parameters: Record<string, unknown>;
    }) {
        const c = data.config;
        if (data.format !== 'dotenvy-local-transformer-v1' || data.is_trained !== true ||
            c.input_mode !== 'features_v2' || c.num_features !== N || c.hidden_dim !== D ||
            c.num_layers !== 2 || c.num_heads !== HEADS || c.num_classes !== 4) {
            throw new Error('Incompatible or untrained local model');
        }
        const p = data.parameters;
        this.embedding = weight(p.feature_embedding, [N, D]);
        this.classifier = weight(p.classifier, [D, 4]);
        this.bias = weight(p.classifier_bias, [4]);
        this.layers = [0, 1].map(i => ({
            q: weight(p[`layer${i}_attn_w_q`], [D, D]), k: weight(p[`layer${i}_attn_w_k`], [D, D]),
            v: weight(p[`layer${i}_attn_w_v`], [D, D]), o: weight(p[`layer${i}_attn_w_o`], [D, D]),
            w1: weight(p[`layer${i}_ffn_w1`], [D, FF]), b1: weight(p[`layer${i}_ffn_b1`], [FF]),
            w2: weight(p[`layer${i}_ffn_w2`], [FF, D]), b2: weight(p[`layer${i}_ffn_b2`], [D]),
            lnWeight: weight(p[`layer${i}_ffn_ln_weight`], [D]), lnBias: weight(p[`layer${i}_ffn_ln_bias`], [D]),
        }));
        for (let row = 0; row < N; row++) {
            for (let col = 0; col < D; col += 2) {
                const angle = row * Math.exp(col * -(Math.log(10000) / D));
                this.positions[row * D + col] = Math.sin(angle);
                this.positions[row * D + col + 1] = Math.cos(angle);
            }
        }
    }

    public predict(features: number[]): LocalPrediction {
        if (features.length !== N || features.some(v => !Number.isFinite(v) || v < 0 || v > 1)) {
            throw new Error('Expected 35 finite features between zero and one');
        }
        let x: Matrix = Float64Array.from(this.embedding, (v, i) => v * features[Math.floor(i / D)] + this.positions[i]);
        for (const layer of this.layers) {
            const q = multiply(x, layer.q, N, D, D), k = multiply(x, layer.k, N, D, D), v = multiply(x, layer.v, N, D, D);
            const merged = new Float64Array(N * D);
            for (let head = 0; head < HEADS; head++) {
                const offset = head * HEAD_DIM;
                for (let row = 0; row < N; row++) {
                    const scores = new Float64Array(N);
                    for (let other = 0; other < N; other++) {
                        for (let col = 0; col < HEAD_DIM; col++) {
                            scores[other] += q[row * D + offset + col] * k[other * D + offset + col];
                        }
                        scores[other] /= Math.sqrt(HEAD_DIM);
                    }
                    const probabilities = softmax(scores);
                    for (let other = 0; other < N; other++) {
                        for (let col = 0; col < HEAD_DIM; col++) {
                            merged[row * D + offset + col] += probabilities[other] * v[other * D + offset + col];
                        }
                    }
                }
            }
            const z = multiply(merged, layer.o, N, D, D);
            const normalized = new Float64Array(N * D);
            for (let row = 0; row < N; row++) {
                let mean = 0, variance = 0;
                for (let col = 0; col < D; col++) { z[row * D + col] += x[row * D + col]; mean += z[row * D + col] / D; }
                for (let col = 0; col < D; col++) { variance += (z[row * D + col] - mean) ** 2 / D; }
                const inv = 1 / Math.sqrt(variance + 1e-6);
                for (let col = 0; col < D; col++) {
                    normalized[row * D + col] = (z[row * D + col] - mean) * inv * layer.lnWeight[col] + layer.lnBias[col];
                }
            }
            const hidden = multiply(normalized, layer.w1, N, D, FF);
            for (let i = 0; i < hidden.length; i++) { hidden[i] = Math.max(0, hidden[i] + layer.b1[i % FF]); }
            x = multiply(hidden, layer.w2, N, FF, D);
            for (let i = 0; i < x.length; i++) { x[i] += z[i] + layer.b2[i % D]; }
        }
        const pooled = new Float64Array(D);
        for (let i = 0; i < x.length; i++) { pooled[i % D] += x[i] / N; }
        const logits = multiply(pooled, this.classifier, 1, D, 4);
        for (let i = 0; i < 4; i++) { logits[i] += this.bias[i]; }
        const probabilities = Array.from(softmax(logits));
        const index = probabilities.indexOf(Math.max(...probabilities));
        return {prediction: MODEL_LABELS[index], confidence: probabilities[index], probabilities};
    }
}
