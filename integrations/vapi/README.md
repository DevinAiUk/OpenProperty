# SiLL inbound rental assistant

This directory generates a saved-assistant payload. It takes a caller from a listing question to a confirmed showing or a callback. The Worker supplies approved listings, enforces portfolio scope, and checks the calendar. Configure one inbound assistant for each portfolio credential. Editing SiLL settings produces a new configuration draft. A saved Vapi assistant starts using those settings after its configuration is applied.

## Render the configuration

1. In Vapi, create a **Custom Credential** of type **Bearer Token**. Use header name `Authorization` and enable the Bearer prefix. Store the matching token in the Worker secret configured for this portfolio. Copy the Vapi credential **ID** for the next step. The Vapi private management API key is separate.
2. Set `SILL_VAPI_SERVER_URL` to the externally reachable HTTPS address of this Worker's `/api/leasing/vapi` route and `SILL_VAPI_CREDENTIAL_ID` to the credential ID. Use an untracked local environment file, such as `.dev.vars.vapi`. Use the assistant and tool scopes on a **saved** assistant. Vapi withholds organization webhook credentials when URLs are supplied through transient per-call overrides.
3. Export the voice settings JSON from the SiLL dashboard. From the repository root, render and inspect the configuration before applying it. Omit `--settings` to use the environment and defaults. The generator requires Node.js and has no network side effects.

```sh
umask 077
assistant_payload=$(mktemp)
node --env-file=.dev.vars.vapi integrations/vapi/assistant.mjs \
  --settings /absolute/path/to/voice-settings.json > "$assistant_payload"
node --test integrations/vapi/assistant.test.mjs
```

4. When the office is ready to provision the saved assistant, submit the payload to Vapi's Create Assistant endpoint. The following operator command reads the private API key from an existing protected environment variable. Verify HTTP 201 and keep the returned assistant ID. To update the same assistant later, use `PATCH /assistant/{id}` with the regenerated payload. When disabling a previously enabled consent plan, also clear that plan in Vapi and verify the saved result. Confirm that the assistant uses the expected webhook, six function tools, native call controls, voice and artifact settings before assigning it to a Vapi-managed or imported inbound number.

```sh
node --input-type=module - "$assistant_payload" <<'NODE'
import { readFile } from 'node:fs/promises';
const token = process.env.VAPI_API_KEY;
if (!token) throw new Error('VAPI_API_KEY is required to create a saved assistant.');
const body = await readFile(process.argv[2], 'utf8');
JSON.parse(body);
const response = await fetch('https://api.vapi.ai/assistant', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body,
});
if (response.status !== 201) throw new Error('Vapi returned HTTP ' + response.status + '. Inspect the configuration before retrying.');
const assistant = await response.json();
if (!assistant.id) throw new Error('Vapi response contained no assistant ID.');
console.log(assistant.id);
NODE
```

## Voice and routing settings

Environment overrides take precedence over the matching exported setting. The export is a flat JSON object. Routing numbers, bearer tokens, and lead identifiers stay out of the prompt and model parameters.

| SiLL setting | Environment override | Effect |
| --- | --- | --- |
| `company`, `greeting` | `SILL_VAPI_COMPANY`, `SILL_VAPI_GREETING` | Names the leasing office and sets the opening question. A greeting already identifying the office and AI can be used as written. Otherwise SiLL adds a short localized introduction. |
| `language`, `voice` | `SILL_VAPI_LANGUAGE`, `SILL_VAPI_VOICE` | English, Spanish and French profiles ship with matching Vapi V2 voice and Deepgram Nova 3 transcription language codes. Language tags use their base language. Default voice is Elliot. Clara, Emma and Kai also support V2. Provide localized custom text when changing language. |
| `pace`, `tone` | `SILL_VAPI_PACE`, `SILL_VAPI_TONE` | Sets speech speed and delivery style. Default is normal speed and a warm, conversational delivery. |
| `fallback` | `SILL_VAPI_FALLBACK` | Spoken wording for a failed lookup or action. The assistant offers a human callback. |
| `transferEnabled` | `SILL_VAPI_TRANSFER_ENABLED` | Enables a dynamic transfer request. Set `transferNumber`, `officeDays`, `officeStart`, `officeEnd` and the IANA `timezone` in the portfolio's Worker-backed settings. Use an approved E.164 destination. The Worker checks the local day and hours at request time. |
| `recording`, `transcription`, `disclosure` | `SILL_VAPI_RECORDING`, `SILL_VAPI_TRANSCRIPTION`, `SILL_VAPI_DISCLOSURE` | Default audio and saved transcript retention are off. Live speech recognition still runs, and the Worker can save confirmed leads and concise summaries. Logs, packet captures, and full message history are disabled in the generated artifact plan. |

For audio retention, confirm the Vapi account supports native **Enterprise verbal consent**, determine which disclosure the office will use, and set `SILL_VAPI_CONSENT_MODE=enterprise-verbal`. The operator-approved disclosure must ask for a yes/no decision in the call language and cover the selected retention. An optional `SILL_VAPI_DECLINE_TOOL_ID` can route a refusal to a previously configured tool. Verify the decline and consent paths on an isolated test number. The recording consent receipt appears at `message.compliance.recordingConsent.grantedAt`. The generator rejects transcript-only retention because this configuration relies specifically on Vapi's recording consent feature.

## A call at the leasing desk

The default opening is “Hi, you’ve reached SiLL’s AI rental assistant. I can help with rental details and scheduling a showing. Are you calling about a specific property, or would you like help finding one?” The full system instructions live in [prompt.md](./prompt.md). This is a single assistant. The landlord handles applications and accommodation decisions.

| Phase | Example spoken turn | Evidence needed before advancing |
| --- | --- | --- |
| Look up | “Which property are you calling about?” | The approved listing response supplies the rent, deposit, availability, requirements and amenities that can be quoted. |
| Collect preferences | “What monthly rent range would work for you?” | Ask separately about location, bedrooms, move-in date and property interest. Unknown fields stay empty. |
| Save the inquiry | “I have your number ending in 0142 and your budget at sixteen hundred a month. Have I got that right?” | Caller confirms the read-back, a name and at least one contact method. A local receipt returns `saved: true`. |
| Offer a showing | “I have Tuesday at ten or Thursday at two, both Eastern. Which works better?” | Speak only the calendar's actual returned options and timezone. Dates and amounts in this table illustrate the script. |
| Book | “That’s Thursday, May sixth at two p.m. Eastern at the property we discussed. Would you like me to book it?” | A confirmed tool result must include a calendar event ID. Conflicts trigger another lookup. A timeout leaves the outcome unconfirmed. An accepted Make job only acknowledges receipt. |
| Handoff | “Would you like me to ask the leasing office to call you about that?” | For a callback, `status: requested` means the request was stored. For a transfer, the Worker chooses the destination or refuses when closed. A forwarding event records an attempt. |
| Close | “Is there anything else you'd like to know about the showing?” | Save a short summary and next action for the captured inquiry before an ordinary close. Respect a request to end the call immediately. |

## Webhook contract

The authenticating credential identifies the portfolio. The signed-in dashboard separately identifies the landlord. The Worker binds lead writes to the Vapi call ID supplied in the authenticated envelope. Function arguments carry spoken information and opaque lookup results. Each result is a **JSON string** inside Vapi's `results` array. An HTTP 200 enclosing an `ok: false` result is a failed business action.

```json
{
  "message": {
    "type": "tool-calls",
    "call": { "id": "fixture-call" },
    "toolCallList": [{
      "id": "fixture-tool",
      "type": "function",
      "function": { "name": "lookup_listings", "arguments": { "maxRent": 1600 } }
    }]
  }
}
```

```json
{"results":[{"name":"lookup_listings","toolCallId":"fixture-tool","result":"{\"ok\":true,\"listings\":[]}"}]}
```

Notifications use the same endpoint. End-of-call reports have `message.type = "end-of-call-report"`, `message.call.id` and an optional `endedReason` or analysis. The application uses structured facts; raw report bodies can contain recordings, transcripts and personal information. Function calls and completion notifications can be retried. The payload requests up to three total transport attempts for retryable responses. The application owns deduplication and durable processing. Returned office contacts and availability must come from the selected portfolio.

## Before routing real inquiries

Use fictional callers on an isolated number with a test portfolio and dedicated showing calendar. Inspect SiLL, the calendar and the CRM after each call.

- Check a published listing and an unanswered policy question. The first gets a verified fact, the second a callback offer.
- Try an unavailable unit, a public listing inquiry without contact information, and a caller who supplies just one verified contact method.
- Select a showing, decline the final confirmation, then try a confirmed booking in a fresh test call. A declined booking creates no event. The confirmed one must have exactly one calendar event and the corresponding appointment in SiLL.
- Replay the same tool call and final report. The same inquiry and booking should remain linked. A second caller choosing a slot that was taken hears that it is unavailable.
- Interrupt the calendar or CRM connection. A pending CRM update or unverified calendar result remains visibly pending or failed. Check the follow-up record.
- Test a live transfer inside office hours and a callback outside them. Repeat both branches of any enabled verbal consent gate and inspect which artifacts exist.

Provider references: [saved assistants](https://docs.vapi.ai/api-reference/assistants/create), [server authentication](https://docs.vapi.ai/server-url/server-authentication), [events and retries](https://docs.vapi.ai/server-url/events), [function tools](https://docs.vapi.ai/tools/custom-tools), [transfer calls](https://docs.vapi.ai/tools/transfer-call), [Vapi voices](https://docs.vapi.ai/providers/voice/vapi-voices), [Deepgram languages](https://docs.vapi.ai/providers/transcriber/deepgram), [call artifacts](https://docs.vapi.ai/assistants/call-recording), [recording consent](https://docs.vapi.ai/security-and-privacy/recording-consent-plan), [real estate use case](https://vapi.ai/blog/how-can-real-estate-agents-use-ai).
