import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAssistant } from './assistant.mjs';

// Reserved test host and fictional credential ID. No test sends a network request.
const environment = {
  SILL_VAPI_SERVER_URL: 'https://voice.example.test/api/leasing/vapi',
  SILL_VAPI_CREDENTIAL_ID: 'credential-test-fixture',
};

test('voice, intake tools, encrypted transport and persistence defaults', () => {
  const assistant = buildAssistant(environment);
  assert.equal(assistant.voice.voiceId, 'Elliot');
  assert.equal(assistant.transcriber.language, assistant.voice.language);
  assert.match(assistant.firstMessage, /AI rental assistant/);
  assert.deepEqual(assistant.serverMessages, ['tool-calls', 'end-of-call-report']);
  assert.deepEqual(assistant.model.tools.map(tool => tool.function?.name || tool.type), [
    'lookup_listings', 'capture_inquiry', 'available_slots', 'book_showing', 'request_callback', 'summarize_call', 'endCall',
  ]);
  for (const tool of assistant.model.tools.filter(tool => tool.type === 'function')) {
    assert.deepEqual(tool.server, assistant.server);
    assert.equal(tool.server.credentialId, environment.SILL_VAPI_CREDENTIAL_ID);
    assert.ok(!('portfolioId' in tool.function.parameters.properties));
    assert.ok(!('leadId' in tool.function.parameters.properties));
  }
  assert.ok(!assistant.artifactPlan.recordingEnabled);
  assert.ok(!assistant.artifactPlan.transcriptPlan.enabled);
  assert.ok(!assistant.artifactPlan.loggingEnabled);
  assert.ok(!assistant.compliancePlan);
});

test('requires a real deployment setting for both webhook and server-side credential', () => {
  assert.throws(() => buildAssistant({}), /SERVER_URL/);
  assert.throws(() => buildAssistant({ SILL_VAPI_SERVER_URL: environment.SILL_VAPI_SERVER_URL }), /CREDENTIAL_ID/);
  for (const url of ['http://example.test/api/leasing/vapi', 'https://example.test/wrong', 'https://example.test/api/leasing/vapi?token=bad', 'https://username:password@example.test/api/leasing/vapi']) {
    assert.throws(() => buildAssistant({ ...environment, SILL_VAPI_SERVER_URL: url }), /must be an HTTPS URL/);
  }
});

test('spoken language, speed, greeting and fallbacks follow exported settings and env overrides', () => {
  const assistant = buildAssistant({ ...environment, SILL_VAPI_PACE: '1.1' }, {
    company: 'Fictional Rentals', language: 'es-US', voice: 'Clara', pace: 1,
    greeting: '¿Busca un apartamento?', fallback: '¿Le llamamos?', tone: 'Calmado.',
  });
  assert.equal(assistant.voice.language, 'es');
  assert.equal(assistant.transcriber.language, 'es');
  assert.equal(assistant.voice.voiceId, 'Clara');
  assert.equal(assistant.voice.speed, 1.1);
  assert.match(assistant.firstMessage, /inteligencia artificial de Fictional Rentals/);
  assert.match(assistant.firstMessage, /¿Busca un apartamento\?/);
  assert.match(assistant.model.messages[0].content, /Calmado\./);
  assert.match(assistant.model.messages[0].content, /¿Le llamamos\?/);
  const fullGreeting = 'Hi, this is the AI rental assistant for Fictional Rentals. How can I help?';
  assert.equal(buildAssistant(environment, { company: 'Fictional Rentals', greeting: fullGreeting }).firstMessage, fullGreeting);
  assert.throws(() => buildAssistant(environment, { language: 'xx' }), /language profile/);
  assert.throws(() => buildAssistant(environment, { pace: 0 }), /speaking pace/);
});

test('dynamic transfer uses a server decision and excludes identifiers and office contact data', () => {
  const assistant = buildAssistant(environment, {
    transferEnabled: true, transferNumber: '+12025550123', officeDays: [1, 2], officeStart: '09:00',
    portfolioId: 'portfolio-fixture-private', providerToken: 'private-provider-fixture',
  });
  const tool = assistant.model.tools.find(tool => tool.type === 'transferCall');
  assert.ok(tool);
  assert.ok(!tool.destinations);
  assert.ok(!tool.function);
  assert.ok(assistant.serverMessages.includes('transfer-destination-request'));
  assert.doesNotMatch(JSON.stringify(assistant), /12025550123|portfolio-fixture-private|private-provider-fixture/);
});

test('artifact retention requires explicit provider-backed consent, disclosure and supported settings', () => {
  assert.throws(() => buildAssistant(environment, { recording: true }), /Enterprise/);
  assert.throws(() => buildAssistant(environment, { transcription: true }), /Transcript-only/);
  const enrolled = { ...environment, SILL_VAPI_CONSENT_MODE: 'enterprise-verbal' };
  assert.throws(() => buildAssistant(enrolled, { recording: true }), /disclosure/);
  const disclosure = 'For this test, may we record and save a transcript? Please say yes or no.';
  const assistant = buildAssistant(enrolled, { recording: true, transcription: true, disclosure });
  assert.equal(assistant.compliancePlan.recordingConsentPlan.message, disclosure);
  assert.equal(assistant.compliancePlan.recordingConsentPlan.type, 'verbal');
  assert.ok(assistant.artifactPlan.recordingEnabled);
  assert.ok(assistant.artifactPlan.transcriptPlan.enabled);
  assert.ok(!assistant.artifactPlan.loggingEnabled);
  assert.throws(() => buildAssistant(environment, { recording: 'yes' }), /true or false/);
});
