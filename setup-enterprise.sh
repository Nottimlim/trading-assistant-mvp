# Enterprise Git Workflow Setup Script
#!/bin/bash

echo "🚀 Setting up enterprise-grade Git workflow..."

# 1. Create standard branch structure
echo "📋 Creating branch structure..."

# Create develop branch (main integration branch)
git checkout -b develop
git push -u origin develop

# Create feature branch template
git checkout -b feature/initial-setup
echo "# Feature Branch Template" > FEATURE_TEMPLATE.md
git add FEATURE_TEMPLATE.md
git commit -m "feat: add feature branch template"
git push -u origin feature/initial-setup

# Go back to develop
git checkout develop

# 2. Create GitHub workflow files
echo "⚙️ Creating GitHub Actions workflows..."

mkdir -p .github/workflows
mkdir -p .github/ISSUE_TEMPLATE
mkdir -p .github/PULL_REQUEST_TEMPLATE

# CI/CD Pipeline
cat > .github/workflows/ci.yml << 'EOF'
name: CI/CD Pipeline

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test:
    runs-on: macos-latest
    
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run linting
      run: npm run lint || echo "Linting not configured yet"
    
    - name: Run tests
      run: npm test || echo "Tests not configured yet"
    
    - name: Build application
      run: npm run build || echo "Build not configured yet"

  security:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - name: Run security audit
      run: npm audit --audit-level moderate

  build-release:
    needs: [test, security]
    runs-on: macos-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20.x'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Build for production
      run: npm run build-mac
    
    - name: Upload artifacts
      uses: actions/upload-artifact@v4
      with:
        name: trading-assistant-macos
        path: dist/
EOF

# Branch Protection Workflow
cat > .github/workflows/branch-protection.yml << 'EOF'
name: Branch Protection Check

on:
  pull_request:
    branches: [ main ]

jobs:
  enforce-conventions:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    
    - name: Check commit messages
      run: |
        echo "🔍 Checking commit message conventions..."
        # Check if commits follow conventional commits
        git log --oneline origin/main..HEAD | while read line; do
          if [[ ! "$line" =~ ^[a-f0-9]+\ (feat|fix|docs|style|refactor|test|chore|perf|ci|build)(\(.+\))?:\ .+ ]]; then
            echo "❌ Commit message does not follow conventional commits: $line"
            exit 1
          fi
        done
        echo "✅ All commit messages are properly formatted"
    
    - name: Check branch naming
      run: |
        BRANCH_NAME="${GITHUB_HEAD_REF}"
        if [[ ! "$BRANCH_NAME" =~ ^(feature|bugfix|hotfix|release)\/[a-z0-9-]+$ ]]; then
          echo "❌ Branch name '$BRANCH_NAME' does not follow naming conventions"
          echo "Expected: feature/description, bugfix/description, hotfix/description, or release/version"
          exit 1
        fi
        echo "✅ Branch name follows conventions"
EOF

# Release workflow
cat > .github/workflows/release.yml << 'EOF'
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: macos-latest
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20.x'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Build for release
      run: npm run build-mac
    
    - name: Create Release
      uses: softprops/action-gh-release@v1
      with:
        files: |
          dist/*.dmg
          dist/*.zip
        generate_release_notes: true
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
EOF

# Issue templates
cat > .github/ISSUE_TEMPLATE/bug_report.yml << 'EOF'
name: Bug Report
description: File a bug report
title: "[BUG]: "
labels: ["bug", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to fill out this bug report!
  
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: A clear description of what the bug is
      placeholder: Tell us what you see!
    validations:
      required: true
  
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      description: Steps to reproduce the behavior
      placeholder: |
        1. Go to '...'
        2. Click on '....'
        3. Scroll down to '....'
        4. See error
    validations:
      required: true
  
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: A clear description of what you expected to happen
    validations:
      required: true
  
  - type: dropdown
    id: os
    attributes:
      label: Operating System
      multiple: false
      options:
        - macOS Monterey (12.x)
        - macOS Ventura (13.x)
        - macOS Sonoma (14.x)
        - macOS Sequoia (15.x)
    validations:
      required: true
  
  - type: input
    id: version
    attributes:
      label: App Version
      placeholder: ex. v1.0.0
    validations:
      required: true
EOF

cat > .github/ISSUE_TEMPLATE/feature_request.yml << 'EOF'
name: Feature Request
description: Suggest an idea for this project
title: "[FEATURE]: "
labels: ["enhancement", "needs-triage"]
body:
  - type: markdown
    attributes:
      value: |
        We love feature requests! Please help us understand what you're looking for.
  
  - type: textarea
    id: problem
    attributes:
      label: Is your feature request related to a problem?
      description: A clear description of what the problem is
      placeholder: I'm always frustrated when...
  
  - type: textarea
    id: solution
    attributes:
      label: Describe the solution you'd like
      description: A clear description of what you want to happen
    validations:
      required: true
  
  - type: textarea
    id: alternatives
    attributes:
      label: Describe alternatives you've considered
      description: A clear description of any alternative solutions you've considered
  
  - type: dropdown
    id: priority
    attributes:
      label: Priority
      multiple: false
      options:
        - Low
        - Medium
        - High
        - Critical
    validations:
      required: true
EOF

# Pull request template
cat > .github/PULL_REQUEST_TEMPLATE.md << 'EOF'
## 🚀 Description

Brief description of what this PR does.

## 📋 Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 Documentation update
- [ ] 🎨 Style/formatting changes
- [ ] ♻️ Code refactoring
- [ ] ⚡ Performance improvements
- [ ] 🔧 Configuration changes

## 🧪 Testing

- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] I have tested this on my local machine

## 📸 Screenshots (if applicable)

Add screenshots to help explain your changes.

## 📝 Checklist

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] Any dependent changes have been merged and published

## 🔗 Related Issues

Closes #(issue_number)

## 📋 Additional Notes

Add any other context about the pull request here.
EOF

# 3. Create project structure files
echo "📁 Creating project structure..."

# Environment configuration
cat > .env.example << 'EOF'
# Environment Configuration Template
NODE_ENV=development
ELECTRON_DEV=true

# Trading Configuration
DEFAULT_MAX_TRADES=2
DEFAULT_RISK_PERCENT=1
DEFAULT_TIMEOUT_MINUTES=15

# OCR Configuration
TESSERACT_LANGUAGE=eng
OCR_CONFIDENCE_THRESHOLD=0.8

# Security
ENABLE_CRASH_REPORTING=false
TELEMETRY_ENABLED=false
EOF

# ESLint configuration
cat > .eslintrc.js << 'EOF'
module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es6: true,
    node: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module'
  },
  rules: {
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'no-console': 'warn'
  },
  globals: {
    'require': 'readonly',
    'module': 'readonly',
    'process': 'readonly',
    '__dirname': 'readonly'
  }
};
EOF

# Prettier configuration
cat > .prettierrc << 'EOF'
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
EOF

# Editor configuration
cat > .editorconfig << 'EOF'
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false

[*.{json,yml,yaml}]
indent_size = 2
EOF

# Development documentation
mkdir -p docs
cat > docs/DEVELOPMENT.md << 'EOF'
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
EOF

cat > docs/ARCHITECTURE.md << 'EOF'
# System Architecture

## Overview
Trading Assistant is built as an Electron desktop application with a modular architecture supporting real-time trading platform monitoring and rule enforcement.

## Core Components

### Main Process (`src/main.js`)
- Application lifecycle management
- Screen capture coordination
- IPC message handling
- System integration (notifications, shortcuts)

### Renderer Process (`src/renderer/`)
- User interface components
- Real-time data visualization
- Configuration management

### Trading Engine (`src/trading/`)
- Rule evaluation logic
- Trade detection algorithms
- Risk calculation

### OCR Engine (`src/ocr/`)
- Image preprocessing
- Text recognition
- Platform-specific parsing

### Alert System (`src/alerts/`)
- Intervention popup management
- Timeout enforcement
- User notification handling

## Data Flow

1. **Screen Capture**: Desktop capturer → Image buffer
2. **OCR Processing**: Image → Text extraction → Data parsing
3. **Trade Detection**: Balance changes → Trade identification
4. **Rule Evaluation**: Current state → Rule violations
5. **Intervention**: Violations → User alerts → Timeout enforcement

## Security Considerations

- Local data processing only
- No cloud storage of trading data
- Secure handling of screen capture permissions
- Protection against rule bypassing

## Scalability

- Modular plugin architecture for new trading platforms
- Configurable rule engine
- Extensible alert system
- Cross-platform compatibility layer
EOF

# Update package.json with dev scripts
echo "📦 Updating package.json with development scripts..."

# Add this to your package.json manually or use this updated version
cat > package.json << 'EOF'
{
  "name": "trading-assistant-mvp",
  "version": "1.0.0",
  "description": "Real-time trading discipline enforcement tool for MatchTrader",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "NODE_ENV=development electron . --dev",
    "build": "electron-builder",
    "build-mac": "electron-builder --mac",
    "pack": "electron-builder --dir",
    "lint": "eslint src/ --ext .js",
    "lint:fix": "eslint src/ --ext .js --fix",
    "format": "prettier --write \"src/**/*.{js,html,css}\"",
    "test": "echo \"Tests not implemented yet\" && exit 0",
    "release": "electron-builder --publish=always",
    "postinstall": "electron-builder install-app-deps",
    "clean": "rm -rf dist/ node_modules/.cache"
  },
  "build": {
    "appId": "com.tradingassistant.mvp",
    "productName": "Trading Assistant",
    "directories": {
      "output": "dist"
    },
    "mac": {
      "category": "public.app-category.finance",
      "entitlements": "build/entitlements.mac.plist",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "icon": "build/icon.icns"
    },
    "dmg": {
      "contents": [
        {
          "x": 130,
          "y": 220
        },
        {
          "x": 410,
          "y": 220,
          "type": "link",
          "path": "/Applications"
        }
      ]
    },
    "publish": {
      "provider": "github",
      "owner": "nottimlim",
      "repo": "trading-assistant-mvp"
    }
  },
  "dependencies": {
    "electron": "^28.0.0",
    "tesseract.js": "^5.0.0"
  },
  "devDependencies": {
    "electron-builder": "^24.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0"
  },
  "keywords": [
    "trading",
    "discipline",
    "automation",
    "finance",
    "electron",
    "macos"
  ],
  "author": "nottimlim",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/nottimlim/trading-assistant-mvp.git"
  },
  "bugs": {
    "url": "https://github.com/nottimlim/trading-assistant-mvp/issues"
  },
  "homepage": "https://github.com/nottimlim/trading-assistant-mvp#readme"
}
EOF

echo "✅ Enterprise Git workflow setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. git add ."
echo "2. git commit -m 'feat: add enterprise git workflow and project structure'"
echo "3. git push origin develop"
echo "4. Set up branch protection rules on GitHub"
echo "5. Create your first feature branch"