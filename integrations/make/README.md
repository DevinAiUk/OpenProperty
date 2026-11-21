# SiLL rental workflows in Make

SiLL answers the caller from its approved listings, saves the inquiry in Neon, and obtains a Google Calendar receipt during the call. Make handles CRM delivery and landlord notifications. A separate authenticated command endpoint lets a Make intake scenario use the same business rules as Vapi. Keep one entry point for each inquiry so another scenario cannot book it a second time.

## The five workflows

| Request | Make and Worker sequence | Result to use |
| --- | --- | --- |
| New inquiry | After reading back the contact information, send `capture_inquiry` with `confirmed: true`, the name and at least one reachable contact. Include the volunteered preferences. Keep the call ID across later commands. | `{"ok":true,"saved":true}` confirms local capture. The CRM receipt arrives separately. Missing contact returns 422. Conflicting contact identities return 409 for human review. |
| Property lookup | Send `lookup_listings` with the selected listing ID or the caller’s filters. Search filters return available matches. A lookup by ID also returns the recorded status of an unavailable property. The monthly budget filter applies to long-term rents. | Read the listed price with its nightly or monthly basis, deposit, availability and approved requirements. Offer a callback when details are missing. An empty result means the search found no match. |
| Showing booking | Send `available_slots`. Read the date, time, timezone, and property back to the caller. After an explicit yes, send `book_showing` with the selected slot and the same call ID. The Worker checks the calendar, reserves the slot and requests a calendar event. | Confirm aloud only when the Worker returns `status: "confirmed"` and `calendarEventId`. If the slot was taken, request fresh slots. An uncertain provider response needs reconciliation before offering the same slot again. |
| Post-call processing | Call `summarize_call` with both summary and next action. SiLL stores them and queues a CRM update if the call has a lead. Vapi’s automatic `end-of-call-report` marks the call ended and queues one landlord notification per call. | A manual summary saves notes without sending the end-of-call notification. Make cannot issue `end_call`. For either delivery branch, return the downstream provider’s receipt for that event. |
| Human handoff | Vapi requests a transfer destination from the Worker during configured office hours. For a callback, send `request_callback` with the reason and any confirmed phone or email. SiLL queues `handoff.notify`. | `requested` means a contact route was recorded. `needs_contact` means the team still needs contact information. A callback can exist before a lead record. |

The command endpoint is `POST /api/leasing/make`. Use a saved Make HTTP credential for the authorization header and send one JSON object per request. The Worker supplies the portfolio. Give each action a distinct `eventId`. To replay a successful action, send its original call ID, event ID, action and input. Reusing a key with different data returns 409. For another availability check, send a fresh event ID so you get a current snapshot. The example file contains six synthetic commands. Substitute listing and slot IDs from your test system, a future move-in date, and a showing slot inside the next 90 days. [Command examples](./commands.example.json)

The automatic end-of-call handler stores the end marker and acknowledges Vapi after the database write. It leaves an explicit summary intact. If the assistant ended the call before saving a summary, the call can have empty notes. When a lead exists, the end report also queues a CRM update. A confirmed booking or reschedule independently queues a CRM update and a landlord notification. A confirmed cancellation queues a landlord notification. These are distinct events, including when a booking and an end report concern the same call.

## Connect Make

| Server setting | Used by |
| --- | --- |
| `SILL_LEASING_PORTFOLIO_ID` | Worker operator. Scope live commands and delivery to the intended portfolio. |
| `MAKE_COMMAND_SECRET` | Worker and Make HTTP connection. Send `Authorization: Bearer <secret>` on Make-to-Worker requests. |
| `MAKE_WEBHOOK_URL`, `MAKE_WEBHOOK_KEY` | Worker and receiving Make scenario. Treat the URL as private and send the key in `x-make-apikey`. |
| `HUBSPOT_TOKEN` | Worker’s optional direct CRM mode. The Make CRM mode uses the team’s HubSpot connection. |

1. Create an instant **Webhooks → Custom webhook** in the selected Make team. Enable API key authentication, store the generated URL and key in the Worker’s secret bindings, and define the incoming structure from the CRM and notification examples below. Mark the nullable fields optional in Make. The Worker sends the key in `x-make-apikey`.
2. For Make-initiated commands, use **HTTP → Make a request**, method `POST`, a saved API key connection that writes the authorization header, JSON body and parsed JSON response. If a private Sites dispatch protects the origin, provision the separate dispatch credential in server-side settings for that host. The Worker checks its own command secret as well. Use the deployed webhook-capable origin recorded by the operator.
3. Set **Sequential processing** on the delivery scenario. Use a receipt store keyed by the complete opaque `eventId`. Return the stored receipt for a completed delivery of the same kind. Before calling a provider, persist `in_progress` and the event kind. Hold an unexpected change of kind for review. SiLL builds each new attempt from the current call, so preferences or summary text can change between attempts. Retain receipts across the full retry and manual-replay window.
4. Route exactly three kinds using a Make **Router**. Require `version: 1` and a nonempty `eventId` on every branch. On `crm.upsert`, require a `leadId` and expect `notifyTo: null`. On `landlord.notify` and `handoff.notify`, allow a null `leadId` and empty or null contact fields. Require an operator-approved `notifyTo`; a `needs_contact` handoff goes to that landlord even when the caller has supplied no callback details. Reject unsupported kinds or versions.
5. For CRM, use a Make HubSpot OAuth connection with contact write access and read access for reconciliation. For landlord notifications, configure the approved sender and recipient. A Gmail reference route uses **Gmail → Send an email** and takes its output `id` as the send receipt. A message ID confirms acceptance by Gmail. A human still owns the requested follow-up.
6. Place **Webhooks → Webhook response** at the end of each success branch. Store the provider ID before responding. Return HTTP `200`, `Content-Type: application/json`, the exact incoming `eventId`, `status: "confirmed"`, and a nonempty string `recordId` of up to 240 characters. A queue acknowledgement or the default Make response leaves the delivery pending.

| Module in editor | Verified module |
| --- | --- |
| Custom webhook / Webhook response | `gateway:CustomWebHook` v1 / `gateway:WebhookRespond` v1 |
| HTTP request / Router | `http:MakeRequest` v4 / `builtin:BasicRouter` v1 |
| HubSpot contact by email / custom unique key | `hubspotcrm:upsertAContact` v2 / `hubspotcrm:MakeAPICall` v2 |
| Gmail send with a returned message ID | `google-email:sendAnEmail` v4 |

Resolve the webhook, connection, recipient, and custom CRM property choices inside the selected Make team. The repository contains workflow specifications and synthetic JSON examples. Each team supplies its own connections when creating the scenarios. [Make webhooks](https://apps.make.com/gateway) · [Scenario webhook processing](https://help.make.com/webhooks) · [Make HubSpot connection](https://apps.make.com/hubspotcrm)

## CRM mapping

| SiLL field | Destination | Operator action |
| --- | --- | --- |
| `leadId` | Dedicated unique contact property, for example `sill_lead_id` | Provision the property in HubSpot and use it as the external ID for phone-only leads. |
| `contact.name`, `contact.email`, `contact.phone` | Approved full-name property if manually mapped, `crmMap.email`, `crmMap.phone` | Preserve the full name in SiLL. Use the confirmed email or unique SiLL ID for CRM matching. Omit unprovided values. |
| `preferences.budget`, `preferences.location` | `crmMap.budget`, `crmMap.location` | Budget is monthly USD in dollars. Preserve the caller’s stated area. |
| `preferences.moveIn`, `preferences.bedrooms` | `crmMap.moveIn`, `crmMap.bedrooms` | Parse the calendar date as YYYY-MM-DD. Map the bedroom count as an integer, including zero for a studio. |
| `preferences.listingId`, `booking` | Optional property and calendar references in a manually configured Make branch | A booking may be null. Use its `slotId`, `start`, `end`, `status` and `calendarEventId` to describe a provider-confirmed showing. |
| `summary`, `nextAction` | `crmMap.summary`, `crmMap.nextAction` | Send the structured summary and next step. Keep raw transcripts, audio, and financial records in their designated systems. |
| `notifyTo`, `crmMap` | Landlord recipient and CRM property names | The CRM branch receives a null recipient. Validate configured CRM property names against the target account and skip empty mappings. |

Where a confirmed email is available, **Create or Update a Contact** can match it. A consistent custom unique ID is preferable for a portfolio that accepts phone-only calls. Make’s **Make an API Call** module can `POST /crm/v3/objects/contacts/batch/upsert` with one `inputs` row. Put the stable local `leadId` in `id`, the provisioned unique property name in `idProperty`, and only present fields in `properties`. Require batch completion, no item errors, and a nonempty `results[0].id`. HubSpot documents partial upserts for custom unique properties. If the unique property is unavailable and the caller has no email, hold the CRM job and request contact details. Never synthesize an email or split a full name by guesswork. [HubSpot contact upsert](https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide#upsert-contacts)

Choose one CRM transport for a connected portfolio. Direct HubSpot mode sends CRM jobs from the Worker. Make still handles approved notifications. The default portfolio setting has notifications disabled. Enable notifications and choose the recipient before a live test. Jobs processed while notifications are off receive the local status `disabled`.

Each delivery is one JSON object. A handoff uses the callback reason for `summary` and the callback status for `nextAction`. A landlord notification carries the current call summary and most recently updated showing, when available. Generate `recordId` from the actual provider response. The fixtures use synthetic contact details and receipts. [CRM delivery](./delivery.example.json) · [Notifications with no lead](./notifications.example.json) · [CRM receipt](./receipt.example.json)

## Failures and replay

| Condition | Action |
| --- | --- |
| Invalid fields, unsupported action, bad credential, ambiguous contact, or forbidden recipient | Stop the branch, send an error status, and retain the event for an operator. Correct the mapping or credential before replaying. |
| Provider throttling or a temporary outage | Leave the event pending, return a retryable error, and allow the Worker’s delayed redelivery. Keep the same event ID. Honor the provider’s retry window. |
| Provider succeeded but the response was lost | Look up the stored receipt. If only `in_progress` exists, reconcile by the CRM unique key or the notification provider’s message history. For Gmail, put a unique event reference in the message subject and search the authorized Sent mailbox. If the outcome cannot be established, send it to manual review before any resend. |
| Calendar conflict or booking timeout | Ask the Worker for fresh availability or reconcile the deterministic calendar event. The Make scenario must never create a second event as a fallback. |
| Missing receipt or malformed response | Treat delivery as unconfirmed. Return no fabricated success value. |
| Retries exhausted or configuration failure | Enable Make’s scenario-error notifications for the operator. Review failed jobs in SiLL and incomplete runs in Make. Include the event ID, kind, status, and action needed in the alert. Keep contact details and secrets out of alerts and execution notes. |

The Worker’s five-minute job checks for due deliveries. Failures become eligible for another attempt after 1, 2, 4, 8, 16, 32, then 60 minutes. The eighth failed attempt pauses the job for review. Open the failed delivery in SiLL, correct the cause, and retry that event. Choose one retry owner for each external write. Configure Make’s incomplete executions for diagnosis. If Make independently retries a provider call, route the retry through the same receipt and reconciliation check. Gmail sends have an ambiguity window if a run stops after sending. Reconcile that outcome before retrying. [Make retry behavior](https://help.make.com/exponential-backoff)

## Before connecting a caller

Run the command examples with approved test listings and a test calendar. Verify that repeated capture leaves one lead in the dashboard and a replayed booking leaves one calendar event. Check an unavailable property, missing contact, a calendar conflict, a disabled webhook, a mismatched receipt ID, a callback without a lead, and an identical delivery replay. Confirm a manual summary queues no landlord notification of its own, then send the Vapi end report twice and check for exactly one end-of-call notification. Verify each CRM and mail receipt against its event. Use a dedicated test mailbox before switching on landlord notifications.

