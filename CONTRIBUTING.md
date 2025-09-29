# Contributing to dotenvy

Thank you for your interest in contributing to dotenvy! We welcome contributions from the community.

## Development Setup

1. **Fork and Clone:**
   ```bash
   git clone https://github.com/kareem2099/dotenvy.git
   cd dotenvy
   npm install
   ```

2. **VS Code Extension Development:**
   - Open the project in VS Code
   - Press `F5` to launch debug session
   - A new VS Code window will open with dotenvy loaded

3. **Testing:**
   ```bash
   npm run compile
   npm run lint
   npm test
   ```

4. **Package for Testing:**
   ```bash
   npx vsce package
   ```
   Install the generated `.vsix` file to test release builds

## Development Workflow

### Code Quality
- **TypeScript:** Strict typing required
- **Linting:** `npm run lint` must pass without errors
- **Tests:** Write tests for new functionality
- **Commits:** Use semantic commit messages:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation
  - `refactor:` for code refactoring

### Pull Request Process

1. **Branch Naming:**
   - Use descriptive branch names: `feature/cloud-sync-improvements` or `fix/git-hook-bug`
   - Create feature branch from `main`

2. **Code Changes:**
   - Keep changes focused and atomic
   - Update tests for any behavior changes
   - Update documentation if needed
   - Ensure backward compatibility

3. **Testing:**
   - Test in different VS Code versions
   - Test with different workspace configurations
   - Manual testing of all affected features

4. **PR Description:**
   - Describe what the change does
   - Explain WHY the change is needed
   - List any breaking changes
   - Reference any related issues

### Architecture Notes

- **`src/extension.ts`** - Extension activation and command registration
- **`src/providers/`** - VS Code providers (tree views, webviews, status bar)
- **`src/commands/`** - Command implementations
- **`src/utils/`** - Shared utilities
- **`resources/`** - Static web assets
- **`test/`** - Test suite

### Adding New Features

1. **Commands:** Register in `package.json contributes.commands` and `src/extension.ts`
2. **Providers:** Implement VS Code extension points (treeDataProvider, webviewViewProvider, etc.)
3. **Configuration:** Add to `package.json contributes.configuration` for user settings
4. **Tests:** Follow existing patterns in `test/` directory

### Reporting Bugs

- Use GitHub Issues with detailed reproduction steps
- Include VS Code version and extension version
- Provide example environment files/config if relevant

### Feature Requests

- Check existing issues first
- Describe the use case and benefit clearly
- Consider implementation complexity vs. value

## License

By contributing to dotenvy, you agree that your contributions will be licensed under the same license as the project (MIT).
