---
description: How deployment works — GitHub Actions workflows (client SWA / Terraform infra / API); client auto-deploys on push to main, infra/API are manual via workflow_dispatch during the mono-commit phase
---

Deployment is **GitHub Actions, not manual `az`**. Three workflows in `.github/workflows/`:

| Workflow | Trigger | Does |
|---|---|---|
| `deploy-client.yml` | **`push:` to `main`** (auto) + `workflow_dispatch` | build SSG (`npm run build:ssg`) → deploy the static output to the Azure Static Web App |
| `deploy-infra.yml` | `workflow_dispatch` only (manual) | `terraform init/plan/apply` at the `infra/` root |
| `deploy-api.yml` | `workflow_dispatch` only (manual) | build the .NET image → push to GHCR → `az containerapp update` |

All three authenticate to Azure via **OIDC**; only `deploy-infra` runs in the `infra` environment (a deploy gate).

**Client: automatic.** Every push to `main` (incl. the mono-commit force-push) auto-deploys the front. No
`paths:` filter — a force-push replaces history, so GitHub path filtering is unreliable, and every
mono-commit carries `client/` anyway. A failing `build:ssg` fails the job before the deploy step, so broken
builds never ship.

**Infra / API: manual.** Their `push:` triggers stay OFF so a force-push never fires a destructive Terraform
`apply` or container deploy. Deploy them via Actions → *Run workflow*. (Re-add `paths:` filters to all three
once the repo moves to normal git history.) There is no `make deploy` — no manual `az` deploys.

One-time prerequisites (configured manually, once): Azure OIDC (federated credential + secrets), the
Terraform state backend (`rg-infra-terraform` + storage account), and a public GHCR package. (The SWA
`swa-sd-web` is created by `deploy-infra` Terraform; `deploy-client` fetches its token at runtime.)

$ARGUMENTS
