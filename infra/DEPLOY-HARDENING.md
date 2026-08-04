# Deploy hardening — validate at first `apply`

The contact endpoint can only ever mail `contact@super-dev.app` (fixed To/From, Reply-To =
sender), so it is **not** an open relay. The real risks are inbox flood and send volume —
both bounded. The rate limiter stays in-memory (no Redis, cost decision): with
`maximum_instance_count = 1` its 5/min is truly global. Cost backstops, in order: the Resend
free-tier cap (100 mails/day, 3 000/month — sending just stops, it never bills), the Function
App sizing (512 MB × 1 instance max), and the resource-group budget (`monthly_budget_eur`,
alerts at 50%/100% to `budget_alert_email`).

## 0. Resend setup (manual, once)

- Verify `super-dev.app` in the Resend dashboard (Domains → add — publish the SPF/DKIM
  records it gives at Squarespace; MX/SPF for *receiving* via Google already exist — add,
  don't overwrite).
- Create an API key (send-only) and store it as the `RESEND_API_KEY` GitHub secret — the
  deploy-infra workflow feeds it to Terraform, which wires `Contact__ResendApiKey`.
- `Contact__From` (`DoNotReply@super-dev.app`) must be on that verified domain; sending fails
  with a 502 until verification completes.

## 1. Function ingress lock — IN Terraform, validate at first apply

`modules/function-app` now allows ingress only from the `AzureFrontDoor.Backend` service tag
(the SWA linked-backend path); everything else — including the direct
`afu-sd-api.azurewebsites.net` hostname — is denied. Toggle: `restrict_to_front_door`
(default `true`).

**Validate after apply:** `curl` the SWA host `/api/contact` (must answer) and the direct
`https://afu-sd-api.azurewebsites.net/api/contact` (must be 403). If the SWA path is blocked,
the linked backend does not route through `AzureFrontDoor.Backend` as assumed — re-apply with
`-var="restrict_to_front_door=false"`, capture the real source, and re-lock accordingly.

**Tighten once live:** the service tag admits *any* tenant's Front Door. Add a `headers`
filter on `x_azure_fdid` with the SWA's own Front Door ID (readable only from the deployed
SWA, not exposed by azurerm) so only *our* edge passes.

## 2. Re-key the rate limiter for the single-proxy topology

The current key is the **rightmost** `X-Forwarded-For` hop
(`api/src/SuperDev.Api/Http/ClientIdentity/ForwardedFor.cs`). That was correct for the old
Envoy/Container-Apps ingress but is wrong for SWA → Function: the rightmost hop becomes the
SWA egress IP (one global bucket) on the proxied path. Do this **after** item 1 holds.

- Determine the real client-IP position empirically: from a known IP, POST through the SWA and
  inspect what the function actually receives (temporary log of the headers, or App Insights).
  Front Door typically exposes the true client IP in `X-Azure-ClientIP`.
- Then set the caller key in
  `api/src/SuperDev.Api/Http/ClientIdentity/{ForwardedFor.cs,CallerKeyExtensions.cs}` to the
  confirmed source (prefer `X-Azure-ClientIP`; otherwise the validated XFF position), strip any
  `:port`, and fall back to `"unknown"` when the hop shape doesn't match the expected chain.
- Add a unit test pinning the new derivation; keep the existing `ForwardedForTests` shape.
