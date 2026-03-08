/**
 * Intent Classifier
 * LLM-based classification with weighted conversation context
 * Ported from Jarvis classifier.ts
 */

import OpenAI from 'openai';

// ============================================
// PATTERN-BASED FAST PATH (no LLM needed)
// ============================================

function patternMatch(message, context) {
  const { pendingExcuseRequest, activeDraft } = context;

  // State-machine decisions only — these are not classification, they're deterministic responses to bot state

  // If user has pending excuse request, any message is a poll_response
  if (pendingExcuseRequest) {
    return { action: 'poll_response', confidence: 0.95 };
  }

  // If draft is waiting for mandatory confirmation, yes/no is a draft_write (confirming mandatory status)
  if (activeDraft && activeDraft.pendingMandatory) {
    const lower = message.toLowerCase().trim();
    if (/^(yes|y|yep|yeah|mandatory|required|no|n|nope|nah)$/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.95 };
    }
  }

  // Everything else goes to LLM classification
  return null;
}

// ============================================
// LLM-BASED CLASSIFICATION
// ============================================

function buildClassificationPrompt(context) {
  const { currentMessage, history, activeDraft, isAdmin, userName, hasActivePoll, pendingExcuseRequest } = context;

  let historyContext = '';
  if (history && history.length > 0) {
    historyContext = '\n\nRecent conversation (most recent last, with importance weights):\n';
    for (const turn of history) {
      const roleLabel = turn.role === 'user' ? 'User' : 'Assistant';
      historyContext += `[weight ${turn.weight.toFixed(1)}] ${roleLabel}: ${turn.content}\n`;
    }
  }

  let draftContext = '';
  if (activeDraft) {
    draftContext = `\n\nActive draft:\n- Type: ${activeDraft.type}\n- Status: ${activeDraft.status}\n- Content: "${activeDraft.content || '(empty)'}"\n`;
    if (activeDraft.pendingMandatory) {
      draftContext += `- WAITING FOR MANDATORY CONFIRMATION: Bot asked "should they explain if they say no? (yes/no)"\n`;
      draftContext += `  -> If user says "yes" or "no", this is draft_write (confirming mandatory status), NOT draft_send\n`;
    }
  }

  const pollContext = `\n\nActive poll: ${hasActivePoll ? 'yes' : 'no'}`;
  const excuseContext = pendingExcuseRequest
    ? `\n\nPENDING EXCUSE REQUEST: User previously responded "No" to a mandatory poll without providing an excuse.\n` +
      `  -> The current message should be classified as poll_response (providing the excuse), NOT chat\n`
    : '';

  return `You are classifying the intent of an SMS message to an AI assistant for a page/organization.

User info:
- Name: ${userName || 'Unknown'}
- Is admin: ${isAdmin}
${historyContext}${draftContext}${pollContext}${excuseContext}

Current message: "${currentMessage}"

Classify this message into ONE of these actions:

1. **draft_write** - Creating or editing announcement/poll content. The message contains ACTUAL CONTENT to announce or poll about (e.g. "announce meeting at 5pm", "poll: are you coming?", "tell everyone party is at 8").
2. **draft_send** - Explicitly confirming to SEND a ready draft. User is saying YES, GO, SEND. Must be clearly affirmative with no hesitation.
3. **poll_response** - Responding to an active poll (yes/no/maybe with optional notes).
4. **content_query** - Asking about page content, events, deadlines, or following up on something the bot said. Includes vague follow-up questions like "what work?", "submit what?", "what form?", "tell me more", "what do you mean?".
5. **capability_query** - Asking what the bot can do or how to use features (e.g. "how do I make an announcement?").
6. **chat** - Everything else: casual conversation, banter, greetings, AND cancelling/rejecting drafts.

DRAFT HANDLING — THIS IS THE MOST IMPORTANT SECTION:
${activeDraft ? `There is currently an ACTIVE DRAFT. Pay very careful attention to whether the user wants to SEND it or CANCEL/REJECT it.` : 'There is no active draft.'}

- draft_send = user WANTS to send. Must be clearly, unambiguously affirmative: "send", "send it", "go", "yes", "yep", "do it", "ship it", "fire away"
- chat = user wants to CANCEL, REJECT, or STOP the draft. Any negativity, hesitation, or rejection means DO NOT SEND:
  "don't send" = chat (CANCEL). This is the OPPOSITE of "send".
  "no" / "nah" / "nope" / "cancel" / "stop" / "nvm" / "never mind" / "forget it" / "delete it" / "scratch that" / "actually no" / "wait no" = chat (CANCEL)
- Think about the SEMANTIC MEANING. "don't send" contains the word "send" but the meaning is NEGATIVE — do NOT send. Always prioritize meaning over individual words.
- When in doubt between draft_send and chat, choose chat. A false cancel is easily fixed; a false send goes to all members and CANNOT be undone.
- draft_write = user is EDITING the draft content (e.g. "wait, say X instead", "change it to Y", "actually make it about Z")

OTHER RULES:
- "How do I make an announcement" = capability_query (asking for help, no content)
- "Announce: meeting at 5pm" = draft_write (has actual content)
- "tell me about X", "what is X", "when is X" = content_query
- Short vague follow-up questions ("what work?", "submit what?", "what form?", "huh?", "what do you mean?", "tell me more", "what was that about?") = content_query (user is asking about something the bot just said)
- Use conversation history to understand context (higher weight = more recent/relevant)

Respond with JSON only:
{
  "action": "draft_write" | "draft_send" | "poll_response" | "content_query" | "capability_query" | "chat",
  "confidence": 0.0-1.0,
  "subtype": "announcement" | "poll" | null,
  "reasoning": "brief explanation"
}`;
}

async function callLLMClassifier(prompt) {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a precise intent classifier. Always respond with valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    if (!content) {
      return { action: 'chat', confidence: 0.5, reasoning: 'LLM returned empty response' };
    }

    const json = JSON.parse(content);
    return {
      action: json.action || 'chat',
      confidence: json.confidence || 0.5,
      subtype: json.subtype || undefined,
      reasoning: json.reasoning || 'LLM classification'
    };
  } catch (error) {
    console.error('[Classifier] LLM classification error:', error);
    return { action: 'chat', confidence: 0.5, reasoning: `LLM error: ${error.message}` };
  }
}

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

export async function classifyIntent(context) {
  const { currentMessage } = context;

  const patternResult = patternMatch(currentMessage, context);
  if (patternResult && patternResult.confidence >= 0.95) {
    return {
      action: patternResult.action,
      confidence: patternResult.confidence,
      subtype: patternResult.subtype,
      reasoning: 'Explicit command match'
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return { action: 'chat', confidence: 0.5, reasoning: 'No OpenAI API key' };
  }

  const prompt = buildClassificationPrompt(context);
  return await callLLMClassifier(prompt);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function extractContent(message, type) {
  let content = message.trim();

  const editPatterns = [
    /^(wait|no|nah|nvm),?\s+(just\s+)?say\s+/i,
    /^(wait|no|nah|actually),?\s+/i,
    /^just\s+say\s+/i,
    /^make\s+it\s+(say|be)\s+/i,
    /^change\s+it\s+to\s+/i,
    /^(it\s+should\s+say|it\s+should\s+be)\s+/i
  ];

  for (const pattern of editPatterns) {
    content = content.replace(pattern, '');
  }

  if (type === 'announcement') {
    content = content.replace(/^announce(ment)?\s+(saying|that)\s+/i, '');
    content = content.replace(/^(send|make|create)(\s+out)?\s+(an?\s+)?announcement\s+(saying|that)\s+/i, '');
    content = content.replace(/^(send|make|create)(\s+out)?\s+(an?\s+)?announcement\s+/i, '');
    content = content.replace(/^(tell|notify|let)\s+(everyone|people|all|the group|everybody)\s*(about|that)?\s*/i, '');
  } else if (type === 'poll') {
    content = content.replace(/^poll\s+(asking|saying)?\s*/i, '');
    content = content.replace(/^(send|make|create|start)(\s+out)?\s+(a\s+)?poll\s+(asking|saying)?\s*/i, '');
    content = content.replace(/^(ask|asking)\s+(everyone|people|all|the group|everybody)\s*(if|whether|about)?\s*/i, '');
    if (!content.endsWith('?')) content += '?';
  }

  return content.trim();
}
