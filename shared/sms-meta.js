/**
 * Meta-Instruction Detection
 * LLM-powered detection of announcements/polls/meta-instructions from entry text
 */

import OpenAI from 'openai';
import * as smsDb from './sms-db.js';

/**
 * Detect if entry text matches meta-instructions and should be flagged as announcement/poll
 * Called after commitEditor() when the page has SMS members + meta-instructions
 *
 * @param {string} entryText - The text content of the entry
 * @param {string} entryId - The entry ID (child entry being committed)
 * @param {string} parentEntryId - The parent page entry ID (the SMS-enabled page)
 * @returns {{ smsType: string|null, smsRefId: string|null }} - Detection result
 */
export async function detectSmsType(entryText, entryId, parentEntryId) {
  if (!entryText || !parentEntryId) return { smsType: null, smsRefId: null };
  if (!process.env.OPENAI_API_KEY) return { smsType: null, smsRefId: null };

  try {
    // Get meta-instructions for this page
    const metaInstructions = await smsDb.getMetaInstructions(parentEntryId);
    if (metaInstructions.length === 0) return { smsType: null, smsRefId: null };

    const instructionsText = metaInstructions.map(m => `- ${m.instruction}`).join('\n');

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are analyzing whether a canvas entry matches any meta-instructions for automatic SMS handling.

Meta-instructions for this page:
${instructionsText}

Analyze the entry text and determine if it should be:
- "announcement" - matches a meta-instruction that says to announce things like this
- "poll" - matches a meta-instruction that says to poll about things like this
- "meta_instruction" - the entry itself IS a new meta-instruction (e.g., "always announce events", "poll before meetings")
- null - doesn't match any meta-instruction

Be flexible with natural language matching. The meta-instructions define PATTERNS, not exact matches.

Respond with JSON: { "smsType": "announcement"|"poll"|"meta_instruction"|null, "reasoning": string }`
        },
        {
          role: 'user',
          content: `Entry text: "${entryText}"`
        }
      ],
      temperature: 0.2,
      max_tokens: 150,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    console.log(`[MetaDetect] type=${parsed.smsType}, reasoning=${parsed.reasoning}`);

    if (!parsed.smsType) return { smsType: null, smsRefId: null };

    let smsRefId = null;

    // If it's an announcement, create it and auto-send to all opted-in members
    if (parsed.smsType === 'announcement') {
      const announcement = await smsDb.createAnnouncement(parentEntryId, entryText, null, 'auto');
      smsRefId = announcement.id;

      // Auto-send to all opted-in members in the space
      try {
        const { sendSms } = await import('./sms.js');
        const members = await smsDb.getOptedInMembers(parentEntryId);
        let sent = 0;
        for (const member of members) {
          const phone = member.phone_normalized;
          if (!phone || phone.length < 10) continue;
          const result = await sendSms(smsDb.toE164(phone), entryText);
          if (result.ok) {
            await smsDb.logMessage(parentEntryId, phone, 'outbound', entryText, { action: 'announcement' });
            sent++;
          }
        }
        await smsDb.updateAnnouncement(announcement.id, { status: 'sent', sent_count: sent, sent_at: new Date() });
        console.log(`[MetaDetect] Auto-sent announcement to ${sent} members`);
      } catch (sendErr) {
        console.error('[MetaDetect] Auto-send failed:', sendErr);
      }
    }

    // If it's a poll, create a draft poll (not active yet)
    if (parsed.smsType === 'poll') {
      // Don't auto-activate, just flag the entry
      smsRefId = null;
    }

    // If it's a new meta-instruction, save it
    if (parsed.smsType === 'meta_instruction') {
      const meta = await smsDb.addMetaInstruction(parentEntryId, entryText);
      smsRefId = meta.id;
    }

    // Update the entry with SMS type
    await smsDb.updateEntrySmsFields(entryId, { smsType: parsed.smsType, smsRefId });

    return { smsType: parsed.smsType, smsRefId };
  } catch (error) {
    console.error('[MetaDetect] Error:', error);
    return { smsType: null, smsRefId: null };
  }
}
