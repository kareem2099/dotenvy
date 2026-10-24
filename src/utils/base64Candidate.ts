/** Validate an entire Base64 token, rather than a URL/path fragment. */
export function isBase64Candidate(line: string, start: number, value: string): boolean {
    if (!/^[A-Za-z0-9+/]{32,}={0,2}$/.test(value)) return false;
    if (value.includes('=') && value.length % 4 !== 0) return false;
    const unpadded = value.replace(/=+$/, '');
    if (unpadded.length % 4 === 1) return false;
    // Node's decoder accepts malformed input; a canonical round trip checks the
    // unused bits and permits correctly padded and unpadded encodings alike.
    if (Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') !== unpadded) return false;
    // A URI's //hostname/path suffix is not an encoded value. Keep values after
    // query '=' or user:password delimiters eligible for ordinary checks.
    return !(value.startsWith('//') && /\b[a-z][a-z\d+.-]*:$/i.test(line.slice(0, start)));
}
