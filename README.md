# davnx

Nx plugin ecosystem for building and serving NestJS applications at scale.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@davnx/webpack`](./libs/webpack) | [![npm](https://img.shields.io/npm/v/@davnx/webpack)](https://www.npmjs.com/package/@davnx/webpack) | Nx executors for production webpack builds and development serving with hot reload |

## Getting Started

Install the package you need in your Nx workspace:

```bash
npm install -D @davnx/webpack
# or
yarn add -D @davnx/webpack
```

Then configure executors in your project's `project.json`. See each package's README for detailed usage.

## Development

### Prerequisites

- Node.js 22 (see `.nvmrc`)
- Yarn 1.x

### Setup

```bash
git clone https://github.com/davidantoon/davnx.git
cd davnx
yarn install
```

### Commands

```bash
yarn build        # Build all packages
yarn test         # Run all tests
yarn lint         # Lint all packages
```

### Project Structure

```
davnx/
├── libs/
│   └── webpack/          # @davnx/webpack - Nx webpack executors
├── nx.json               # Nx workspace configuration
├── tsconfig.base.json    # Shared TypeScript configuration
└── package.json          # Root workspace
```

## Release Process

This monorepo uses [Nx Release](https://nx.dev/features/manage-releases) with [conventional commits](https://www.conventionalcommits.org/) for automated versioning and publishing.

### How it works

1. Merge a PR to `main`
2. CI analyzes commit messages to determine version bumps:
   - `fix:` — patch release (1.0.0 -> 1.0.1)
   - `feat:` — minor release (1.0.0 -> 1.1.0)
   - `feat!:` or `BREAKING CHANGE:` — major release (1.0.0 -> 2.0.0)
3. CI updates the version, generates a changelog, publishes to npm, and creates a GitHub release

Each package is versioned independently — only packages affected by the commits are released.

### Commit Message Format

```
type(scope): description

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`

**Examples:**

```bash
git commit -m "feat(webpack): add support for SWC compiler"
git commit -m "fix(webpack): resolve source map paths in production builds"
git commit -m "feat(webpack)!: require Node.js 22 minimum"
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes using conventional commit messages
4. Open a pull request against `main`

## License

MIT
