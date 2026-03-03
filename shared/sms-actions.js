/**
 * SMS Action Handlers
 * Handles all classified intents: draft_write, draft_send, poll_response, content_query, capability_query, chat
 * Ported from Jarvis actions/ directory
 */

import OpenAI from 'openai';
import * as smsDb from './sms-db.js';
import { extractContent } from './sms-classifier.js';
import { applyPersonality, getQuickResponse, TEMPLATES } from './sms-personality.js';

// ============================================
// DRAFT WRITE
// ============================================

async function formatPollQuestion(rawQuestion) {
  if (!process.env.OPENAI_API_KEY) return rawQuestion;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Format poll questions for SMS. Turn raw input into clear yes/no question. Keep concise. Return ONLY the formatted question.` },
        { role: 'user', content: `Format: "${rawQuestion}"` }
      ],
      temperature: 0.2,
      max_tokens: 80
    });
    return response.choices[0].message.content?.trim() || rawQuestion;
  } catch (error) {
    console.error('[PollFormat] LLM failed:', error);
    return rawQuestion;
  }
}

async function detectLinks(message) {
  if (!process.env.OPENAI_API_KEY) return { hasLinks: false, links: [], needsLink: false };
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Analyze if message contains URLs and if it SHOULD have a link (RSVP, form, survey, registration). Only needsLink=true if explicitly link-related language. Respond with JSON: { "hasLinks": boolean, "links": string[], "needsLink": boolean }` },
        { role: 'user', content: `Analyze: "${message}"` }
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return { hasLinks: parsed.hasLinks || false, links: parsed.links || [], needsLink: parsed.needsLink || false };
  } catch (error) {
    return { hasLinks: false, links: [], needsLink: false };
  }
}

async function detectLinkDecline(message) {
  if (!process.env.OPENAI_API_KEY) return { isDeclining: false };
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Detect if user is declining to provide a link (no, skip, none, just send it, etc). Respond with JSON: { "isDeclining": boolean }` },
        { role: 'user', content: `Is user declining? "${message}"` }
      ],
      temperature: 0.1,
      max_tokens: 50,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    return { isDeclining: parsed.isDeclining || false };
  } catch (error) {
    return { isDeclining: false };
  }
}

async function resolveDraftContent({ message, draftType, previousContent, recentMessages }) {
  if (!process.env.OPENAI_API_KEY) return extractContent(message, draftType);

  const history = (recentMessages || []).slice(-6).map(m => ({
    role: m.direction === 'inbound' ? 'User' : 'Bot',
    text: m.text
  }));

  const systemPrompt = `You are extracting the exact message content to send as a ${draftType}.

RULES:
1. VERBATIM: "send out [type] saying X" -> X is exactly what to send
2. FOLLOW-UPS: "wait", "no", "actually" = EDITING, extract only new content
3. NO META LANGUAGE: Never include "Send out an announcement" in output
4. EDITING: "wait say X" -> "X", "no just say X" -> "X"

Return ONLY the exact text to send. No quotes, no explanations.`;

  const historyText = history.length > 0 ? history.map(h => `${h.role}: ${h.text}`).join('\n') : '(no history)';

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Recent conversation:\n${historyText}\n\nCurrent: "${message}"\n${previousContent ? `Previous draft: "${previousContent}"` : ''}\n\nExtract text to send:` }
      ],
      temperature: 0.1,
      max_tokens: 120
    });

    const content = completion.choices[0].message.content?.trim() || '';
    if (!content) return extractContent(message, draftType);
    return formatContent(content, draftType);
  } catch (error) {
    return extractContent(message, draftType);
  }
}

function isJustCommand(message, type) {
  const lower = message.toLowerCase().trim();
  if (type === 'announcement') return /^(announce|announcement|make an announcement|send an announcement|create an announcement)$/i.test(lower);
  return /^(poll|make a poll|send a poll|create a poll|start a poll)$/i.test(lower);
}

function formatContent(content, type) {
  let formatted = content.trim();
  if (type === 'poll') {
    if (!formatted.endsWith('?')) formatted += '?';
    formatted = formatted.replace(/\?\?+/g, '?');
  }
  return formatted;
}

export async function handleDraftWrite({ phone, message, userName, isAdmin, classification, recentMessages, entryId }) {
  const draftType = classification.subtype || 'announcement';
  const existingDraft = await smsDb.getActiveDraft(phone, entryId);

  // Case 1: No existing draft
  if (!existingDraft) {
    const content = await resolveDraftContent({ message, draftType, recentMessages });

    if (content.length < 5 || isJustCommand(message, draftType)) {
      await smsDb.createDraft(phone, entryId, draftType, '');
      return {
        action: 'draft_write',
        response: applyPersonality({ baseResponse: TEMPLATES.askForContent(draftType), userMessage: message, userName }),
        newDraft: { type: draftType, content: '', status: 'drafting' }
      };
    }

    let formattedContent = formatContent(content, draftType);
    if (draftType === 'poll') formattedContent = await formatPollQuestion(formattedContent);

    if (draftType === 'announcement') {
      const linkAnalysis = await detectLinks(formattedContent);
      if (linkAnalysis.needsLink && !linkAnalysis.hasLinks) {
        await smsDb.createDraft(phone, entryId, draftType, formattedContent, { pendingLink: true });
        return {
          action: 'draft_write',
          response: applyPersonality({ baseResponse: `got it, but this looks like it needs a link (RSVP, form, etc.). send me the link`, userMessage: message, userName }),
          newDraft: { type: draftType, content: formattedContent, status: 'drafting', pendingLink: true }
        };
      }
    }

    if (draftType === 'poll') {
      await smsDb.createDraft(phone, entryId, draftType, formattedContent, { pendingMandatory: true, requiresExcuse: false });
      return {
        action: 'draft_write',
        response: applyPersonality({ baseResponse: `here's the poll:\n\n"${formattedContent}"\n\nshould people need to give an excuse if they say no? (yes/no)`, userMessage: message, userName }),
        newDraft: { type: draftType, content: formattedContent, status: 'drafting', pendingMandatory: true }
      };
    }

    await smsDb.createDraft(phone, entryId, draftType, formattedContent, { requiresExcuse: false });
    return {
      action: 'draft_write',
      response: applyPersonality({ baseResponse: TEMPLATES.draftCreated(draftType, formattedContent), userMessage: message, userName }),
      newDraft: { type: draftType, content: formattedContent, status: 'ready' }
    };
  }

  // Case 2a: Poll waiting for mandatory confirmation
  if (existingDraft.pendingMandatory && existingDraft.type === 'poll') {
    const lowerMsg = message.toLowerCase().trim();
    const requiresExcuse = /\b(yes|y|yep|yeah|mandatory|required)\b/i.test(lowerMsg);
    await smsDb.updateDraftByPhone(phone, {
      draftText: existingDraft.content,
      structuredPayload: { type: 'poll', requiresExcuse, pendingMandatory: false }
    }, entryId);

    const excuseNote = requiresExcuse ? ' (mandatory - excuses required for "no")' : '';
    return {
      action: 'draft_write',
      response: applyPersonality({ baseResponse: `got it! here's the poll:\n\n"${existingDraft.content}"${excuseNote}\n\nsay "send" when ready`, userMessage: message, userName }),
      newDraft: { ...existingDraft, status: 'ready', requiresExcuse, pendingMandatory: false }
    };
  }

  // Case 2b: Waiting for link
  if (existingDraft.pendingLink) {
    const declineCheck = await detectLinkDecline(message);
    if (declineCheck.isDeclining) {
      await smsDb.updateDraftByPhone(phone, {
        draftText: existingDraft.content,
        structuredPayload: { type: existingDraft.type, links: [], requiresExcuse: false }
      }, entryId);
      return {
        action: 'draft_write',
        response: applyPersonality({ baseResponse: `got it! here's the ${existingDraft.type}:\n\n"${existingDraft.content}"\n\nsay "send" when ready`, userMessage: message, userName }),
        newDraft: { ...existingDraft, status: 'ready', pendingLink: false }
      };
    }
    const linkAnalysis = await detectLinks(message);
    if (linkAnalysis.hasLinks && linkAnalysis.links.length > 0) {
      const updatedContent = `${existingDraft.content}\n\n${linkAnalysis.links.join('\n')}`;
      await smsDb.updateDraftByPhone(phone, { draftText: updatedContent }, entryId);
      return {
        action: 'draft_write',
        response: applyPersonality({ baseResponse: `perfect! here's the ${existingDraft.type} with the link:\n\n"${updatedContent}"\n\nsay "send" when ready`, userMessage: message, userName }),
        newDraft: { ...existingDraft, content: updatedContent, status: 'ready', pendingLink: false, links: linkAnalysis.links }
      };
    }
    return {
      action: 'draft_write',
      response: applyPersonality({ baseResponse: "didn't catch a link there. send me the URL", userMessage: message, userName })
    };
  }

  // Case 2c: Draft waiting for content
  if (existingDraft.status === 'drafting' && !existingDraft.content) {
    const content = formatContent(await resolveDraftContent({ message, draftType: existingDraft.type, recentMessages }), existingDraft.type);
    await smsDb.updateDraftByPhone(phone, { draftText: content }, entryId);
    return {
      action: 'draft_write',
      response: applyPersonality({ baseResponse: TEMPLATES.draftCreated(existingDraft.type, content), userMessage: message, userName }),
      newDraft: { ...existingDraft, content, status: 'ready' }
    };
  }

  // Case 2d: Draft ready - user is editing
  if (existingDraft.status === 'ready') {
    const editedContent = await resolveDraftContent({ message, draftType: existingDraft.type, previousContent: existingDraft.content, recentMessages });
    await smsDb.updateDraftByPhone(phone, { draftText: editedContent }, entryId);
    return {
      action: 'draft_write',
      response: applyPersonality({ baseResponse: TEMPLATES.draftUpdated(editedContent), userMessage: message, userName }),
      newDraft: { ...existingDraft, content: editedContent }
    };
  }

  return { action: 'draft_write', response: applyPersonality({ baseResponse: TEMPLATES.confused(), userMessage: message, userName }) };
}

// ============================================
// DRAFT SEND
// ============================================

export async function handleDraftSend({ phone, message, userName, isAdmin, sendAnnouncement, sendPoll, entryId }) {
  const draft = await smsDb.getActiveDraft(phone, entryId);

  if (!draft) {
    return { action: 'draft_send', response: applyPersonality({ baseResponse: TEMPLATES.noDraft(), userMessage: message, userName }) };
  }

  if (!draft.content || draft.content.length < 3) {
    return { action: 'draft_send', response: applyPersonality({ baseResponse: TEMPLATES.askForContent(draft.type), userMessage: message, userName }) };
  }

  try {
    let sentCount;
    if (draft.type === 'announcement') {
      sentCount = await sendAnnouncement(draft.content, phone);
    } else {
      sentCount = await sendPoll(draft.content, phone, draft.requiresExcuse);
    }

    await smsDb.finalizeDraft(phone, entryId);
    return {
      action: 'draft_send',
      response: applyPersonality({ baseResponse: TEMPLATES.draftSent(sentCount), userMessage: message, userName }),
      newDraft: undefined
    };
  } catch (error) {
    console.error('[Send] Failed:', error);
    return { action: 'draft_send', response: applyPersonality({ baseResponse: `failed to send. try again?`, userMessage: message, userName }) };
  }
}

// ============================================
// POLL RESPONSE
// ============================================

async function parsePollResponse(message) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: `Parse poll response as Yes/No/Maybe with optional notes. Return JSON: { "response": "Yes"|"No"|"Maybe", "notes": string|null }` },
          { role: 'user', content: `Parse: "${message}"` }
        ],
        temperature: 0.1,
        max_tokens: 100,
        response_format: { type: 'json_object' }
      });
      const parsed = JSON.parse(completion.choices[0].message.content);
      return { response: parsed.response, notes: parsed.notes || null };
    } catch (error) {
      console.error('[PollParser] LLM failed:', error);
    }
  }

  // Fallback
  const lower = message.toLowerCase().trim();
  if (/^(y|yes|yep|yup|yeah|yea|sure|ok|okay)$/i.test(lower)) return { response: 'Yes', notes: null };
  if (/^(n|no|nah|nope)$/i.test(lower)) return { response: 'No', notes: null };
  if (/^(maybe|perhaps|possibly|idk|not sure)$/i.test(lower)) return { response: 'Maybe', notes: null };
  if (/\b(can'?t|cannot|won'?t|no|nope|busy|unavailable)\b/i.test(lower)) return { response: 'No', notes: message.trim() };
  if (/\b(yes|yep|coming|going|i'?ll be there|count me in)\b/i.test(lower)) return { response: 'Yes', notes: message.trim() };
  return { response: 'Maybe', notes: message.trim() };
}

export async function handlePollResponse({ phone, message, userName, entryId }) {
  const activePoll = await smsDb.getActivePoll(entryId);

  if (!activePoll) {
    return { action: 'chat', response: applyPersonality({ baseResponse: 'no active poll right now', userMessage: message, userName }) };
  }

  const parsed = await parsePollResponse(message);

  // Check if user has pending excuse (No without notes)
  if (activePoll.requires_reason_for_no) {
    const existingResponse = await smsDb.getPollResponse(activePoll.id, phone);
    if (existingResponse && existingResponse.response === 'No' && !existingResponse.notes) {
      if (parsed.response === 'Yes' || parsed.response === 'Maybe') {
        await smsDb.savePollResponse(activePoll.id, phone, parsed.response, parsed.notes);
        let msg = `got it! recorded: ${parsed.response}`;
        if (parsed.notes) msg += ` (note: "${parsed.notes}")`;
        return { action: 'poll_response', response: applyPersonality({ baseResponse: msg, userMessage: message, userName }) };
      }
      // Treat as excuse
      await smsDb.savePollResponse(activePoll.id, phone, 'No', message);
      return { action: 'poll_response', response: applyPersonality({ baseResponse: `got it! recorded: No (note: "${message}")`, userMessage: message, userName }) };
    }
  }

  // Enforce excuse for mandatory poll "No"
  if (activePoll.requires_reason_for_no && parsed.response === 'No' && !parsed.notes) {
    await smsDb.savePollResponse(activePoll.id, phone, 'No', null);
    return { action: 'poll_response', response: applyPersonality({ baseResponse: "this event is mandatory - can you tell me why you can't make it?", userMessage: message, userName }) };
  }

  await smsDb.savePollResponse(activePoll.id, phone, parsed.response, parsed.notes);
  let confirmationMsg = `got it! recorded: ${parsed.response}`;
  if (parsed.notes) confirmationMsg += ` (note: "${parsed.notes}")`;
  return { action: 'poll_response', response: applyPersonality({ baseResponse: confirmationMsg, userMessage: message, userName }) };
}

// ============================================
// CONTENT QUERY
// ============================================

export async function handleContentQuery({ phone, message, userName, entryId }) {
  if (!process.env.OPENAI_API_KEY) {
    return { action: 'content_query', response: applyPersonality({ baseResponse: "can't search right now. try again later?", userMessage: message, userName }) };
  }

  try {
    // Fetch page entries as context
    const { getPool } = await import('./db.js');
    const db = getPool();
    const result = await db.query(
      `SELECT text, text_html, created_at FROM entries
       WHERE parent_entry_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 50`,
      [entryId]
    );

    const entriesContext = result.rows.map(r => r.text).filter(Boolean).join('\n---\n');

    // Also get past announcements/polls
    const pastActions = await smsDb.getPastActions(entryId, 10);
    const actionsContext = pastActions.map(a => `[${a.type}] ${a.content}`).join('\n');

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `You are answering questions about a page/organization based on its content. Be concise, SMS-friendly. If info not found, say so.\n\nPage entries:\n${entriesContext}\n\nRecent announcements/polls:\n${actionsContext}` },
        { role: 'user', content: message }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    const answer = response.choices[0].message.content || "couldn't find anything about that";
    return { action: 'content_query', response: answer };
  } catch (error) {
    console.error('[ContentQuery] Error:', error);
    return { action: 'content_query', response: applyPersonality({ baseResponse: "had trouble searching. try again?", userMessage: message, userName }) };
  }
}

// ============================================
// CAPABILITY QUERY
// ============================================

export function handleCapabilityQuery({ phone, message, userName, isAdmin }) {
  // Easter eggs
  const easterEggs = {
    'meaning of life': ['42', '42. obviously.'],
    'tell me a joke': ['why do programmers prefer dark mode? because light attracts bugs'],
    'i love you': ["ok weird but thanks i guess", "i'm a bot bestie. but thanks"],
    'good morning': ['morning. sup', 'is it? anyway what do you need'],
    'good night': ['night', 'sleep tight'],
    'how are you': ["functioning within normal parameters", "i'm a bot so... fine i guess"]
  };

  const lower = message.toLowerCase();
  for (const [trigger, responses] of Object.entries(easterEggs)) {
    if (lower.includes(trigger)) {
      return { action: 'capability_query', response: responses[Math.floor(Math.random() * responses.length)] };
    }
  }

  return {
    action: 'capability_query',
    response: applyPersonality({ baseResponse: TEMPLATES.capabilities(isAdmin), userMessage: message, userName })
  };
}

// ============================================
// CHAT
// ============================================

export async function handleChat({ phone, message, userName, isAdmin, entryId }) {
  const lower = message.toLowerCase().trim();

  // Draft cancellation
  if (/^(cancel|nvm|nevermind|never mind|delete|discard|forget it|scratch that)$/i.test(lower)) {
    const draft = await smsDb.getActiveDraft(phone, entryId);
    if (draft) {
      await smsDb.deleteDraft(phone, entryId);
      return { action: 'chat', response: applyPersonality({ baseResponse: TEMPLATES.draftCancelled(), userMessage: message, userName }) };
    }
  }

  // Quick responses
  const quickResponse = getQuickResponse(message);
  if (quickResponse) return { action: 'chat', response: quickResponse };

  // Greeting
  if (/^(hi|hey|hello|yo|sup|what'?s up|wassup|hola|heyo)$/i.test(lower)) {
    const greetings = [`sup ${userName || 'you'}`, `hey ${userName || 'there'}. what's up`, `yo. need something?`, `hey hey`];
    return { action: 'chat', response: greetings[Math.floor(Math.random() * greetings.length)] };
  }

  // Goodbye
  if (/^(bye|goodbye|later|peace|cya|see ya|ttyl|gtg)$/i.test(lower)) {
    const goodbyes = ['later', 'peace', 'bye', 'k bye', 'ttyl'];
    return { action: 'chat', response: goodbyes[Math.floor(Math.random() * goodbyes.length)] };
  }

  // Thank you
  if (/\b(thanks|thank you|thx|ty|appreciate)\b/i.test(lower)) {
    const thanks = ["yeah yeah you're welcome", "np", "sure thing", "don't mention it. seriously"];
    return { action: 'chat', response: thanks[Math.floor(Math.random() * thanks.length)] };
  }

  // Apology
  if (/^(sorry|my bad|mb|oops|apologies)$/i.test(lower) || /\b(i'?m sorry|my apologies)\b/i.test(lower)) {
    return { action: 'chat', response: ['all good', "you're fine", 'it happens', 'np'][Math.floor(Math.random() * 4)] };
  }

  // Check for active draft reminder
  const draft = await smsDb.getActiveDraft(phone, entryId);
  if (draft && draft.status === 'ready') {
    return {
      action: 'chat',
      response: applyPersonality({ baseResponse: `btw you still have a ${draft.type} draft:\n\n"${draft.content}"\n\nwanna send it or nah?`, userMessage: message, userName })
    };
  }

  const confusedResponses = ["not sure what you mean. need help?", "huh? try again", "didn't get that. what do you need?"];
  return { action: 'chat', response: applyPersonality({ baseResponse: confusedResponses[Math.floor(Math.random() * confusedResponses.length)], userMessage: message, userName }) };
}
