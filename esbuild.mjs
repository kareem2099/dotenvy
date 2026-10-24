/**
 * Bundles the extension, the Git hook CLI and the webview stylesheet.
 *
 *   node esbuild.mjs               development build (sourcemaps, unminified)
 *   node esbuild.mjs --production  marketplace build (minified, no sourcemaps)
 *   node esbuild.mjs --watch       rebuild on change
 *
 * `tsc` still compiles every module to out/ for type checking and the test
 * suites; the packaged extension only ships the bundles below.
 */
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const node = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'info',
};

const builds = [
    { ...node, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
    { ...node, entryPoints: ['src/git-hook.ts'], outfile: 'dist/git-hook.js' },
    {
        // panel.css is generated: edit resources/panel/styles/*.css instead.
        entryPoints: ['resources/panel/styles/index.css'],
        outfile: 'resources/panel/panel.css',
        bundle: true,
        minify: production,
        logLevel: 'info',
    },
];

if (watch) {
    for (const options of builds) {
        await (await esbuild.context(options)).watch();
    }
} else {
    await Promise.all(builds.map(options => esbuild.build(options)));
}
