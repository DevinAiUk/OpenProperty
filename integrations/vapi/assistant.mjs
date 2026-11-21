import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const prompt = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8').trim();

const languages = {
  en: {
    name: 'English',
    intro: company => company === 'SiLL' ? 'Hi, you’ve reached SiLL’s AI rental assistant.' : `Hi, you’ve reached SiLL, the AI rental assistant for ${company}.`,
    greeting: 'I can help with rental details and scheduling a showing. Are you calling about a specific property, or would you like help finding one?',
    fallback: 'I couldn’t verify that. Would you like me to ask someone to follow up?',
  },
  es: {
    name: 'Spanish',
    intro: company => company === 'SiLL' ? 'Hola, soy el asistente de alquileres con inteligencia artificial de SiLL.' : `Hola, soy SiLL, el asistente de alquileres con inteligencia artificial de ${company}.`,
    greeting: 'Puedo darte información sobre los alquileres y ayudarte a programar una visita. ¿Te interesa alguna propiedad en particular?',
    fallback: 'No pude verificarlo. ¿Quieres que alguien se comunique contigo?',
  },
  fr: {
    name: 'French',
    intro: company => company === 'SiLL' ? 'Bonjour, vous parlez à l’assistant de location par intelligence artificielle de SiLL.' : `Bonjour, vous parlez à SiLL, l’assistant de location par intelligence artificielle de ${company}.`,
    greeting: 'Je peux vous renseigner sur les locations et vous aider à prendre rendez-vous pour une visite. Un logement en particulier vous intéresse ?',
    fallback: 'Je n’ai pas pu vérifier cette information. Souhaitez-vous que quelqu’un vous rappelle ?',
  },
};

const stringField = description => ({ type: 'string', description });
const listingId = stringField('Listing identifier from the approved property lookup. Never invent one.');
const location = stringField('City, neighborhood, or property location the caller requested.');
const budget = { type: 'number', description: 'Maximum monthly rent in US dollars, not cents.' };
const bedrooms = { type: 'integer', description: 'Bedrooms requested. Zero means a studio.' };
const moveIn = { type: 'string', format: 'date', description: 'Caller-stated move-in date, YYYY-MM-DD. Omit an uncertain date.' };
const phone = stringField('Caller-confirmed phone number with country code. Omit if unknown.');
const email = { type: 'string', format: 'email', description: 'Caller-confirmed email. Omit if unknown.' };
const confirmed = { type: 'boolean', description: 'Send true only after the caller explicitly agrees to this specific action after read-back.' };

const functions = [
  {
    name: 'lookup_listings',
    description: 'Look up approved property facts or match spoken preferences. Use for all questions about price, features, dates or requirements. Use only returned listing IDs. Omit unprovided filters.',
    properties: { listingId, location, maxRent: budget, bedrooms, moveIn },
    required: [],
  },
  {
    name: 'capture_inquiry',
    description: 'Save this call’s inquiry after read-back and permission. Supply a name and at least one confirmed contact method. Include only spoken preferences. A saved inquiry is a local receipt.',
    properties: { name: stringField('Name the caller provided.'), phone, email, budget, location, moveIn, bedrooms, listingId, confirmed },
    required: ['name', 'confirmed'],
  },
  {
    name: 'available_slots',
    description: 'Read current showing openings for one approved available listing. Use the returned start, end and timezone. Offer only returned slots.',
    properties: { listingId },
    required: ['listingId'],
  },
  {
    name: 'book_showing',
    description: 'Book one returned slot for this call’s saved lead after explicit spoken confirmation of the property, date, time and timezone. Report a booking only on ok:true, status:confirmed and a calendarEventId.',
    properties: { slotId: stringField('Opaque ID from the latest available slots for the selected property.'), confirmed },
    required: ['slotId', 'confirmed'],
  },
  {
    name: 'request_callback',
    description: 'Record a callback with permission. Use a confirmed contact already saved on this call or collect a phone or email. A needs_contact result is not a completed callback request.',
    properties: { reason: stringField('One neutral sentence stating the question for a person.'), phone, email },
    required: ['reason'],
  },
  {
    name: 'summarize_call',
    description: 'Save a short factual summary for this inquiry and the next follow-up action. Include only verified outcomes. Skip protected characteristics, transcripts, and repeated contact details.',
    properties: { summary: stringField('Concise inquiry, preference and verified outcome.'), nextAction: stringField('Specific next action, or no further action when the caller is finished.') },
    required: ['summary', 'nextAction'],
  },
];

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function asBoolean(value, label) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${label} must be true or false.`);
}

function callbackServer(env) {
  const url = new URL(requiredText(env.SILL_VAPI_SERVER_URL, 'SILL_VAPI_SERVER_URL'));
  if (url.protocol !== 'https:' || url.pathname !== '/api/leasing/vapi' || url.username || url.password || url.search || url.hash) {
    throw new Error('SILL_VAPI_SERVER_URL must be an HTTPS URL ending in /api/leasing/vapi, without credentials, query or fragment.');
  }
  return {
    url: url.href,
    credentialId: requiredText(env.SILL_VAPI_CREDENTIAL_ID, 'SILL_VAPI_CREDENTIAL_ID'),
    timeoutSeconds: 20,
    backoffPlan: { type: 'exponential', maxRetries: 3, baseDelaySeconds: 1, excludedStatusCodes: [400, 401, 403, 404, 405, 413, 422] },
  };
}

// Only these named settings enter the assistant. Portfolio identifiers, phone routing,
// provider keys and other configuration stay with the service that owns them.
export function buildAssistant(env = process.env, settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Voice settings must be a JSON object.');
  const option = (key, envName, fallback) => {
    const override = env['SILL_VAPI_' + envName];
    if (override !== undefined && override !== '') return override;
    const value = settings[key];
    return value === undefined || value === null || value === '' ? fallback : value;
  };
  const server = callbackServer(env);
  const language = String(option('language', 'LANGUAGE', 'en')).toLowerCase().split('-')[0];
  if (!Object.hasOwn(languages, language)) throw new Error('Choose an authored language profile: en, es, or fr.');
  const speech = languages[language];
  const company = requiredText(option('company', 'COMPANY', 'SiLL'), 'Company');
  const voiceId = requiredText(option('voice', 'VOICE', 'Elliot'), 'Voice');
  const speed = Number(option('pace', 'PACE', 1));
  if (!Number.isFinite(speed) || speed < 0.8 || speed > 1.2) throw new Error('Choose a speaking pace from 0.8 to 1.2.');
  const tone = requiredText(option('tone', 'TONE', 'Warm, matter-of-fact, and conversational.'), 'Tone');
  const fallback = requiredText(option('fallback', 'FALLBACK', speech.fallback), 'Fallback');
  const greeting = requiredText(option('greeting', 'GREETING', speech.greeting), 'Greeting');
  const identifiesOffice = greeting.toLocaleLowerCase().includes(company.toLocaleLowerCase());
  const disclosesAi = /\b(?:AI|IA|artificial intelligence|inteligencia artificial|intelligence artificielle)\b/iu.test(greeting);
  const firstMessage = identifiesOffice && disclosesAi ? greeting : [speech.intro(company), greeting].join(' ');
  const transfer = asBoolean(option('transferEnabled', 'TRANSFER_ENABLED', false), 'Transfer setting');
  const recording = asBoolean(option('recording', 'RECORDING', false), 'Recording setting');
  const transcription = asBoolean(option('transcription', 'TRANSCRIPTION', false), 'Saved transcript setting');
  const disclosure = option('disclosure', 'DISCLOSURE', '');
  const voice = { provider: 'vapi', version: 2, voiceId, language, speed };

  const tools = functions.map(({ name, description, properties, required }) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
    server,
  }));
  tools.push({ type: 'endCall' });
  const serverMessages = ['tool-calls', 'end-of-call-report'];
  let humanRoute = 'Offer a callback when a person is requested. Only promise a callback request after the service returns requested.';
  if (transfer) {
    // No static or model-provided number. The Worker alone resolves the destination
    // using portfolio office hours and its approved number at request time.
    tools.push({ type: 'transferCall', messages: [
      { type: 'request-failed', role: 'system', content: 'Explain that the call was not transferred and offer to save a callback request.' },
    ] });
    serverMessages.push('transfer-destination-request');
    humanRoute = 'With caller permission, try the human transfer tool. Let the server resolve an approved destination and hours. Never supply a phone number to the transfer tool. If refused or unavailable, offer to save a callback. A transfer attempt does not prove someone answered.';
  }

  const assistant = {
    name: 'SiLL Rental Assistant',
    firstMessageMode: 'assistant-speaks-first',
    firstMessage,
    model: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      messages: [{ role: 'system', content: [
        prompt, `Use ${speech.name} and identify the office as ${JSON.stringify(company)}.`,
        `Delivery style: ${tone}`, `Approved fallback wording: ${fallback}`, humanRoute,
      ].join('\n\n') }],
      tools,
    },
    transcriber: { provider: 'deepgram', model: 'nova-3', language },
    voice,
    server,
    serverMessages,
    artifactPlan: {
      recordingEnabled: recording,
      videoRecordingEnabled: false,
      loggingEnabled: false,
      fullMessageHistoryEnabled: false,
      pcapEnabled: false,
      transcriptPlan: { enabled: transcription },
    },
  };
  if (recording || transcription) {
    if (!recording) throw new Error('Transcript-only retention needs a separately verified pre-consent flow. This generator supports native verbal recording consent.');
    if (env.SILL_VAPI_CONSENT_MODE !== 'enterprise-verbal') throw new Error('Enable the Vapi Enterprise verbal consent feature before selecting retention and set SILL_VAPI_CONSENT_MODE=enterprise-verbal.');
    const message = requiredText(disclosure, 'Approved verbal consent disclosure in the call language');
    assistant.compliancePlan = { recordingConsentPlan: { type: 'verbal', message, voice } };
    if (env.SILL_VAPI_DECLINE_TOOL_ID) assistant.compliancePlan.recordingConsentPlan.declineToolId = env.SILL_VAPI_DECLINE_TOOL_ID;
  }
  return assistant;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { settings: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
    if (values.help) {
      process.stdout.write('node integrations/vapi/assistant.mjs [--settings exported-voice-settings.json]\nRenders a saved-assistant payload to standard output. See integrations/vapi/README.md for required environment settings.\n');
    } else {
      const settings = values.settings ? JSON.parse(readFileSync(values.settings, 'utf8')) : {};
      process.stdout.write(JSON.stringify(buildAssistant(process.env, settings), null, 2) + '\n');
    }
  } catch (error) {
    process.stderr.write('SiLL voice configuration: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
