# Contributing to dotenvy

This repository is the DotEnvy VS Code extension. Secret analysis talks to an external service; that service is not built or deployed from this tree. See [LLM_ARCHITECTURE_SUMMARY.md](LLM_ARCHITECTURE_SUMMARY.md).

## Development setup

1. Clone the repository and install dependencies:

    ```bash
    git clone https://github.com/kareem2099/dotenvy.git
    cd dotenvy
    npm install
    ```

    CI uses Node.js 20. Use the same major version locally.

2. Open the folder in VS Code and press F5. The `Extension` launch configuration compiles TypeScript, then opens an Extension Development Host with this folder loaded.

3. Run the checks:

    ```bash
    npm test
    ```

    `pretest` compiles with `tsc` and runs ESLint. The test script then runs [test/run-all-tests.js](test/run-all-tests.js), which executes the listed `node:test` files against `out/`. The suite stubs the `vscode` module. It does not start the Extension Development Host. Git must be on `PATH` because the hook tests create a temporary repository.

    `npm run compile` and `npm run lint` are the same steps CI runs on their own.

4. Package a VSIX when you need a release-style install:

    ```bash
    npx @vscode/vsce package
    ```

## Pull requests

CI runs on pushes to `main` and on pull requests that target `main`. See [CI-CD-README.md](CI-CD-README.md).

- Branch from `main` with a name that says what the branch does.
- Keep a change focused. Update tests when behavior changes.
- `npm test` must pass.
- In the pull request, say what changed, why, and whether anything breaks for existing users.
- Commit subjects in this repository are short. A conventional prefix (`feat:`, `fix:`, `docs:`, `refactor:`, `ci:`, `chore:`) is used when it fits.

## Where code lives

- `src/extension.ts` — activation and command registration
- `src/commands/` — command implementations
- `src/providers/` — tree views, webviews, status bar
- `src/utils/` — detection, encryption, history, cloud sync, and the LLM client
- `src/i18n/` — extension strings
- `src/git-hook.ts` — the `dotenvy-hook` CLI used by the Git hook
- `resources/` — icons and webview assets
- `test/` — regression tests and `test/support/`

New commands need an entry in `package.json` under `contributes.commands` and a registration in `src/extension.ts`. User settings go under `contributes.configuration`. New regression tests are `test/<name>.test.js` files that import `out/`, and they must be added to the list in `test/run-all-tests.js`.

## Bugs and features

Open a GitHub issue with steps to reproduce, the VS Code version, and the extension version. For a feature, describe the use case. Search existing issues first.

## License

Contributions are licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
