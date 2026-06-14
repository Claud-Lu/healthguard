# HealthGuard AI CLI Operations

This runbook is for AI coding agents that operate this repository from a CLI.

## Mandatory Context

Read these files before changing behavior:

```bash
sed -n '1,220p' README.md
sed -n '1,220p' README.zh-CN.md
sed -n '1,260p' docs/operator-guide.md
sed -n '1,260p' docs/ai-cli-operations.md
sed -n '1,260p' docs/decisions/业务与交互变更记录.md
```

## Documentation Sync Rule

Operational documentation has two audiences:

- `docs/operator-guide.md`: human-facing guide.
- `docs/ai-cli-operations.md`: AI CLI runbook.

If a change modifies login, registration, project creation, app key usage, SDK integration, deployment, persistence, verification, or troubleshooting, update both files in the same change. Also update `README.md`, `README.zh-CN.md`, and `docs/decisions/业务与交互变更记录.md` when the behavior is user-visible.

## Open-Source Boundary

Never commit private deployment details to this repository:

- company project names
- private domains
- public or internal IP addresses
- personal filesystem paths
- accounts, tokens, passwords, API keys
- business-specific app keys

Use placeholders in this repository. Put real values in the consuming application environment, private deployment scripts, or private knowledge base.

## Local Verification

Run the full verification set before claiming the change is complete:

```bash
yarn test
yarn type-check
yarn lint
yarn build
```

For targeted auth or localization changes, run these first:

```bash
yarn vitest run apps/server/src/app.test.ts
yarn vitest run apps/dashboard/src/i18n.test.ts
```

## Local Smoke Test

Start the collector and dashboard:

```bash
PORT=3100 HOST=127.0.0.1 yarn dev:server
VITE_HEALTHGUARD_API_BASE=http://127.0.0.1:3100/api yarn dev:dashboard --host 127.0.0.1 --port 5175
```

Then verify:

1. Dashboard opens at `http://127.0.0.1:5175/`.
2. China-area time zones default to Chinese; other time zones default to English.
3. Register with a valid email and a password of at least 8 characters.
4. Create a project.
5. Confirm the generated app key has the selected type prefix.
6. Confirm the logged-in home shows the project list, not `demo-web` detail data.
7. Select the project and confirm the detail view loads metrics, issues, and SDK setup for that project.
8. Trigger a test event from a demo or consuming app.
9. Refresh the selected project detail and confirm the event appears.

## Private Deployment Pattern

Build the dashboard with deployment-specific environment variables outside tracked source files:

```bash
VITE_BASE_PATH=/healthguard/ \
VITE_HEALTHGUARD_API_BASE=/healthguard-api \
VITE_HEALTHGUARD_DEFAULT_APP_KEY=demo-web \
yarn workspace @healthguard/dashboard build
```

Build the collector:

```bash
yarn workspace @healthguard/server build
```

Deployment paths, hostnames, SSH aliases, and real app keys are environment-specific. Do not add them to this repository.

Configure repair-agent access with a deployment secret:

```bash
export HEALTHGUARD_AGENT_TOKEN='<STRONG_RANDOM_TOKEN>'
docker compose up -d
```

Agents must call `/api/agent/repair-tasks/*` with `Authorization: Bearer <HEALTHGUARD_AGENT_TOKEN>`. The token is for trusted repair runners only; never commit real values, paste them into issues, or add them to public examples.

## npm Publishing Pattern

Public SDK packages use the `@health-guard` npm organization scope. See `docs/npm-publishing.md` for the full publishing checklist.

Never commit npm tokens. The GitHub Actions workflow `.github/workflows/publish.yml` is designed for npm Trusted Publishing and only runs on `v*` tags from the trusted repository.

## Integration Pattern For A Consuming Web App

Use environment variables in the consuming app:

```env
VITE_HEALTHGUARD_ENDPOINT=<COLLECTOR_ENDPOINT>/events/batch
VITE_HEALTHGUARD_APP_KEY=<PROJECT_APP_KEY>
```

Initialize the SDK:

```ts
import { createHealthGuardClient } from '@health-guard/sdk-web';

createHealthGuardClient({
  appKey: import.meta.env.VITE_HEALTHGUARD_APP_KEY,
  endpoint: import.meta.env.VITE_HEALTHGUARD_ENDPOINT,
  environment: import.meta.env.MODE === 'production' ? 'production' : 'test',
  release: import.meta.env.VITE_APP_VERSION,
  autoCapture: true
});
```

If the consuming app is served over HTTPS, use an HTTPS collector endpoint or an HTTPS same-origin proxy. Browsers block HTTP collector calls from HTTPS pages as mixed content.

## Troubleshooting

- `Request failed: 400` during auth: read the response `code`; the dashboard should map it to a localized message.
- Agent repair APIs return `401`: confirm `HEALTHGUARD_AGENT_TOKEN` is set on the server and the agent sends the same value as a bearer token.
- Agent claim returns `409`: another agent already claimed the task or the task is no longer pending.
- Project list is empty: the logged-in user has not created a project yet, or the in-memory collector restarted.
- Dashboard refresh shows the project list: this is expected when no project is selected. Select a project to inspect its detail data.
- No events appear: confirm endpoint, app key, browser mixed-content rules, and network requests to `/events/batch`.
- Events disappeared after restart: current MVP storage is in-memory.
- Dashboard language looks wrong: clear `healthguard_locale` from browser local storage or switch language manually.
