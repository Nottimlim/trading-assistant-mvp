# Development Guide

## Branch Strategy

### Main Branches
- `main`: Production-ready code, protected branch
- `develop`: Integration branch for features, protected branch

### Supporting Branches
- `feature/*`: New features and enhancements
- `bugfix/*`: Bug fixes for develop branch
- `hotfix/*`: Critical fixes for production
- `release/*`: Release preparation

## Workflow

### Feature Development
1. Create feature branch from `develop`
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. Develop and commit using conventional commits
   ```bash
   git commit -m "feat: add new trading rule validation"
   ```

3. Push and create Pull Request to `develop`
   ```bash
   git push origin feature/your-feature-name
   ```

### Release Process
1. Create release branch from `develop`
   ```bash
   git checkout -b release/v1.1.0
   ```

2. Update version numbers, test, and fix bugs
3. Merge to `main` and tag
4. Merge back to `develop`

### Hotfix Process
1. Create hotfix branch from `main`
   ```bash
   git checkout -b hotfix/critical-bug-fix
   ```

2. Fix and test
3. Merge to both `main` and `develop`

## Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `ci`: CI/CD changes
- `build`: Build system changes

### Examples
```
feat(trading): add support for multiple trading platforms
fix(ocr): improve accuracy for balance detection
docs(readme): update installation instructions
```

## Code Quality

### Pre-commit Hooks
- ESLint for code linting
- Prettier for code formatting
- Conventional commit validation

### Testing
- Unit tests for core functions
- Integration tests for trading logic
- E2E tests for user workflows

### Code Review
- All PRs require at least 1 approval
- Automated checks must pass
- Branch must be up-to-date with target
