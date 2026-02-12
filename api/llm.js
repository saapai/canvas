import OpenAI from 'openai';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function processTextWithLLM(text, existingCards) {
  const existingContext = existingCards
    .map(c => `- "${c.text}" (id: ${c.id}, category: ${c.category || 'uncategorized'})`)
    .join('\n');

  const prompt = `You are organizing information cards in a semantic graph. Given a new card with text: "${text}"

Existing cards:
${existingContext || '(none)'}

Analyze the semantic relationships and determine:
1. A category for this card (e.g., "personal", "work", "ideas", "tasks", "notes", etc.)
2. Which existing card(s) it relates to most strongly by semantic meaning (list card IDs), or empty array if standalone
3. A brief summary/title (max 5 words)
4. Key topics/concepts (array of 2-4 keywords)

Respond ONLY with valid JSON in this exact format:
{
  "category": "category_name",
  "relatedCardIds": ["card-id-1"] or [],
  "summary": "brief summary",
  "topics": ["topic1", "topic2"],
  "position": {"x": 0, "y": 0}
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a semantic graph organizer. Analyze text and determine relationships. Respond ONLY with valid JSON, no other text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    const content = completion.choices[0].message.content.trim();
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const result = JSON.parse(jsonStr);
    
    // Calculate position based on related cards
    if (result.relatedCardIds && result.relatedCardIds.length > 0) {
      const relatedCard = existingCards.find(c => c.id === result.relatedCardIds[0]);
      if (relatedCard && relatedCard.position) {
        // Position near related card with slight offset
        result.position = {
          x: relatedCard.position.x + 250 + (Math.random() * 100 - 50),
          y: relatedCard.position.y + 80 + (Math.random() * 100 - 50)
        };
      }
    }
    
    // If no position set, use default
    if (!result.position) {
      result.position = { x: 0, y: 0 };
    }
    
    return result;
  } catch (error) {
    console.error('OpenAI API error:', error);
    
    // Fallback response
    return {
      category: 'general',
      relatedCardIds: [],
      summary: text.slice(0, 30),
      topics: [],
      position: { x: 0, y: 0 }
    };
  }
}

function extractYouTubeVideoId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
  } catch {}
  return null;
}

export async function fetchLinkMetadata(url) {
  // YouTube: use oEmbed API for accurate metadata
  const videoId = extractYouTubeVideoId(url);
  if (videoId) {
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        return {
          title: oembed.title,
          description: oembed.author_name,
          image: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          siteName: 'YouTube',
          url,
          videoId,
          isVideo: true
        };
      }
    } catch (e) {
      console.error('YouTube oEmbed failed, falling back to generic fetch:', e);
    }
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract Open Graph tags, fallback to standard meta tags
    const metadata = {
      title: $('meta[property="og:title"]').attr('content') ||
             $('meta[name="twitter:title"]').attr('content') ||
             $('title').text() ||
             url,
      description: $('meta[property="og:description"]').attr('content') ||
                   $('meta[name="twitter:description"]').attr('content') ||
                   $('meta[name="description"]').attr('content') ||
                   '',
      image: $('meta[property="og:image"]').attr('content') ||
             $('meta[name="twitter:image"]').attr('content') ||
             $('meta[name="twitter:image:src"]').attr('content') ||
             '',
      siteName: $('meta[property="og:site_name"]').attr('content') ||
                new URL(url).hostname.replace('www.', ''),
      url: url
    };

    // Clean up description
    if (metadata.description) {
      metadata.description = metadata.description.trim().substring(0, 300);
    }

    return metadata;
  } catch (error) {
    console.error('Error fetching link metadata:', error);
    return {
      title: new URL(url).hostname,
      description: '',
      image: '',
      siteName: new URL(url).hostname.replace('www.', ''),
      url: url
    };
  }
}

export async function generateLinkCard(metadata) {
  const prompt = `You are creating a link preview card similar to Substack. Given this link metadata:

Title: ${metadata.title}
Description: ${metadata.description || 'No description available'}
Site: ${metadata.siteName}
URL: ${metadata.url}

Generate a concise, engaging card preview that:
1. Has a compelling title (use the provided title or create a better one if needed, max 80 chars)
2. Has a brief, engaging description (2-3 sentences, max 150 chars) that summarizes the content
3. Maintains the original site name

Respond ONLY with valid JSON in this exact format:
{
  "title": "compelling title",
  "description": "brief engaging description",
  "siteName": "${metadata.siteName}",
  "image": "${metadata.image || ''}",
  "url": "${metadata.url}"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a content curator creating link preview cards. Make them engaging and informative. Respond ONLY with valid JSON, no other text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5,
      max_tokens: 200
    });

    const content = completion.choices[0].message.content.trim();
    
    // Extract JSON from response with better error handling
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('Failed to parse OpenAI response for link card:', content);
      console.error('Parse error:', parseErr);
      // Return a basic card instead of failing completely
      return {
        url,
        title: metadata.title || url,
        description: metadata.description || 'Failed to generate card preview',
        image: metadata.image || null
      };
    }
    
    // Ensure image is included
    if (!result.image && metadata.image) {
      result.image = metadata.image;
    }
    
    return result;
  } catch (error) {
    console.error('OpenAI API error generating card:', error);
    
    // Fallback to original metadata
    return {
      title: metadata.title,
      description: metadata.description || 'Click to view article',
      siteName: metadata.siteName,
      image: metadata.image,
      url: metadata.url
    };
  }
}

export async function convertTextToLatex(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a LaTeX expert that converts plain text and math expressions into proper LaTeX notation rendered by KaTeX. Respond ONLY with valid JSON, no other text.

CRITICAL: Output must be KaTeX-compatible. Use only commands supported by KaTeX 0.16.

Reference for correct notation:
- Integrals: \\int_a^b, \\iint, \\iiint, \\oint, \\int_{-\\infty}^{\\infty}
- Derivatives: \\frac{d}{dx}, \\frac{dy}{dx}, \\frac{d^2y}{dx^2}, \\frac{\\partial f}{\\partial x}, \\frac{\\partial^2 f}{\\partial x^2}, f'(x), f''(x)
- Limits: \\lim_{x \\to \\infty}, \\lim_{n \\to 0}, \\lim_{h \\to 0}
- Operator functions: \\sin, \\cos, \\tan, \\sec, \\csc, \\cot, \\arcsin, \\arccos, \\arctan, \\sinh, \\cosh, \\tanh, \\log, \\ln, \\exp, \\det, \\dim, \\ker, \\deg, \\gcd, \\hom, \\arg, \\max, \\min, \\sup, \\inf, \\Pr
- Summation/products: \\sum_{i=0}^{n}, \\prod_{i=1}^{n}, \\coprod, \\bigcup, \\bigcap
- Fractions: \\frac{a}{b}, \\dfrac{a}{b} (display-size), \\tfrac{a}{b} (text-size), \\binom{n}{k}
- Roots: \\sqrt{x}, \\sqrt[n]{x}
- Greek: \\alpha, \\beta, \\gamma, \\delta, \\epsilon, \\varepsilon, \\theta, \\vartheta, \\lambda, \\mu, \\pi, \\sigma, \\phi, \\varphi, \\omega, \\Gamma, \\Delta, \\Theta, \\Lambda, \\Pi, \\Sigma, \\Phi, \\Psi, \\Omega
- Relations: \\leq, \\geq, \\neq, \\approx, \\equiv, \\sim, \\simeq, \\cong, \\propto, \\ll, \\gg, \\prec, \\succ, \\subset, \\supset, \\subseteq, \\supseteq, \\in, \\notin, \\ni
- Arrows: \\to, \\rightarrow, \\leftarrow, \\Rightarrow, \\Leftarrow, \\Leftrightarrow, \\mapsto, \\implies, \\iff
- Set theory: \\cup, \\cap, \\setminus, \\emptyset, \\varnothing, \\forall, \\exists, \\nexists, \\land, \\lor, \\neg, \\mathbb{R}, \\mathbb{Z}, \\mathbb{N}, \\mathbb{Q}, \\mathbb{C}
- Matrices: \\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}, \\begin{pmatrix}...\\end{pmatrix}, \\begin{vmatrix}...\\end{vmatrix}
- Vectors: \\vec{v}, \\mathbf{v}, \\hat{x}, \\dot{x}, \\ddot{x}, \\bar{x}, \\tilde{x}
- Spacing: \\quad, \\qquad, \\, \\; \\: \\! for fine control
- Text in math: \\text{...} for words inside math mode
- Cases: \\begin{cases} ... \\end{cases} for piecewise functions
- Aligned equations: \\begin{aligned} ... \\end{aligned} with & for alignment and \\\\ for line breaks

IMPORTANT rules:
- Always use \\operatorname{name} for non-standard function names not listed above
- Use \\left( and \\right) for auto-sizing delimiters around tall expressions
- Use \\, for thin space between differential dx and the integrand: \\int f(x)\\,dx
- For multi-line equations, use \\begin{aligned}...\\end{aligned} inside $$ delimiters
- Never use \\displaystyle inside display mode (it's redundant)
- Use \\text{} for non-math words within equations

PARENTHESES, BRACKETS, AND SCOPE (critical):
- The user is writing in NATURAL LANGUAGE, not in LaTeX. Parentheses in their input are for grouping/clarity in English, NOT necessarily mathematical parentheses in the output.
- Output should follow STANDARD MATHEMATICAL NOTATION. Only include parentheses/brackets where mathematically necessary or conventional:
  - Function arguments: \\sin(x), \\cos(3x^2), \\log(x+1) — parentheses are standard here.
  - Grouping for clarity when precedence is ambiguous: (x+1)(x-1), (a+b)^2.
  - DO NOT add unnecessary parentheses around simple terms: "integral of (3x cubed)" → \\int 3x^3\\,dx (NOT \\int (3x^3)\\,dx). The parens in the input were just English grouping.
  - DO NOT wrap single-factor integrands in parentheses: \\int 3x^3\\,dx, not \\int (3x^3)\\,dx.
- When there are NO parentheses, infer the natural scope:
  - "sin of 3x squared" → \\sin(3x^2) (parentheses needed for function argument clarity).
  - "integral of 3x squared" → \\int 3x^2\\,dx (no parentheses needed).
  - "integral of sin of 3x squared" → \\int \\sin(3x^2)\\,dx.
- Use \\left( and \\right) for auto-sizing delimiters ONLY around tall expressions (fractions, sums, etc.).
- INTEGRALS: "integral of X" or "integral of X dx" must always become \\int X \\,dx (or with bounds). The integrand goes directly after \\int without parentheses unless mathematically needed (e.g. multiple added terms: \\int (3x^2 + 2x)\\,dx). Examples: "integral of 3x squared" → $$\\int 3x^2\\,dx$$; "integral of sin x" → $$\\int \\sin x\\,dx$$; "integral of (3x cubed) times the square root of a billion times one twenty seventh" → $$\\int 3x^3 \\sqrt{10^9} \\cdot \\frac{1}{27}\\,dx$$. Never leave integrals as plain English.
- FRACTIONS: Convert spoken fractions to \\frac{num}{den}. "one fifth" or "1/5" → \\frac{1}{5}; "x over 2" → \\frac{x}{2}; "one half" → \\frac{1}{2}; "two thirds" → \\frac{2}{3}; "one twenty seventh" → \\frac{1}{27}. "400 minus one fifth" → 400 - \\frac{1}{5}.
- POLYNOMIALS AND EQUATIONS: "x squared" → x^2; "3x squared" → 3x^2; "plus" → +; "minus" → -; "equals" → =. Example: "3x squared plus 23 equals 400 minus one fifth" → $$3x^2 + 23 = 400 - \\frac{1}{5}$$. Always convert full equations to LaTeX, never leave as English.
- Produce complete, valid LaTeX only. No partial or placeholder expressions. Output only the JSON with "latex" and "isFullMath" keys.`
        },
        {
          role: 'user',
          content: `Convert the following text into LaTeX notation. Convert math expressions, equations, Greek letters, operations, fractions, integrals, summations, polynomials, and any mathematical notation into proper KaTeX-compatible LaTeX.

If the text is primarily a math expression or equation, wrap it in display math mode ($$...$$).
If the text contains inline math mixed with regular text, wrap math parts in inline math mode ($...$) and keep regular text as-is.
For multiple equations or steps, use $$\\begin{aligned} ... \\end{aligned}$$ with & for alignment points and \\\\ for line breaks.

CRITICAL: Convert ALL math to LaTeX. Never leave as English.
- Integrals: "integral of 3x squared" → $$\\int 3x^2\\,dx$$
- Fractions: "one fifth" → \\frac{1}{5}; "one twenty seventh" → \\frac{1}{27}
- Equations: "3x squared plus 23 equals 400 minus one fifth" → $$3x^2 + 23 = 400 - \\frac{1}{5}$$
- Parentheses in the input are English grouping, NOT necessarily math notation. Follow standard math conventions for when to use parens.
- "integral of (3x cubed) times the square root of a billion times one twenty seventh" → $$\\int 3x^3 \\sqrt{10^9} \\cdot \\frac{1}{27}\\,dx$$

Text to convert:
"${text}"

Respond ONLY with valid JSON in this exact format:
{
  "latex": "the LaTeX source string",
  "isFullMath": true
}

Where "isFullMath" is true if the entire content is mathematical, false if it's mixed text and math.`
        }
      ],
      temperature: 0.1,
      max_tokens: 2000
    });

    const content = completion.choices[0].message.content.trim();

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    // LaTeX backslashes conflict with JSON escapes: \frac → \f (form feed) + "rac",
    // \theta → \t (tab) + "heta", \nabla → \n (newline) + "abla", etc.
    // Fix: inside JSON string values, double-escape ALL backslashes except
    // \" (quote), \\ (already-escaped backslash), \/ (slash), and \uXXXX (unicode).
    // This is applied ALWAYS, not just on parse failure, because valid JSON escapes
    // like \f, \b, \n, \r, \t silently corrupt LaTeX commands.
    function fixJsonLatexEscapes(raw) {
      const out = [];
      let inStr = false;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (!inStr) {
          out.push(c);
          if (c === '"') inStr = true;
          continue;
        }
        // Inside a JSON string value
        if (c === '\\') {
          const next = raw[i + 1];
          if (next === '"' || next === '/') {
            // Preserve \" and \/ — these are valid JSON escapes we need
            out.push(c, next);
            i++;
          } else if (next === '\\') {
            // Already-escaped backslash — LLM correctly doubled it
            out.push(c, next);
            i++;
          } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.substring(i + 2, i + 6))) {
            // Unicode escape \uXXXX
            out.push(raw.substring(i, i + 6));
            i += 5;
          } else {
            // Everything else (\f, \b, \n, \r, \t, \i, \s, \, etc.)
            // Double-escape so the backslash is literal in the parsed value
            out.push('\\\\');
            // Don't skip next char — it's processed in the next iteration
          }
        } else if (c === '"') {
          out.push(c);
          inStr = false;
        } else {
          out.push(c);
        }
      }
      return out.join('');
    }

    jsonStr = fixJsonLatexEscapes(jsonStr);
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (error) {
    console.error('Error converting text to LaTeX:', error);
    return { latex: text, isFullMath: false, error: error.message };
  }
}

export async function extractDeadlinesFromFile(buffer, mimetype, originalname) {
  // Compute today's date in Pacific time so relative terms resolve correctly
  const pacificNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayFull = `${dayNames[pacificNow.getDay()]}, ${monthNames[pacificNow.getMonth()]} ${pacificNow.getDate()}, ${pacificNow.getFullYear()}`;

  const m = pacificNow.getMonth() + 1;
  const d = pacificNow.getDate();
  const y = pacificNow.getFullYear();
  const todayNumeric = `${m}/${d}/${y}`;

  const deadlinePrompt = `Today is ${todayFull} (${todayNumeric}).

Extract EVERY upcoming deadline from the document. Be thorough — scan the ENTIRE document including course schedules, assignment lists, exam dates, and grading sections.

CRITICAL FORMAT RULE: The "deadline" field MUST be in M/D/YYYY numeric format (e.g. "2/17/2026"). NEVER use words like "today", "tomorrow", "next Tuesday", or day names. Always use numbers.

Instructions:
- For recurring assignments (weekly readings, homework sets, etc.), number them: "Reading Response 1", "Homework 2", "Quiz 3", etc. Start numbering from 1 for the first occurrence in the course, even if earlier ones are past.
- Dates like "T 2/10", "Th 2/12", "W 2/4", "F 3/20" are weekday abbreviations + month/day — convert to M/D/${y}.
- If the syllabus says responses are "due on the Tuesday after assigned", compute the actual due date for each one.
- Dates with * (like "Th 1/15*") usually indicate quiz/discussion dates — include those too.
- Include midterms, finals, quizzes, discussion sections with quizzes, project deadlines, extra credit deadlines.
- Put exam times (e.g. "8am to 11am"), reading/paper names, and weight percentages in the "notes" field.
- Use the course name/number (e.g. "PSYCH 85", "PIC 10B") as the "class" value.
- Only include items from ${todayNumeric} onwards (today or future).

Example output:
{"deadlines":[
  {"assignment":"Reading Response 5","deadline":"2/10/2026","class":"PSYCH 85","notes":"Murphy (2019), 40% of grade"},
  {"assignment":"Midterm 2","deadline":"2/25/2026","class":"PIC 10B","notes":"In-class, 25%"},
  {"assignment":"Final Exam","deadline":"3/20/2026","class":"PSYCH 85","notes":"8am to 11am, 60% of grade"}
]}

Respond ONLY with valid JSON: { "deadlines": [...] }`;

  try {
    let messages;

    if (mimetype.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${mimetype};base64,${base64}`;
      messages = [
        { role: 'system', content: 'You extract deadlines and assignments from documents. Respond ONLY with valid JSON, no other text.' },
        { role: 'user', content: [
          { type: 'text', text: deadlinePrompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]}
      ];
    } else {
      let text;
      if (mimetype === 'application/pdf') {
        const parsed = await pdfParse(buffer);
        text = parsed.text;
      } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else {
        text = buffer.toString('utf-8');
      }

      if (!text || !text.trim()) {
        return { deadlines: [] };
      }

      // Truncate to ~20k chars to stay within token limits
      const truncated = text.length > 20000 ? text.slice(0, 20000) + '\n...(truncated)' : text;

      messages = [
        { role: 'system', content: 'You extract deadlines and assignments from documents. Respond ONLY with valid JSON, no other text.' },
        { role: 'user', content: `${deadlinePrompt}\n\n---\nDocument content:\n${truncated}` }
      ];
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.1,
      max_tokens: 4000
    });

    const content = completion.choices[0].message.content.trim();
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const result = JSON.parse(jsonStr);
    return { deadlines: Array.isArray(result.deadlines) ? result.deadlines : [] };
  } catch (error) {
    console.error('Error extracting deadlines:', error);
    return { deadlines: [], error: error.message };
  }
}
