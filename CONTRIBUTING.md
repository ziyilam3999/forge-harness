# Contributing to Forge Harness

Thanks for your interest in contributing!

## Getting Started

1. Fork and clone the repo
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Run tests: `npm test`

## Development

```bash
npm run build     # Compile TypeScript
npm run test      # Run Vitest suite
npm run lint      # Run ESLint
```

## Submitting Changes

1. Create a branch: `git checkout -b feature/your-feature`
2. Make changes and add tests
3. Ensure all tests pass: `npm test`
4. Submit a pull request

## Guidelines

- Keep PRs focused on a single change
- Add tests for new features
- Follow existing TypeScript conventions (ESM, strict types)
- Use Zod for runtime validation where applicable

## Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
