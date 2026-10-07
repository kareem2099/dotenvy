/**
 * Feature Extractor
 * =================
 *
 * ⚠️  CARBON COPY of python-llm/feature_extractor.py
 *
 * Every feature index, formula, and keyword list here must stay
 * identical to the Python version.  The server's CustomLLM does:
 *
 *   feature_embeds = np.matmul(features.reshape(1, -1), self.feature_embedding)
 *
 * meaning index 0 in TS must equal index 0 in Python, index 7 must
 * equal index 7, etc.  Even a small ordering difference will cause
 * the model to silently produce wrong predictions.
 *
 * Feature groups (matches Python docstring exactly):
 *   [0  – 6 ]  Basic text properties       (7 features)
 *   [7  – 13]  Entropy & randomness        (7 features)
 *   [14 – 19]  Pattern matching            (6 features)
 *   [20 – 24]  Context risk signals        (5 features)
 *   [25 – 29]  Variable name signals       (5 features)
 *   [30 – 34]  Structural analysis         (5 features)
 *              ─────────────────────────────────────────
 *              Total                       35 features
 *
 * HOW TO USE:
 *   import { FeatureExtractor } from './utils/featureExtractor';
 *   const features = FeatureExtractor.extract(secretValue, context, variableName);
 *   // → number[]  length === 35, ready to send to /extension/analyze
 */

import {
    alternatingAlphaDigitScore,
    characterClassBalance,
    countMatching,
    isBase64Like,
    isHexString,
    localEntropyVariance,
    maxRunLength,
    ngramEntropy,
    separatorStructureScore,
    shannonEntropy,
} from './featureTextStats';

// ─── Constants (identical to Python) ──────────────────────────────────────────

export const NUM_FEATURES = 35;

/**
 * [pattern, score, name]
 * Mirrors SECRET_PATTERNS in feature_extractor.py line-for-line.
 * Order matters — we take the highest score, same as Python.
 */
const SECRET_PATTERNS: [RegExp, number, string][] = [
    [/^sk-[a-zA-Z0-9]{20,}/,                                              1.0, 'stripe_secret'  ],
    [/^pk_live_[a-zA-Z0-9]{20,}/,                                         1.0, 'stripe_public'  ],
    [new RegExp('^' + ['A', 'KIA', '[A-Z0-9]{16}'].join('')),             1.0, 'aws_access_key' ],
    [new RegExp('^' + ['g', 'hp_', '[a-zA-Z0-9]{36}'].join('')),          1.0, 'github_pat'     ],
    [new RegExp('^' + ['g', 'ho_', '[a-zA-Z0-9]{36}'].join('')),          1.0, 'github_oauth'   ],
    [/^xox[baprs]-[a-zA-Z0-9-]+/,                                          1.0, 'slack_token'    ],
    [/^SG\.[a-zA-Z0-9\-_]{22,}/,                                           1.0, 'sendgrid'       ],
    [new RegExp('^' + ['AI', 'za', '[0-9A-Za-z\\-_]{35}'].join('')),      1.0, 'google_api'     ],
    [/^ya29\.[0-9A-Za-z\-_]+/,                                             0.9, 'google_oauth'   ],
    [/^eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+$/,           1.0, 'jwt'            ],
    [/^-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/m,                       1.0, 'private_key'    ],
    [/^[0-9a-f]{32}$/,                                                     0.6, 'md5_hash'       ],
    [/^[0-9a-f]{40}$/,                                                     0.7, 'sha1_hash'      ],
    [/^[0-9a-f]{64}$/,                                                     0.8, 'sha256_hash'    ],
    [/(mysql|postgresql|mongodb|redis|amqp):\/\/\S+:\S+@/,                 1.0, 'db_url'         ],
];

// Context keyword lists — identical to Python
const HIGH_RISK_CONTEXT   = ['password','passwd','secret','private_key','api_key',
                              'auth_token','access_token','client_secret','credentials'];
const MEDIUM_RISK_CONTEXT = ['token','key','auth','api','access','bearer',
                              'authorization','credential','config'];
const LOW_RISK_CONTEXT    = ['const','let','var','export','process.env',
                              'os.environ','getenv','dotenv'];

// Special-char set — mirrors Python: set('!#$%&()*+,-./:;<=>?@[\\]^_`{|}~')
const SPECIAL_CHARS = new Set('!#$%&()*+,-./:;<=>?@[\\]^_`{|}~'.split(''));

// ─── Public API ────────────────────────────────────────────────────────────────

export class FeatureExtractor {

    /**
     * Extract exactly 35 features.
     * Throws if the resulting array length !== 35 (sanity-check, same as Python assert).
     */
    public static extract(
        secret: string,
        context: string,
        variableName?: string,
    ): number[] {
        // Pre-process: mirror Pydantic validator in models.py
        //   secret_value = v.replace('\x00','').replace('\r','').replace('\n',' ').strip()
        secret = secret
            .split('\0').join('')
            .replace(/\r/g, '')
            .replace(/\n/g, ' ')
            .trim();

        const f: number[] = [];
        const len  = secret.length;
        const ctx  = context.toLowerCase();
        const vn   = (variableName ?? '').toLowerCase();

        // ── GROUP 1: Basic text (7 features) [0–6] ───────────────────────────

        // 0: normalised length  →  min(1.0, length / 100.0)
        f.push(Math.min(1.0, len / 100.0));

        // 1: meets min length  →  1.0 if length >= 20 else length / 20.0
        f.push(len >= 20 ? 1.0 : len / 20.0);

        // 2: digit ratio
        f.push(countMatching(secret, c => c >= '0' && c <= '9') / Math.max(1, len));

        // 3: uppercase ratio
        f.push(countMatching(secret, c => c >= 'A' && c <= 'Z') / Math.max(1, len));

        // 4: lowercase ratio
        f.push(countMatching(secret, c => c >= 'a' && c <= 'z') / Math.max(1, len));

        // 5: special char ratio  (same set as Python)
        f.push(countMatching(secret, c => SPECIAL_CHARS.has(c)) / Math.max(1, len));

        // 6: unique char ratio
        f.push(new Set(secret).size / Math.max(1, len));

        // ── GROUP 2: Entropy & randomness (7 features) [7–13] ────────────────

        // 7: normalised Shannon entropy  →  _shannon_entropy(secret) / 8.0
        f.push(shannonEntropy(secret) / 8.0);

        // 8: bigram entropy  →  _bigram_entropy(secret) / 8.0
        f.push(ngramEntropy(secret, 2) / 8.0);

        // 9: trigram entropy  →  _trigram_entropy(secret) / 8.0
        f.push(ngramEntropy(secret, 3) / 8.0);

        // 10: compression ratio (incompressibility proxy)
        //   min(1.0, unique_chars / min(len, 64))
        f.push(Math.min(1.0, new Set(secret).size / Math.min(Math.max(len, 1), 64)));

        // 11: max run length ratio  →  _max_run_length(secret) / max(1, length)
        const maxRun = maxRunLength(secret);
        f.push(maxRun / Math.max(1, len));

        // 12: randomness score  →  1.0 - max_run / max(1, length)
        f.push(1.0 - maxRun / Math.max(1, len));

        // 13: local entropy variance  →  _local_entropy_variance(secret)
        f.push(localEntropyVariance(secret));

        // ── GROUP 3: Pattern matching (6 features) [14–19] ───────────────────

        // 14: known pattern match score (float, not just 0/1)
        let bestScore = 0.0;
        for (const [pattern, score] of SECRET_PATTERNS) {
            if (pattern.test(secret) && score > bestScore) {
                bestScore = score;
            }
        }
        f.push(bestScore);

        // 15: base64-like
        f.push(isBase64Like(secret) ? 1.0 : 0.0);

        // 16: hex string
        f.push(isHexString(secret) ? 1.0 : 0.0);

        // 17: known prefix
        const KNOWN_PREFIXES = ['sk-','pk_','A' + 'KIA','g' + 'hp_','xox','SG.','AI' + 'za','ya29.'];
        f.push(KNOWN_PREFIXES.some(p => secret.startsWith(p)) ? 1.0 : 0.0);

        // 18: base64 padding  →  endswith(('==','='))
        f.push(secret.endsWith('==') || secret.endsWith('=') ? 1.0 : 0.0);

        // 19: long base64  →  re.search(r'[A-Za-z0-9+/]{40,}={0,2}$', secret)
        f.push(/[A-Za-z0-9+/]{40,}={0,2}$/.test(secret) ? 1.0 : 0.0);

        // ── GROUP 4: Context risk signals (5 features) [20–24] ───────────────

        // 20: high-risk context  →  min(1.0, sum(0.4 for kw in HIGH_RISK_CONTEXT if kw in ctx))
        f.push(Math.min(1.0, HIGH_RISK_CONTEXT.filter(kw => ctx.includes(kw)).length * 0.4));

        // 21: medium-risk context  →  min(1.0, sum(0.2 ...))
        f.push(Math.min(1.0, MEDIUM_RISK_CONTEXT.filter(kw => ctx.includes(kw)).length * 0.2));

        // 22: assignment context  →  min(1.0, sum(0.1 ...))
        f.push(Math.min(1.0, LOW_RISK_CONTEXT.filter(kw => ctx.includes(kw)).length * 0.1));

        // 23: quoted value  →  any(q in context for q in ('"',"'",'`'))
        f.push(['"', "'", '`'].some(q => context.includes(q)) ? 1.0 : 0.0);

        // 24: assignment operator  →  '=' in context
        f.push(context.includes('=') ? 1.0 : 0.0);

        // ── GROUP 5: Variable name signals (5 features) [25–29] ──────────────

        // 25: dangerous var name  →  min(1.0, sum(0.5 for kw in [...] if kw in vn))
        const DANGER_VAR = ['secret','key','token','password','pwd','pass'];
        f.push(Math.min(1.0, DANGER_VAR.filter(kw => vn.includes(kw)).length * 0.5));

        // 26: risk var name  →  min(1.0, sum(0.3 for kw in [...] if kw in vn))
        const RISK_VAR = ['api','auth','access','private','cred'];
        f.push(Math.min(1.0, RISK_VAR.filter(kw => vn.includes(kw)).length * 0.3));

        // 27: SCREAMING_CASE  →  variable_name == variable_name.upper()
        f.push(variableName && variableName === variableName.toUpperCase() ? 1.0 : 0.0);

        // 28: snake_case  →  '_' in variable_name
        f.push(variableName && variableName.includes('_') ? 1.0 : 0.0);

        // 29: var name length  →  0.0 if not variable_name else min(1.0, len(variable_name)/30)
        f.push(!variableName ? 0.0 : Math.min(1.0, variableName.length / 30.0));

        // ── GROUP 6: Structural analysis (5 features) [30–34] ────────────────

        // 30: alternating alpha-digit score
        f.push(alternatingAlphaDigitScore(secret));

        // 31: separator structure score
        f.push(separatorStructureScore(secret));

        // 32: typical API key length range
        //   1.0 if 20 <= length <= 100 else 0.3 if length > 100 else 0.0
        f.push(len >= 20 && len <= 100 ? 1.0 : len > 100 ? 0.3 : 0.0);

        // 33: balanced char classes
        f.push(characterClassBalance(secret));

        // 34: uppercase+digit cluster
        //   re.search(r'[A-Z]{2,}[0-9]{2,}|[0-9]{2,}[A-Z]{2,}', secret)
        f.push(/[A-Z]{2,}[0-9]{2,}|[0-9]{2,}[A-Z]{2,}/.test(secret) ? 1.0 : 0.0);

        // ── Sanity check (mirrors Python assert) ─────────────────────────────
        if (f.length !== NUM_FEATURES) {
            throw new Error(
                `[DotEnvy] FeatureExtractor: expected ${NUM_FEATURES} features, got ${f.length}`
            );
        }

        return f;
    }
}
