# SiLL landlord workspace

[Landlord workspace](/leasing) · [Interactive sample portfolio](/leasing/demo)

The workspace runs alongside the resident portal. Its six sections cover portfolio performance, approved listings, lead intake, showing windows, cash flow, and integration settings. A portfolio manager can use the private dashboard independently of the phone and CRM connections. The sample portfolio uses fictional records stored in the current browser tab. Its “Try a sample call” flow uses a simulated calendar and CRM. Closing the tab clears its storage under normal browser behavior.

## Architecture and data ownership

| Component | Responsibility and evidence |
| --- | --- |
| Existing Cloudflare Worker, Better Auth and Neon | Rechecks the signed-in manager against the requested portfolio. Leasing tables enforce PostgreSQL row-level policies in a transaction-local portfolio context. Resident sessions and household ticket keys cannot read leasing data. |
| Listings and slots | A manager supplies approved facts, prices, availability, listing photos and showing windows. Lookup returns only listing facts. Explicitly requested unavailable listings include their status. Monthly budgets filter long-term units. Nightly rates carry a separate unit. |
| Calls, leads and callbacks | Stable call IDs bind inquiries to their captured contacts. Confirmed email or normalized phone deduplicates within a portfolio. Conflicting identities go to human review. A callback without a reachable contact is marked “needs contact.” |
| Booking coordinator and Google Calendar | A reservation holds the local slot first. The adapter checks Google free/busy, inserts a deterministic private event ID, and verifies the provider ID, status and times. Pending, cancelled, conflicted and confirmed are distinct states. A lost acknowledgement keeps the hold until reconciliation. |
| Make and HubSpot | The Worker commits a delivery job when lead or booking facts change. A confirmed appointment remains valid during a CRM outage. Make handles routing or sends to the CRM, and can deliver email notifications. An optional direct HubSpot adapter upserts by a unique SiLL ID. Receipts and retry failures are visible in Settings. |
| Monthly financials | Actual records are keyed by property and month. Each listing can carry long-term and short-term projection assumptions. All financial arithmetic uses integer USD cents and basis-point percentages. |

The database includes rental_listings, rental_settings, rental_leads, rental_calls, rental_slots, rental_bookings, rental_callbacks, rental_actuals, rental_receipts, and rental_outbox. Migrations 003 and 004 add leasing tables, grants and transaction-safe intake and booking functions. The existing project constraints continue to own resident data. Sample records are in `src/leasing/demo.js`. They never seed the live database.

## Try the MVP

1. Open the sample portfolio and choose **Try a sample call**. Look up a listing, review the synthetic caller’s preferences, choose a window and confirm. Open **Leads** to expand Jordan’s contact, summary and showing history. The calendar and CRM receipt are labeled as simulated.
2. Open **Financials**. Choose a property or the entire portfolio, actuals or projections, and monthly or annual reporting. **Edit actuals or assumptions** saves inputs. Change occupancy or the nightly rate to see the result and its line items.
3. For real records, sign in at **Resident portal** with a portfolio manager account. Create the portfolio there if needed. Choose **Landlord workspace**, add approved listings and showing windows, then enter monthly financials. The real workspace starts empty.

## Setup and verification

Use Node 24. Install from the repository lockfile and keep the unprivileged Worker database login separate from the migration owner.

```sh
npm ci
npm run build
npm test
npx wrangler deploy --dry-run --outdir /tmp/sill-portal-worker
npx wrangler deploy --config wrangler.leasing-ingress.toml --dry-run --outdir /tmp/sill-leasing-ingress
```

For a standalone deployment, copy `.env.example` to the ignored `.dev.vars`. Supply the existing portal’s authentication settings. Set an owner `MIGRATION_DATABASE_URL` in the migration environment and run `npm run db:migrate`. New installations should also apply `db/runtime-grants.sql` after creating the runtime role. Use `npm run dev` for local development. The private Site distribution uses the existing Cloudflare-backed Site and audience. A standalone portal can deploy with the root Wrangler config.

The end-to-end test exercises the actual Worker, session checks, SQL policies, Vapi envelopes and the real provider adapters against synthetic provider responses. It covers unavailable properties, required contact data, repeat and conflicting events, calendar collisions, rescheduling, cancellation, lost acknowledgements, failed CRM receipt validation, callbacks and cross-portfolio access. A separate suite verifies calendar-day projections, actuals, reserve treatment and escrow flags. The Vapi configuration has its own generator tests. These tests send no real notifications, calendar events or CRM writes.

## Connections to enable

Configure one machine-connected portfolio and one dedicated viewing calendar per Worker deployment. Several managers and portfolios may use the dashboard. Only the portfolio matching `SILL_LEASING_PORTFOLIO_ID` can use the deployment's provider accounts. A caller, model or request body cannot choose the portfolio. Set the ID to the UUID of the intended manager portfolio. Use a separate deployment and credentials for another organization's account.

| Integration | Credentials, setup and decision before live use |
| --- | --- |
| Vapi inbound | Approve the company greeting, language, voice, hours and human destination. Create a Vapi Bearer credential for the Worker, set its matching `VAPI_WEBHOOK_SECRET` as a server secret, render the saved-assistant payload and attach an inbound number. Voice configuration, one-question intake, tool definitions and a worked call are in [the Vapi guide](../integrations/vapi/README.md). |
| Google Calendar | Choose a dedicated showing calendar and time zone. Enable the Google Calendar API in the OAuth client project. Authorize the calendar owner, or a user with writer access, for offline access with Calendar events write and free/busy scopes. Exchange the authorization code for a refresh token. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GOOGLE_CALENDAR_ID`. Use a dedicated calendar with SiLL as its only booking writer when strict conflict prevention is required. Free/busy and event insertion are separate Google operations. |
| Make | Configure both directions independently. The command endpoint uses `MAKE_COMMAND_SECRET`. Async delivery uses `MAKE_WEBHOOK_URL` and `MAKE_WEBHOOK_KEY` (the Make webhook API key). Map a durable provider record or message ID into the response. The five workflow specs and synthetic request/response fixtures are in [the Make guide](../integrations/make/README.md). |
| CRM | Choose Make or the direct HubSpot adapter. Create the unique contact property `sill_lead_id`, or map an approved unique property in Settings. Configure each custom field that the team needs. For direct delivery, supply the private app's contacts write permission and `HUBSPOT_TOKEN`. |
| Notifications and consent | Choose the landlord recipient, enable notices, and configure the receiving Make branch. Recording and saved transcripts default off. Approve locally appropriate wording, languages and retention, verify the account’s native consent feature, then test acceptance and refusal before enabling retention. |

Store secrets with the Site settings or `wrangler secret put NAME --config wrangler.leasing-ingress.toml`. Google and CRM account secrets are used by server code only. Do not publish credential exports. Keep live credentials out of sample scenarios.

### Private dashboard and public webhook ingress

A provider must be able to reach the webhook without interactive browser sign-in. A public Cloudflare Worker deployed with `wrangler.leasing-ingress.toml` exposes only the two authenticated machine routes and runs the five-minute retry job. It uses the same restricted `DATABASE_URL`, portfolio binding and provider secrets as the applicable dashboard. The private Site keeps its existing audience. A normal standalone portal on an externally reachable origin can use its own machine routes and root cron instead. Use one scheduled dispatcher when possible. A signed-in manager can also retry a failed delivery in Settings. For a real launch, verify the credential-free request fails and a disposable authenticated call succeeds before routing a production number.

```sh
npx wrangler deploy --config wrangler.leasing-ingress.toml
```

Use the deployed ingress origin for Vapi and Make. Configure matching, independently generated bearer secrets. Limit Google and HubSpot access to the intended account. The Vapi handler accepts only supported server events, uses provider call IDs for correlation, and discards raw transcripts and audio. Retries of the same event and data reuse its receipt. A changed payload with the same ID is rejected. The job dispatcher backs off to 60 minutes and flags a delivery after eight unsuccessful attempts. The callback workflow and error-handler routes are described in the Make guide.

### Cash-flow conventions

Projected long-term income uses monthly potential rent times occupancy. Short-term income uses the nightly rate times the actual number of days in the month times occupancy. Fee percentages apply to occupied rent. Actual income starts with rent collected and deducts the fees actually paid. Escrow flags exclude separate tax or insurance charges when the financing line already includes them. Reserve transfers appear separately from expenses. Record spending funded by a previously deducted reserve outside the operating-cash expense input.

Annual actuals add entered months and display record coverage. An explicit zero is a recorded month. Missing months are excluded. Annual projections apply each property’s chosen assumptions across all twelve months. The default portfolio scenario includes each property once under its configured rental type. The alternate scenarios compare all properties under the same rental strategy. This tool reports cash remaining after expenses, financing and reserves. It does not calculate tax or accounting profit.

## Reference documentation

[Vapi rental use cases](https://vapi.ai/blog/how-can-real-estate-agents-use-ai) · [Vapi function tools](https://docs.vapi.ai/tools/custom-tools) · [Google Calendar free/busy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) · [Google Calendar event creation](https://developers.google.com/workspace/calendar/api/guides/create-events) · [Make webhooks](https://help.make.com/webhooks) · [HubSpot contacts](https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/guide)

