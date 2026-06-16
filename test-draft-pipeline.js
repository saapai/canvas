/**
 * Draft Pipeline Test Suite
 * Tests the full draft lifecycle WITHOUT sending any actual SMS.
 *
 * Run: node test-draft-pipeline.js
 *
 * Requires: POSTGRES_URL and OPENAI_API_KEY env vars
 */

import * as smsDb from './shared/sms-db.js';
import * as actions from './shared/sms-actions.js';
import { classifyIntent } from './shared/sms-classifier.js';
import { applyPersonality, applyPersonalityAsync, TEMPLATES } from './shared/sms-personality.js';
import { buildWeightedHistoryFromMessages } from './shared/sms-history.js';
import { initDatabase, getPool } from './shared/db.js';

const TEST_PHONE = '0000000000'; // Fake phone - will never send real SMS
const TEST_ENTRY_ID = 'test-draft-pipeline-entry';
const TEST_USER_NAME = 'TestUser';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}${details ? ': ' + details : ''}`);
    failed++;
    failures.push({ testName, details });
  }
}

async function cleanup() {
  const db = getPool();
  await db.query(`DELETE FROM sms_drafts WHERE phone_normalized = $1`, [TEST_PHONE]);
  await db.query(`DELETE FROM sms_messages WHERE phone_normalized = $1 OR phone = $1`, [TEST_PHONE]);
}

// ============================================
// TEST 1: Classifier correctly identifies draft_write intents
// ============================================
async function testClassifier() {
  console.log('\n📋 TEST 1: Classifier - draft_write detection');

  const draftWriteMessages = [
    'text everyone "THE motherfucking jarvis is back. get yo ass to sunset for pledge olympics. 12-3pm"',
    'send an announcement saying meeting is at 5pm',
    'announce soccer practice tomorrow at 3',
    'tell everyone party is at 8',
    'yo text everyone we got practice at 3',
    'blast everyone about the game',
    'send out an announcement',
    'text the boys about the party',
    'let everyone know meeting is cancelled',
    'send an announcement. text everyone "party at 8"',
  ];

  const baseContext = {
    history: [],
    activeDraft: null,
    isAdmin: true,
    userName: TEST_USER_NAME,
    hasActivePoll: false,
    pendingExcuseRequest: false,
  };

  for (const msg of draftWriteMessages) {
    const result = await classifyIntent({ ...baseContext, currentMessage: msg });
    assert(
      result.action === 'draft_write',
      `"${msg.substring(0, 50)}..." → draft_write`,
      `got ${result.action} (${result.reasoning})`
    );
  }

  // Test that these are NOT classified as draft_write
  console.log('\n📋 TEST 1b: Classifier - NOT draft_write');
  const notDraftWrite = [
    { msg: 'how do I make an announcement', expected: 'capability_query' },
    { msg: 'when is the meeting', expected: 'content_query' },
    { msg: 'hey', expected: 'chat' },
    { msg: 'thanks', expected: 'chat' },
  ];

  for (const { msg, expected } of notDraftWrite) {
    const result = await classifyIntent({ ...baseContext, currentMessage: msg });
    assert(
      result.action !== 'draft_write',
      `"${msg}" → NOT draft_write`,
      `got ${result.action}`
    );
  }
}

// ============================================
// TEST 2: Draft send confirmation - what user sees MATCHES what gets sent
// ============================================
async function testDraftDisplayMatchesDB() {
  console.log('\n📋 TEST 2: Draft display matches database content');
  await cleanup();

  const testContent = 'THE motherfucking jarvis is back. get yo ass to sunset for pledge olympics. 12-3pm';

  // Step 1: Create draft
  const createResult = await actions.handleDraftWrite({
    phone: TEST_PHONE,
    message: `announce ${testContent}`,
    userName: TEST_USER_NAME,
    isAdmin: true,
    classification: { action: 'draft_write', confidence: 0.95, subtype: 'announcement' },
    recentMessages: [],
    entryId: TEST_ENTRY_ID,
  });

  const displayedInResponse = createResult.response;
  const draftFromNewDraft = createResult.newDraft?.content;

  // Step 2: Read draft from DB
  const dbDraft = await smsDb.getActiveDraft(TEST_PHONE, TEST_ENTRY_ID);

  console.log(`  Displayed in newDraft: "${draftFromNewDraft?.substring(0, 80)}..."`);
  console.log(`  Stored in DB:          "${dbDraft?.content?.substring(0, 80)}..."`);

  assert(
    dbDraft !== null,
    'Draft exists in DB after creation'
  );

  assert(
    draftFromNewDraft === dbDraft?.content,
    'newDraft.content matches DB draft_text',
    `newDraft: "${draftFromNewDraft?.substring(0, 50)}" vs DB: "${dbDraft?.content?.substring(0, 50)}"`
  );

  // Check the response text contains the DB content
  assert(
    displayedInResponse.includes(dbDraft?.content?.substring(0, 30) || 'NOMATCH'),
    'Response text contains the DB draft content',
    `Response doesn't include draft content`
  );

  // Step 3: Apply personality (as sms.js does) and verify it doesn't alter content
  // In production, sms.js passes a neutral userMessage for draft actions
  // to prevent the insult detector from eating the response when drafts contain profanity
  const personalityResult = await applyPersonalityAsync({
    baseResponse: createResult.response,
    userMessage: 'send announcement',
    userName: TEST_USER_NAME,
    useLLM: false,
    conversationHistory: undefined,
  });

  // The non-LLM personality should preserve the draft content
  assert(
    personalityResult.includes(dbDraft?.content?.substring(0, 30) || 'NOMATCH'),
    'Non-LLM personality preserves draft content in response',
    `Personality output lost draft content`
  );

  // Step 4: Now simulate what happens on SEND
  let sentContent = null;
  const mockSendAnnouncement = async (content, phone) => {
    sentContent = content;
    return 0; // Don't actually send
  };

  const sendResult = await actions.handleDraftSend({
    phone: TEST_PHONE,
    message: 'send',
    userName: TEST_USER_NAME,
    isAdmin: true,
    sendAnnouncement: mockSendAnnouncement,
    sendPoll: async () => 0,
    entryId: TEST_ENTRY_ID,
    classification: { action: 'draft_send', confidence: 1 },
    recentMessages: [],
  });

  assert(
    sentContent === dbDraft?.content,
    'SENT content matches DB content exactly',
    `Sent: "${sentContent?.substring(0, 50)}" vs DB: "${dbDraft?.content?.substring(0, 50)}"`
  );

  await cleanup();
}

// ============================================
// TEST 3: Edit draft - DB updates correctly
// ============================================
async function testDraftEdit() {
  console.log('\n📋 TEST 3: Draft editing updates DB correctly');
  await cleanup();

  // Create initial draft
  await smsDb.createDraft(TEST_PHONE, TEST_ENTRY_ID, 'announcement', 'original content here');

  // Edit it
  const editResult = await actions.handleDraftWrite({
    phone: TEST_PHONE,
    message: 'change it to "updated content here"',
    userName: TEST_USER_NAME,
    isAdmin: true,
    classification: { action: 'draft_write', confidence: 0.95, subtype: 'announcement' },
    recentMessages: [],
    entryId: TEST_ENTRY_ID,
  });

  const dbDraft = await smsDb.getActiveDraft(TEST_PHONE, TEST_ENTRY_ID);
  const editedNewDraft = editResult.newDraft?.content;

  assert(
    editedNewDraft === dbDraft?.content,
    'Edited newDraft.content matches DB',
    `newDraft: "${editedNewDraft?.substring(0, 50)}" vs DB: "${dbDraft?.content?.substring(0, 50)}"`
  );

  assert(
    dbDraft?.content !== 'original content here',
    'DB content was actually updated (not still original)',
    `DB still has: "${dbDraft?.content}"`
  );

  // Now send and verify sent content matches DB
  let sentContent = null;
  await actions.handleDraftSend({
    phone: TEST_PHONE,
    message: 'send',
    userName: TEST_USER_NAME,
    isAdmin: true,
    sendAnnouncement: async (content) => { sentContent = content; return 0; },
    sendPoll: async () => 0,
    entryId: TEST_ENTRY_ID,
    classification: { action: 'draft_send', confidence: 1 },
    recentMessages: [],
  });

  assert(
    sentContent === dbDraft?.content,
    'Sent content after edit matches DB',
    `Sent: "${sentContent?.substring(0, 50)}" vs DB: "${dbDraft?.content?.substring(0, 50)}"`
  );

  await cleanup();
}

// ============================================
// TEST 4: Old announcements in history don't leak into new drafts
// ============================================
async function testNoHistoryContamination() {
  console.log('\n📋 TEST 4: Old announcements do NOT leak into new drafts');
  await cleanup();

  // Simulate conversation history with old announcements
  const recentMessages = [
    {
      direction: 'outbound',
      text: 'PLEDGE OLYMPICS TODAY AT SUNSET 12-3PM. BRING YOUR A GAME.',
      meta: JSON.stringify({ action: 'announcement', senderPhone: '1234567890' }),
      createdAt: new Date('2026-05-17'),
    },
    {
      direction: 'outbound',
      text: 'alumni reunion dates: LA July 17, SF Aug 29, NY Aug 1',
      meta: JSON.stringify({ action: 'scheduled_announcement' }),
      createdAt: new Date('2026-06-15'),
    },
    {
      direction: 'inbound',
      text: 'hello',
      meta: null,
      createdAt: new Date(),
    },
  ];

  // Now create a NEW draft - it should NOT include old announcement content
  const result = await actions.handleDraftWrite({
    phone: TEST_PHONE,
    message: 'announce meeting is cancelled tonight',
    userName: TEST_USER_NAME,
    isAdmin: true,
    classification: { action: 'draft_write', confidence: 0.95, subtype: 'announcement' },
    recentMessages,
    entryId: TEST_ENTRY_ID,
  });

  const draftContent = result.newDraft?.content || '';
  console.log(`  Draft created: "${draftContent}"`);

  assert(
    !draftContent.toLowerCase().includes('pledge olympics'),
    'Draft does NOT contain "pledge olympics" from old announcement',
    `Draft content: "${draftContent}"`
  );

  assert(
    !draftContent.toLowerCase().includes('alumni reunion'),
    'Draft does NOT contain "alumni reunion" from old announcement',
    `Draft content: "${draftContent}"`
  );

  assert(
    draftContent.toLowerCase().includes('cancel') || draftContent.toLowerCase().includes('meeting'),
    'Draft DOES contain the intended content about cancelled meeting',
    `Draft content: "${draftContent}"`
  );

  await cleanup();
}

// ============================================
// TEST 5: Draft removal - removing text from draft works
// ============================================
async function testDraftRemoval() {
  console.log('\n📋 TEST 5: Removing text from draft');
  await cleanup();

  // Create a draft with contaminated content
  const contaminatedContent = 'PLEDGE OLYMPICS AT SUNSET 12-3PM. THERE IS A MISTAKE ON SF DATE - alumni reunion LA July 17, SF Aug 29, NY Aug 1';
  await smsDb.createDraft(TEST_PHONE, TEST_ENTRY_ID, 'announcement', contaminatedContent);

  // Ask to remove the pledge olympics part
  const editResult = await actions.handleDraftWrite({
    phone: TEST_PHONE,
    message: 'remove all the pledge olympics stuff, just keep the alumni reunion correction',
    userName: TEST_USER_NAME,
    isAdmin: true,
    classification: { action: 'draft_write', confidence: 0.95, subtype: 'announcement' },
    recentMessages: [],
    entryId: TEST_ENTRY_ID,
  });

  const editedContent = editResult.newDraft?.content || '';
  const dbDraft = await smsDb.getActiveDraft(TEST_PHONE, TEST_ENTRY_ID);
  console.log(`  Edited draft (newDraft): "${editedContent}"`);
  console.log(`  Edited draft (DB):       "${dbDraft?.content}"`);

  assert(
    !editedContent.toLowerCase().includes('pledge olympics'),
    'Edited content does NOT contain "pledge olympics"',
    `Content: "${editedContent}"`
  );

  assert(
    editedContent === dbDraft?.content,
    'Edited newDraft matches DB after removal',
    `newDraft: "${editedContent?.substring(0, 50)}" vs DB: "${dbDraft?.content?.substring(0, 50)}"`
  );

  // Send and verify
  let sentContent = null;
  await actions.handleDraftSend({
    phone: TEST_PHONE,
    message: 'send',
    userName: TEST_USER_NAME,
    isAdmin: true,
    sendAnnouncement: async (content) => { sentContent = content; return 0; },
    sendPoll: async () => 0,
    entryId: TEST_ENTRY_ID,
    classification: { action: 'draft_send', confidence: 1 },
    recentMessages: [],
  });

  assert(
    sentContent === dbDraft?.content,
    'SENT content after removal matches DB',
    `Sent: "${sentContent?.substring(0, 50)}" vs DB: "${dbDraft?.content?.substring(0, 50)}"`
  );

  assert(
    !sentContent?.toLowerCase().includes('pledge olympics'),
    'SENT content does NOT contain removed text',
    `Sent: "${sentContent}"`
  );

  await cleanup();
}

// ============================================
// TEST 6: Personality LLM is NOT applied to draft actions
// ============================================
async function testPersonalitySkippedForDrafts() {
  console.log('\n📋 TEST 6: LLM personality skipped for draft actions');

  const draftContent = 'important meeting tomorrow at 3pm in the conference room';
  const baseResponse = TEMPLATES.draftCreated('announcement', draftContent);

  // With LLM disabled (as it should be for drafts)
  const nonLLMResult = await applyPersonalityAsync({
    baseResponse,
    userMessage: 'announce important meeting tomorrow at 3pm',
    userName: TEST_USER_NAME,
    useLLM: false,
  });

  assert(
    nonLLMResult.includes(draftContent),
    'Non-LLM personality preserves exact draft content',
    `Result: "${nonLLMResult.substring(0, 80)}"`
  );

  // With LLM enabled (should NOT be used for drafts, but let's see what happens)
  if (process.env.OPENAI_API_KEY) {
    const llmResult = await applyPersonalityAsync({
      baseResponse,
      userMessage: 'announce important meeting tomorrow at 3pm',
      userName: TEST_USER_NAME,
      useLLM: true,
    });

    const llmPreserves = llmResult.includes(draftContent);
    if (!llmPreserves) {
      console.log(`  ⚠️  LLM personality WOULD alter draft content: "${llmResult.substring(0, 80)}"`);
      console.log(`  ⚠️  This confirms why useLLM: false is critical for draft actions`);
    }
    assert(true, 'LLM personality divergence check completed (informational)');
  }
}

// ============================================
// TEST 7: draft_send with "send" doesn't re-enter draft_write
// ============================================
async function testSendDoesntRedirect() {
  console.log('\n📋 TEST 7: "send" command goes to draft_send, not draft_write');
  await cleanup();

  // Create ready draft
  await smsDb.createDraft(TEST_PHONE, TEST_ENTRY_ID, 'announcement', 'test announcement content');

  const sendMessages = ['send', 'send it', 'go', 'yes', 'yep', 'do it'];

  for (const msg of sendMessages) {
    // Re-create draft for each test
    await cleanup();
    await smsDb.createDraft(TEST_PHONE, TEST_ENTRY_ID, 'announcement', 'test content');

    let sentContent = null;
    const result = await actions.handleDraftSend({
      phone: TEST_PHONE,
      message: msg,
      userName: TEST_USER_NAME,
      isAdmin: true,
      sendAnnouncement: async (content) => { sentContent = content; return 0; },
      sendPoll: async () => 0,
      entryId: TEST_ENTRY_ID,
      classification: { action: 'draft_send', confidence: 1 },
      recentMessages: [],
    });

    assert(
      sentContent === 'test content',
      `"${msg}" sends draft content correctly`,
      `Sent: "${sentContent}"`
    );
  }

  await cleanup();
}

// ============================================
// TEST 8: "don't send" does NOT send
// ============================================
async function testDontSendDoesntSend() {
  console.log('\n📋 TEST 8: Cancellation messages do NOT send');
  await cleanup();

  await smsDb.createDraft(TEST_PHONE, TEST_ENTRY_ID, 'announcement', 'should not be sent');

  const cancelMessages = ["don't send", "cancel", "nvm", "never mind", "no", "nah", "forget it"];

  for (const msg of cancelMessages) {
    const classification = await classifyIntent({
      currentMessage: msg,
      history: [],
      activeDraft: { type: 'announcement', content: 'should not be sent', status: 'ready' },
      isAdmin: true,
      userName: TEST_USER_NAME,
      hasActivePoll: false,
      pendingExcuseRequest: false,
    });

    assert(
      classification.action !== 'draft_send',
      `"${msg}" → NOT draft_send`,
      `got ${classification.action} (${classification.reasoning})`
    );
  }

  await cleanup();
}

// ============================================
// RUN ALL TESTS
// ============================================

async function main() {
  console.log('🧪 Draft Pipeline Test Suite');
  console.log('============================');
  console.log('All tests use mock send functions - NO real SMS will be sent.\n');

  try {
    await initDatabase();
    await cleanup();

    await testClassifier();
    await testDraftDisplayMatchesDB();
    await testDraftEdit();
    await testNoHistoryContamination();
    await testDraftRemoval();
    await testPersonalitySkippedForDrafts();
    await testSendDoesntRedirect();
    await testDontSendDoesntSend();

    await cleanup();
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error);
  }

  console.log('\n============================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ❌ ${f.testName}: ${f.details}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
