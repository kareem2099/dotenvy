/**
 * Doppler project slug normalization.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeDopplerProjectSlug } = require('../out/utils/dopplerProjectSlug.js');

describe('doppler project slug', () => {
    test('replaces dots with hyphens like Doppler slugs', () => {
        assert.equal(normalizeDopplerProjectSlug('formamente.webservice'), 'formamente-webservice');
    });

    test('normalizes scoped npm package names', () => {
        assert.equal(normalizeDopplerProjectSlug('@acme/my.app'), 'my-app');
    });

    test('collapses underscores, spaces, and repeated hyphens', () => {
        assert.equal(normalizeDopplerProjectSlug('My_App name'), 'my-app-name');
        assert.equal(normalizeDopplerProjectSlug('a..b'), 'a-b');
    });
});
