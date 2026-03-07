/**
 * SMS Pipeline Orchestrator
 * Twilio webhook handler, SMS sending, TwiML, main message routing
 * Ported from Jarvis route.ts + twilio.ts
 */

import twilio from 'twilio';
import OpenAI from 'openai';
import * as smsDb from './sms-db.js';
import { classifyIntent } from './sms-classifier.js';
import { applyPersonalityAsync } from './sms-personality.js';
import { buildWeightedHistoryFromMessages } from './sms-history.js';
import * as actions from './sms-actions.js';

// ============================================
// TWILIO HELPERS
// ============================================

let _twilioClient = null;

function getTwilioClient() {
  if (!_twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) return null;
    _twilioClient = twilio(accountSid, authToken);
  }
  return _twilioClient;
}

export function validateTwilioSignature(signature, url, params) {
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  return twilio.validateRequest(authToken, signature, url, params);
}

export async function sendSms(to, body) {
  try {
    const client = getTwilioClient();
    if (!client) return { ok: false, error: 'Twilio not configured' };
    const fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
    const message = await client.messages.create({
      body,
      from: fromNumber,
      to: to.startsWith('+') ? to : `+1${to}`
    });
    return { ok: true, sid: message.sid };
  } catch (error) {
    console.error('Failed to send SMS:', error);
    return { ok: false, error: String(error) };
  }
}

export function toTwiml(messages) {
  const allMessages = messages.flatMap(msg => splitLongMessage(msg, 1600));

  if (allMessages.length === 1) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(allMessages[0])}</Message>
</Response>`;
  }

  const messageXml = allMessages.map(msg => `  <Message>${escapeXml(msg)}</Message>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${messageXml}
</Response>`;
}

function splitLongMessage(message, maxLength = 1600) {
  if (message.length <= maxLength) return [message];
  const result = [];
  let remaining = message;
  while (remaining.length > maxLength) {
    const searchText = remaining.substring(0, maxLength);
    const boundaries = [searchText.lastIndexOf('. '), searchText.lastIndexOf('? '), searchText.lastIndexOf('! '), searchText.lastIndexOf('\n')]
      .filter(b => b >= maxLength * 0.5);
    const splitAt = boundaries.length > 0 ? Math.max(...boundaries) + 1 : maxLength;
    result.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ============================================
// NAME EXTRACTION (for onboarding)
// ============================================

async function extractName(message) {
  const text = message.trim();
  if (text.length > 100 || text.length < 2) return null;
  if (/^(yes|no|maybe|\d+|stop|help|start|announce|poll|reset)$/i.test(text.toLowerCase())) return null;
  if (/^(hi|hello|hey|yo|sup|what'?s up|wassup|hola|heyo)$/i.test(text.toLowerCase())) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Extract a person's name from the message. Return ONLY the name or "NOT_A_NAME".` },
        { role: 'user', content: `Message: "${text}"\n\nExtract the name or return NOT_A_NAME:` }
      ],
      temperature: 0.3,
      max_tokens: 20
    });

    const result = response.choices[0]?.message?.content?.trim() || null;
    if (!result || result === 'NOT_A_NAME' || result.toLowerCase() === 'not a name') return null;
    const cleaned = result.replace(/[!.?,;:]+$/, '').trim();
    if (cleaned.length < 2 || cleaned.length > 50) return null;
    return cleaned.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  } catch (error) {
    console.error('[extractName] LLM error:', error);
    return null;
  }
}

// ============================================
// MAIN MESSAGE HANDLER
// ============================================

export async function handleIncomingSms(phone, message) {
  const normalizedPhone = smsDb.normalizePhone(phone);
  const msg = message.trim();

  console.log(`[SMS] ${normalizedPhone}: ${msg}`);

  // 0. Check for space/page commands (JOIN, PAGES)
  const pageCommandResponse = await handlePageCommand(normalizedPhone, msg);
  if (pageCommandResponse) {
    await smsDb.logMessage(null, normalizedPhone, 'outbound', pageCommandResponse, { action: 'page_command' });
    return pageCommandResponse;
  }

  // 1. Get active page (entry) for this user
  let activeEntryId = await smsDb.getActiveEntryId(normalizedPhone);

  // 1b. Log inbound message
  await smsDb.logMessage(activeEntryId, normalizedPhone, 'inbound', msg);

  // 2. Get member from active page
  let member = null;
  if (activeEntryId) {
    member = await smsDb.getMemberByPhone(activeEntryId, normalizedPhone);
  }

  // If no member found and no active page, check if user has any memberships
  if (!member && !activeEntryId) {
    const memberships = await smsDb.getMembershipsByPhone(normalizedPhone);
    if (memberships.length === 0) {
      return "hey! text JOIN <code> to join a page. ask your admin for the code.";
    }
    if (memberships.length === 1) {
      activeEntryId = memberships[0].entry_id;
      await smsDb.setActiveEntryId(normalizedPhone, activeEntryId);
      member = await smsDb.getMemberByPhone(activeEntryId, normalizedPhone);
    } else {
      // Multiple memberships, ask which page
      const pageList = memberships.map(m => `• ${m.entry_text || 'unnamed'} - JOIN ${m.sms_join_code || '?'}`).join('\n');
      return `you're in multiple pages:\n${pageList}\n\ntext JOIN <code> to switch`;
    }
  }

  if (!member && activeEntryId) {
    // User has active page but isn't a member (shouldn't happen, but handle it)
    return "hey! you're not a member of this page. text JOIN <code> to join one.";
  }

  if (!member) {
    return "hey! couldn't find your account. text JOIN <code> to join a page.";
  }

  // 3. Handle system commands (STOP, START, HELP)
  const systemResponse = await handleSystemCommand(member, msg, activeEntryId);
  if (systemResponse) {
    await smsDb.logMessage(activeEntryId, normalizedPhone, 'outbound', systemResponse, { action: 'system_command' });
    return systemResponse;
  }

  // 4. Handle onboarding (name collection)
  if (!member.name) {
    const onboardingResponse = await handleOnboarding(normalizedPhone, msg, member, activeEntryId);
    await smsDb.logMessage(activeEntryId, normalizedPhone, 'outbound', onboardingResponse, { action: 'onboarding' });
    return onboardingResponse;
  }

  // 5. Load conversation context
  const recentMessages = await smsDb.getRecentMessages(normalizedPhone, 10, activeEntryId);
  const history = buildWeightedHistoryFromMessages(recentMessages);
  const activeDraft = await smsDb.getActiveDraft(normalizedPhone, activeEntryId);
  const activePoll = await smsDb.getActivePoll(activeEntryId);

  let pendingExcuseRequest = false;
  if (activePoll && activePoll.requires_reason_for_no) {
    const existingResponse = await smsDb.getPollResponse(activePoll.id, normalizedPhone);
    if (existingResponse && existingResponse.response === 'No' && !existingResponse.notes) {
      pendingExcuseRequest = true;
    }
  }

  // 6. Classify intent
  const isAdminUser = await smsDb.isAdmin(activeEntryId, normalizedPhone);
  const context = {
    currentMessage: msg,
    history,
    activeDraft,
    isAdmin: isAdminUser,
    userName: member.name,
    hasActivePoll: Boolean(activePoll),
    pendingExcuseRequest
  };

  const classification = await classifyIntent(context);
  console.log(`[Classification] ${classification.action} (${classification.confidence.toFixed(2)}) - ${classification.reasoning}`);

  // 7. Route to handler
  let actionResult;

  switch (classification.action) {
    case 'draft_write':
      actionResult = await actions.handleDraftWrite({
        phone: normalizedPhone, message: msg, userName: member.name, isAdmin: isAdminUser,
        classification, recentMessages, entryId: activeEntryId
      });
      break;

    case 'draft_send':
      actionResult = await actions.handleDraftSend({
        phone: normalizedPhone, message: msg, userName: member.name, isAdmin: isAdminUser,
        sendAnnouncement: (content, sender) => sendAnnouncementToAll(content, sender, activeEntryId),
        sendPoll: (question, sender, requiresExcuse) => sendPollToAll(question, sender, requiresExcuse, activeEntryId),
        entryId: activeEntryId, classification, recentMessages
      });
      break;

    case 'content_query':
      actionResult = await actions.handleContentQuery({
        phone: normalizedPhone, message: msg, userName: member.name, entryId: activeEntryId, recentMessages
      });
      break;

    case 'poll_response':
      actionResult = await actions.handlePollResponse({
        phone: normalizedPhone, message: msg, userName: member.name, entryId: activeEntryId
      });
      break;

    case 'capability_query':
      actionResult = actions.handleCapabilityQuery({
        phone: normalizedPhone, message: msg, userName: member.name, isAdmin: isAdminUser
      });
      break;

    case 'chat':
    default:
      actionResult = await actions.handleChat({
        phone: normalizedPhone, message: msg, userName: member.name, isAdmin: isAdminUser, entryId: activeEntryId
      });
      break;
  }

  // 8. Apply personality
  const historyString = history.length > 0
    ? history.map(turn => `${turn.role === 'user' ? 'User' : 'Bot'}: ${turn.content}`).join('\n')
    : undefined;

  const finalResponse = await applyPersonalityAsync({
    baseResponse: actionResult.response,
    userMessage: msg,
    userName: member.name,
    useLLM: true,
    conversationHistory: historyString
  });

  // 9. Log outbound message
  const metadata = { action: classification.action, confidence: classification.confidence };
  if (classification.action === 'draft_send' && activeDraft?.content) {
    metadata.draftContent = activeDraft.content;
  } else if (classification.action === 'draft_write' && actionResult.newDraft?.content) {
    metadata.draftContent = actionResult.newDraft.content;
  }

  await smsDb.logMessage(activeEntryId, normalizedPhone, 'outbound', finalResponse, metadata);

  return finalResponse;
}

// ============================================
// PAGE COMMANDS (JOIN, PAGES)
// ============================================

async function handlePageCommand(phone, message) {
  const joinMatch = message.trim().match(/^join\s+(\w+)$/i);
  if (joinMatch) {
    const code = joinMatch[1].toUpperCase();
    const entry = await smsDb.findEntryByJoinCode(code);

    if (!entry) {
      return `page "${code}" not found. check the code and try again.`;
    }

    const existing = await smsDb.getMemberByPhone(entry.id, phone);
    await smsDb.setActiveEntryId(phone, entry.id);

    if (existing) {
      return `switched to ${entry.text || code}! text HELP to see commands.`;
    }

    await smsDb.addMember(entry.id, phone);
    return `welcome to ${entry.text || code}! you're now connected. text HELP to see commands.`;
  }

  if (message.toLowerCase().trim() === 'pages') {
    const memberships = await smsDb.getMembershipsByPhone(phone);
    if (memberships.length === 0) {
      return `you're not in any pages yet. text JOIN <code> to join one.`;
    }
    const activeEntryId = await smsDb.getActiveEntryId(phone);
    const pageList = memberships.map(m => {
      const active = m.entry_id === activeEntryId ? ' (active)' : '';
      return `• ${m.entry_text || 'unnamed'}${active} - JOIN ${m.sms_join_code || '?'}`;
    }).join('\n');
    return `your pages:\n${pageList}\n\ntext JOIN <code> to switch`;
  }

  return null;
}

// ============================================
// SYSTEM COMMANDS
// ============================================

async function handleSystemCommand(member, message, activeEntryId) {
  const lower = message.toLowerCase().trim();

  if (lower === 'stop') {
    await smsDb.setMemberOptedOut(activeEntryId, member.phone_normalized, true);
    return "you've been unsubscribed. text START to rejoin.";
  }

  if (lower === 'start') {
    await smsDb.setMemberOptedOut(activeEntryId, member.phone_normalized, false);
    return "welcome back! you're subscribed.";
  }

  if (lower === 'help') {
    const isAdminUser = await smsDb.isAdmin(activeEntryId, member.phone_normalized);
    if (isAdminUser) {
      return `admin commands:
📢 announcements: "announce [message]" - send to everyone
📊 polls: "poll [question]" - ask everyone
💬 ask me questions about the page
text PAGES to see your pages
text STOP to unsubscribe`;
    }
    return `help:
• reply to polls with yes/no/maybe
• add notes like "yes but running late"
• ask questions about the page
• text PAGES to see your pages
• text STOP to unsubscribe`;
  }

  return null;
}

// ============================================
// ONBOARDING
// ============================================

async function handleOnboarding(phone, message, member, activeEntryId) {
  const extractedName = await extractName(message);

  if (extractedName) {
    await smsDb.updateMemberName(activeEntryId, phone, extractedName);
    const isAdminUser = await smsDb.isAdmin(activeEntryId, phone);
    if (isAdminUser) {
      return `hey ${extractedName}! you're set up as an admin.\n\n📢 "announce [message]" - send to all\n📊 "poll [question]" - ask everyone\n💬 ask me anything`;
    }
    return `hey ${extractedName}! you're all set. you'll get announcements and polls from the team.`;
  }

  return "hey! i'm your page's sms assistant. what's your name?";
}

// ============================================
// ANNOUNCEMENT SENDING
// ============================================

async function sendAnnouncementToAll(content, senderPhone, entryId) {
  const members = await smsDb.getOptedInMembers(entryId);
  let sent = 0;

  console.log(`[Announce] Sending to ${members.length} members for entry ${entryId}`);

  for (const member of members) {
    const phone = member.phone_normalized;
    if (!phone || phone.length < 10) continue;

    const result = await sendSms(smsDb.toE164(phone), content);
    if (result.ok) {
      await smsDb.logMessage(entryId, phone, 'outbound', content, {
        action: 'announcement',
        senderPhone: smsDb.normalizePhone(senderPhone)
      });
      sent++;
    } else {
      console.log(`[Announce] Failed to send to ${phone}: ${result.error}`);
    }
  }

  // Also create announcement record
  await smsDb.createAnnouncement(entryId, content, smsDb.normalizePhone(senderPhone));
  await smsDb.updateAnnouncement(
    (await smsDb.getAnnouncements(entryId))[0]?.id,
    { status: 'sent', sent_count: sent, sent_at: new Date() }
  );

  console.log(`[Announce] Complete: sent=${sent}`);
  return sent;
}

// ============================================
// POLL SENDING
// ============================================

async function sendPollToAll(question, senderPhone, requiresExcuse = false, entryId) {
  const poll = await smsDb.createPoll(entryId, question, smsDb.normalizePhone(senderPhone), requiresExcuse);
  const members = await smsDb.getOptedInMembers(entryId);
  let sent = 0;

  const excuseNote = requiresExcuse ? ' (if no explain why)' : '';
  const pollMessage = `📊 ${question}\n\nreply yes/no/maybe${excuseNote}`;

  console.log(`[Poll] Sending to ${members.length} members (requiresExcuse: ${requiresExcuse})`);

  for (const member of members) {
    const phone = member.phone_normalized;
    if (!phone || phone.length < 10) continue;

    const result = await sendSms(smsDb.toE164(phone), pollMessage);
    if (result.ok) {
      await smsDb.logMessage(entryId, phone, 'outbound', pollMessage, {
        action: 'poll',
        pollId: poll.id,
        senderPhone: smsDb.normalizePhone(senderPhone)
      });
      sent++;
    }
  }

  console.log(`[Poll] Complete: sent=${sent}`);
  return sent;
}
