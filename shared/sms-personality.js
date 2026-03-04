/**
 * Personality Engine
 * Transforms responses with sassy, witty personality
 * Ported from Jarvis personality.ts
 */

import OpenAI from 'openai';

// ============================================
// TONE DETECTION
// ============================================

export function analyzeTone(message) {
  const lower = message.toLowerCase();

  const insultPatterns = [
    /\b(stupid|dumb|idiot|moron|suck|trash|garbage|useless|worst|hate you|fuck|shit|ass|bitch)\b/i,
    /\byou('re| are) (bad|terrible|awful|annoying|the worst)\b/i,
    /\b(shut up|go away|leave me alone|stop)\b/i
  ];
  const isInsult = insultPatterns.some(p => p.test(lower));

  const aggressivePatterns = [/!{2,}/, /[A-Z]{3,}/, /\b(wtf|wth|omg|bruh)\b/i, /\b(seriously|really|come on|ugh)\b/i];
  const isAggressive = aggressivePatterns.some(p => p.test(message));

  const friendlyPatterns = [
    /\b(thanks|thank you|please|appreciate|love|awesome|great|nice)\b/i,
    /\b(hey|hi|hello|yo|sup)\b/i
  ];
  const isFriendly = friendlyPatterns.some(p => p.test(message));

  let energy = 'medium';
  if (isInsult || isAggressive || message.includes('!') || /[A-Z]{2,}/.test(message)) energy = 'high';
  else if (message.length < 10 || /^(k|ok|sure|fine|whatever)$/i.test(lower)) energy = 'low';

  return { isInsult, isAggressive, isFriendly, isNeutral: !isInsult && !isAggressive && !isFriendly, energy };
}

// ============================================
// RESPONSE GENERATORS
// ============================================

function generateComeback() {
  const comebacks = [
    "wow creative. anyway, need something?",
    "ouch. my feelings. anyway...",
    "that's nice. you done?",
    "k. you done venting or what?",
    "sick burn. now what do you actually want?",
    "ok and? i'm still here unfortunately for you",
    "that's crazy. so what do you need?",
    "noted. moving on..."
  ];
  return comebacks[Math.floor(Math.random() * comebacks.length)];
}

function handleThankYou() {
  const responses = [
    "yeah yeah you're welcome",
    "don't mention it. seriously don't",
    "that's what i'm here for i guess",
    "np",
    "sure thing",
    "finally some appreciation around here"
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function handleGreeting(userName) {
  const name = userName || 'you';
  const greetings = [
    `sup ${name}`,
    `hey ${name}. what do you need?`,
    `oh look who it is. hey ${name}`,
    `${name}! what's up`,
    `yo ${name}`
  ];
  return greetings[Math.floor(Math.random() * greetings.length)];
}

function addSass(response, level, skipEmojis = false) {
  const isFactual = response.length > 100;

  const sassyPrefixes = {
    mild: ['okay so ', 'alright ', '', ''],
    medium: ['okay okay ', 'yeah yeah ', '', 'alright '],
    spicy: ['okay fine ', 'alright ', 'listen ', '']
  };

  const sassySuffixes = {
    mild: ['', '', '', ''],
    medium: [' there you go', '', ' anyway', ''],
    spicy: [" you're welcome btw", ' happy?', '', '']
  };

  const prefixes = sassyPrefixes[level] || sassyPrefixes.medium;
  const suffixes = sassySuffixes[level] || sassySuffixes.medium;

  const prefixIndex = isFactual ? Math.floor(Math.random() * prefixes.length * 0.7) : Math.floor(Math.random() * prefixes.length);
  const prefix = prefixes[Math.min(prefixIndex, prefixes.length - 1)];

  let result = response;
  if (!result.toLowerCase().startsWith('okay') && !result.toLowerCase().startsWith('alright') && !result.toLowerCase().startsWith('fine')) {
    result = prefix + result;
  }

  if (!skipEmojis && !isFactual) {
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    result = result + suffix;
  }

  return result;
}

// ============================================
// MAIN PERSONALITY FUNCTIONS
// ============================================

const DEFAULT_CONFIG = { baseTone: 'medium', matchUserEnergy: true, useEmoji: true };

export function applyPersonality({ baseResponse, userMessage, userName, config = DEFAULT_CONFIG }) {
  const tone = analyzeTone(userMessage);

  if (tone.isInsult && config.matchUserEnergy) return generateComeback();
  if (/\b(thanks|thank you|thx|ty)\b/i.test(userMessage.toLowerCase())) return handleThankYou();
  if (/^(hi|hey|hello|yo|sup|what'?s up|wassup)$/i.test(userMessage.trim())) return handleGreeting(userName);

  let toneLevel = config.baseTone;
  if (config.matchUserEnergy) {
    if (tone.isAggressive || tone.energy === 'high') toneLevel = 'spicy';
    else if (tone.isFriendly) toneLevel = 'mild';
  }

  const skipEmojis = baseResponse.length > 80;
  let result = addSass(baseResponse, toneLevel, skipEmojis);

  if (result.length > 0 && /^[A-Z]/.test(result) && !/^[A-Z]{2,}/.test(result)) {
    result = result.charAt(0).toLowerCase() + result.slice(1);
  }

  return result;
}

export async function applyPersonalityAsync({ baseResponse, userMessage, userName, config = DEFAULT_CONFIG, useLLM = false, conversationHistory }) {
  const tone = analyzeTone(userMessage);

  if (tone.isInsult && config.matchUserEnergy) return generateComeback();
  if (/\b(thanks|thank you|thx|ty)\b/i.test(userMessage.toLowerCase())) return handleThankYou();
  if (/^(hi|hey|hello|yo|sup|what'?s up|wassup)$/i.test(userMessage.trim())) return handleGreeting(userName);

  if (useLLM && process.env.OPENAI_API_KEY) {
    try {
      const toneLevel = config.matchUserEnergy && tone.isAggressive ? 'spicy' : config.baseTone;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const systemPrompt = `You are a sassy AI assistant for an organization via SMS.

PERSONALITY:
- Clever and witty, slightly sarcastic but ultimately helpful
- Lowercase style, minimal punctuation
- Very sparing with emojis (0-1 per message)
- Concise - SMS-friendly, under 160 chars when possible

TONE: ${toneLevel}
- For factual/informational responses: be direct, minimal sass
- For casual chat: more personality, but still concise

Transform the base response into your voice:`;

      const messages = [{ role: 'system', content: systemPrompt }];
      if (conversationHistory) {
        messages.push({
          role: 'user',
          content: `Previous conversation:\n${conversationHistory}\n\nCurrent message: "${userMessage}"\nBase response: "${baseResponse}"\n\nYour response:`
        });
      } else {
        messages.push({
          role: 'user',
          content: `User: "${userMessage}"\nBase response: "${baseResponse}"\n\nYour response:`
        });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 150
      });

      return response.choices[0].message.content || baseResponse;
    } catch (error) {
      console.error('[Personality] LLM error:', error);
    }
  }

  return applyPersonality({ baseResponse, userMessage, userName, config });
}

// ============================================
// TEMPLATES
// ============================================

export const TEMPLATES = {
  draftCreated: (type, content) =>
    `here's the ${type}:\n\n"${content}"\n\nreply "send" to blast it out or tell me to change it`,
  draftUpdated: (content) =>
    `updated:\n\n"${content}"\n\nlooks good? say "send" or keep editing`,
  draftSent: (count) =>
    `done. sent to ${count} people`,
  draftCancelled: () =>
    `scrapped. let me know if you wanna start over`,
  askForContent: (type) =>
    type === 'poll' ? `what do you wanna ask everyone?` : `what do you wanna announce?`,
  noDraft: () =>
    `you don't have anything drafted rn. wanna make an announcement or poll?`,
  capabilities: (isAdmin) =>
    `i can:\n📢 send announcements ("announce [message]")\n📊 create polls ("poll [question]")\n💬 answer questions about the page\n\njust text me what you need`,
  confused: () =>
    `not sure what you mean. need help with something?`
};

// ============================================
// QUICK RESPONSES
// ============================================

export function getQuickResponse(input) {
  const lower = input.toLowerCase().trim();
  const quickResponses = {
    'ok': ['k', 'cool', 'noted'],
    'k': ['ok', 'yep'],
    'lol': ['lmao', 'glad you find this amusing'],
    'lmao': ['ikr', 'fr'],
    'bruh': ['what', 'bruh indeed'],
    'nice': ['thanks i guess', 'ikr'],
    'cool': ['i know', 'yep'],
    'true': ['facts', 'yep', 'fr fr'],
    'fr': ['fr fr', 'facts'],
    'bet': ['bet', 'cool'],
    'idk': ['same tbh', 'fair enough'],
    'nvm': ['ok', 'sure', 'k'],
    'mb': ['all good', 'np'],
    'my bad': ['all good', 'np'],
    '?': ['use your words', 'what'],
    '??': ['???', 'huh'],
    '???': ['bro what', 'use words pls']
  };

  const responses = quickResponses[lower];
  if (responses) return responses[Math.floor(Math.random() * responses.length)];
  return null;
}
