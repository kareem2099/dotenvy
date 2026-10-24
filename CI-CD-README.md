# CI

This repository ships a VS Code extension. Continuous integration is the workflow in [.github/workflows/ci.yml](.github/workflows/ci.yml). There is no container build, Kubernetes deploy, or Terraform apply in this tree.

## When it runs

The workflow runs on:

- a push to `main`
- a pull request that targets `main`

## What it runs

One job, `test`, on `ubuntu-latest`:

1. Checkout the repository.
2. Install Node.js 20, with the npm cache.
3. `npm ci`
4. `npm run compile` (`tsc` to `out/` for type checking and tests, then `esbuild.mjs` bundles `dist/extension.js`, `dist/git-hook.js` and `resources/panel/panel.css`)
5. `npm run lint` (ESLint on `src/**/*.ts`)
6. `node test/run-all-tests.js`

That runner is the same command as `npm test`, minus the `pretest` compile and lint steps, which the workflow already ran. The runner combines `node:test` suites with standalone offline privacy, model parity, UI and cryptographic regression suites that import the compiled extension code. They do not launch VS Code.

The workflow does not publish a VSIX and does not deploy anywhere.

The release-safety tests verify that local credential files are excluded by both
`.gitignore` and `.vscodeignore`, including files beneath `resources/`, and that
machine-local project settings are absent from the Git index. The VSCE package
includes compiled runtime code and production dependencies; it excludes tests,
source, local settings, environment files, key envelopes and private backups.

## Run the same checks locally

```bash
npm ci
npm test
```

`npm test` compiles, lints, then runs the test runner. Node.js 20 matches the workflow.
