# npm Publishing

HealthGuard publishes public npm packages under the `@health-guard` npm organization scope:

- `@health-guard/core`
- `@health-guard/sdk-web`
- `@health-guard/sdk-miniprogram`
- `@health-guard/sdk-uniapp`

## Verification Before Publishing

Run the full verification set:

```bash
yarn test
yarn type-check
yarn lint
yarn build
```

Inspect package contents without publishing:

```bash
npm pack ./packages/core --dry-run
npm pack ./packages/sdk-web --dry-run
npm pack ./packages/sdk-miniprogram --dry-run
npm pack ./packages/sdk-uniapp --dry-run
```

## First Publish

The first publish may need a temporary npm granular access token because npm Trusted Publishing is configured from each package's settings page after the package exists.

Use a short-lived token with read-write permission for the `@health-guard` scope, then publish:

```bash
npm publish ./packages/core --access public
npm publish ./packages/sdk-web --access public
npm publish ./packages/sdk-miniprogram --access public
npm publish ./packages/sdk-uniapp --access public
```

Revoke the temporary token after the packages exist and Trusted Publishing is configured.

## Trusted Publishing Setup

For each npm package, open npm package Settings and add a Trusted Publisher:

- Publisher: GitHub Actions
- GitHub organization/user: `Claud-Lu`
- Repository: `healthguard`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

After that, pushing a `v*` tag from the trusted repository publishes all packages through `.github/workflows/publish.yml` without storing an npm token in GitHub or the repository.
