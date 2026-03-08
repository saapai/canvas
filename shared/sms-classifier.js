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
  const lower = message.toLowerCase().trim();
  const { activeDraft, pendingExcuseRequest } = context;

  // If user has pending excuse request, any message is a poll_response
  if (pendingExcuseRequest) {
    return { action: 'poll_response', confidence: 0.95 };
  }

  // "Announce this: X" / "Announce: X" — always draft_write (creating new content)
  if (/^announce\s*(this)?[\s:]+\S/i.test(lower)) {
    return { action: 'draft_write', confidence: 0.95, subtype: 'announcement' };
  }

  // Cancel/don't send draft — MUST check BEFORE send commands to prevent "don't send" from being sent
  if (activeDraft) {
    if (/\b(don'?t|do not|no|cancel|nvm|nevermind|never mind|delete|discard|forget|scratch|stop|nah|nope)\b/i.test(lower)) {
      return { action: 'chat', confidence: 0.95 };  // chat handler has draft cancellation logic
    }
  }

  // ONLY match explicit send commands when draft is ready AND not waiting for mandatory confirmation
  if (activeDraft && activeDraft.status === 'ready' && !activeDraft.pendingMandatory) {
    if (/^(send|send it|go|yes|yep)$/i.test(lower)) {
      return { action: 'draft_send', confidence: 0.95 };
    }
  }

  // If draft is waiting for mandatory confirmation, "yes" should be draft_write, not draft_send
  if (activeDraft && activeDraft.pendingMandatory) {
    if (/^(yes|y|yep|yeah|mandatory|required|no|n|nope|nah)$/i.test(lower)) {
      return { action: 'draft_write', confidence: 0.95 };
    }
  }

  // Follow-up questions about bot's previous messages → content_query
  // These are questions like "what work?", "submit what?", "what form?", "what do you mean?"
  if (/\b(what work|what form|submit what|what do you mean|tell me more|what are you talking|what was that|which form|what thing|what stuff|what assignment|explain|elaborate|what deadline|what event)\b/i.test(lower)) {
    return { action: 'content_query', confidence: 0.90 };
  }

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

1. **draft_write** - Actually creating or editing announcement/poll content (e.g. "announce meeting at 5pm", "poll: are you coming?")
2. **draft_send** - ONLY explicit send confirmations when draft is ready
3. **poll_response** - Responding to an active poll (yes/no/maybe with optional notes)
4. **content_query** - Questions about page content (events, info, etc.)
5. **capability_query** - Questions about what the bot can do or how to use features
6. **chat** - Everything else (casual conversation, banter, greetings)

CRITICAL DISTINCTIONS:
- "How do I make an announcement" / "How do I send a poll" = capability_query (asking for help)
- "Announce: meeting at 5pm" / "Make an announcement saying X" = draft_write (has actual content to send)
- draft_write requires actual MESSAGE CONTENT to send. If the user is just asking HOW to do it, that's capability_query.
- Pay attention to conversation history
- Words like "wait", "no", "actually", "instead" signal draft edits
- Questions like "tell me about X", "what is X" are ALWAYS content_query
- Use the weighted history (higher weight = more recent/relevant)

DRAFT CANCELLATION — CRITICAL:
- If there is an active draft and the user says ANYTHING negative, hesitant, or cancelling, classify as "chat" (NOT draft_send). The chat handler will cancel the draft.
- Examples: "don't send", "no don't", "wait no", "nah", "cancel", "stop", "actually no", "don't send that" = chat
- "don't send" is the OPPOSITE of "send" — it must NEVER be classified as draft_send
- Only classify as draft_send for CLEARLY AFFIRMATIVE send commands: "send", "send it", "go", "yes", "yep"

FOLLOW-UP QUESTIONS:
- If the user asks short vague questions like "what work?", "submit what?", "what form?", "what do you mean?", "tell me more" — these are content_query (asking about something the bot recently said)
- These are NOT casual chat — the user wants specific information

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
      temperature: 0.3,
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
