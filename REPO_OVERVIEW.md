# REPO_OVERVIEW.md — Canvas (DuttaPad)

## Project Summary

Infinite canvas diary app — users click anywhere to type, entries persist on a 2D canvas with pan/zoom. Text "melts" into the page with ink-bleed animation, then an LLM semantically organizes entries. Includes SMS bot (Jarvis), Slack integration with auto-notifications, Google Calendar sync, and collaborative editing.

**Tech stack:** Vanilla JS frontend (no framework) | Express.js backend | PostgreSQL | Vercel serverless mirror | OpenAI GPT-4o | Twilio SMS | Slack API | Google APIs | Supabase (image storage) | KaTeX

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (public/)  — Vanilla JS, 22 modules               │
│  Canvas engine, editor, melt animation, entry rendering      │
└──────────────┬──────────────────────────────────────────────┘
               │ REST API (JWT cookie auth)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend (shared/ + server/)  — Express.js                   │
│  routes.js (2800 lines) — all API handlers                   │
│  auth.js — JWT middleware                                    │
│  db.js — PostgreSQL pool + schema migrations                 │
│  llm.js — GPT-4o integration                                │
│  chat.js — canvas chat bot                                   │
│  sms*.js — Jarvis SMS bot pipeline                           │
│  slack*.js — Slack sync + fact extraction                     │
│  upload.js — Supabase image upload                           │
└──────┬──────────┬──────────┬──────────┬─────────────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
   PostgreSQL   Twilio    Slack API   Google APIs
   (entries,    (SMS       (channel   (Calendar,
    users,      verify,    sync,      OAuth)
    groups)     bot)       facts)
                                        │
                                        ▼
                                    Supabase
                                    (images)

Vercel Mirror: api/ duplicates shared/ for serverless deploy
Cron: slack-sync (30min), notifications (5min), unanswered-questions (hourly)
```

## File/Directory Map

```
canvas/
├── public/                     # Frontend SPA
│   ├── index.html              # Entry point
│   ├── styles.css              # All styles + melt animation
│   ├── app.js                  # Module loader
│   └── js/                     # 22 modular JS files
│       ├── state.js            # Global state & DOM refs
│       ├── auth.js             # Phone/SMS auth UI
│       ├── canvas.js           # Pan/zoom/click/drag/resize (62KB)
│       ├── entries.js          # Entry CRUD + undo stack (34KB)
│       ├── editor.js           # Contenteditable editor (39KB)
│       ├── navigation.js       # Trench nav + breadcrumb
│       ├── rendering.js        # DOM rendering
│       ├── selection.js        # Multi-select/lasso
│       ├── camera.js           # Pan/zoom math
│       ├── calendar.js         # Google Calendar widget
│       ├── media.js            # Movie/song/image cards
│       ├── deadlines.js        # Deadline table templates
│       ├── chat.js             # Canvas chat UI
│       ├── cursor.js           # Cursor styling
│       ├── autocomplete.js     # Media search/autocomplete
│       ├── organize.js         # Graph layout algorithm
│       ├── ui-formatting.js    # Text formatting toolbar
│       ├── spaces.js           # Multi-space/username mgmt
│       ├── manage.js           # Page editor sharing UI
│       ├── slack.js            # Slack sync UI
│       ├── article.js          # Article/reading view
│       └── navigator.js        # Navigator panel
├── server/                     # Express server
│   ├── index.js                # App init (port 3000)
│   ├── db.js                   # PostgreSQL schema/queries
│   ├── llm.js                  # OpenAI integration
│   ├── chat.js                 # Chat logic
│   └── audit-log.js            # Entry change audit trail
├── shared/                     # Shared backend code
│   ├── routes.js               # All API route handlers (2807 lines)
│   ├── db.js                   # PostgreSQL pool & queries
│   ├── llm.js                  # LLM functions
│   ├── chat.js                 # Canvas chat implementation
│   ├── auth.js                 # JWT/cookie auth
│   ├── config.js               # Constants & env config
│   ├── upload.js               # Supabase image upload
│   ├── sms.js                  # Twilio SMS pipeline
│   ├── sms-db.js               # SMS group/message data
│   ├── sms-actions.js          # SMS command handlers
│   ├── sms-classifier.js       # Intent classification (LLM)
│   ├── sms-personality.js      # LLM personality layer
│   ├── sms-history.js          # Conversation history
│   ├── sms-meta.js             # SMS metadata extraction
│   ├── slack.js                # Slack sync/integration
│   └── slack-db.js             # Slack data persistence
├── api/                        # Vercel serverless mirror
│   ├── index.js                # API entry point
│   ├── db.js                   # Mirror of shared/db.js
│   └── llm.js                  # Mirror of shared/llm.js
├── scripts/                    # Utilities
│   ├── migrate-jarvis.js       # Data migration
│   └── seed-sep.js             # DB seeding
├── CLAUDE.md                   # Architecture guide for Claude
├── FEATURES.md                 # Feature status & changelog
├── README.md                   # Setup & deployment guide
├── package.json                # 31 dependencies
├── vercel.json                 # Vercel config (cron, rewrites)
└── variables.env               # Env variable template
```

## Feature Logic & Flows

### Canvas Core

```
User clicks canvas → placeEditorAtWorld(x, y) → contenteditable div appears
  ↓ types text
Ctrl+Enter → commitEditor()
  ├── Save to entries Map (frontend)
  ├── POST /api/entries (persist to PostgreSQL)
  ├── meltify() → ink-bleed animation
  └── POST /api/process-text → LLM semantic analysis
       └── Returns: { category, relatedCardIds, position }
           └── Entry repositioned near related entries
```

### Camera & Navigation

```
State: cam = { x, y, z }  (position + zoom)

Scroll wheel        → pan left/right
Trackpad pinch      → zoom (detected via ctrlKey)
Mobile touch pinch  → zoom

Double-click entry → navigate INTO (children become visible)
  └── zoomToFit(children) → animated 800ms
Breadcrumb click   → navigate BACK
  └── navigationStack.pop()

currentViewEntryId filters which entries render
```

### Authentication

```
Enter phone → POST /api/auth/request-code → Twilio SMS
Enter code  → POST /api/auth/verify-code
  ├── Valid? → Create JWT (30-day, HTTP-only cookie)
  │           payload: { id, phone, username }
  └── Invalid? → Error message

Multiple usernames per phone (spaces)
Page access: isOwner OR isEditor(admin) → edit mode; isEditor(member) → read-only with live sync; else → read-only
Editor detection: server-side via JWT cookie in route handler (getEditorRole), injected as PAGE_IS_EDITOR/PAGE_EDITOR_ROLE in HTML
Client trusts server-side values — does NOT require /api/auth/me to succeed for editability
```

### Sharing & Collaboration

```
Roles: admin (full edit) | member (read-only live view)
Share UI: phone input + role selector → POST /api/editors/add
Shared page cards: on owner's home page, lightweight nav cards (link + role badge)
  → Click navigates to owner's canvas with appropriate permissions
SMS admin link entries: regular entry text with green left border (data-sms-join-code CSS)
  → DO NOT replace entry innerHTML with card layout — keep original text visible
  → Click navigates to owner's page
```

### Entry Types

```
Plain text    → contenteditable, formatting toolbar
Deadline table → deadline-table class, interactive cells
Calendar card  → gcal-card class, Google Calendar monthly grid
Media cards   → Movie (TMDB) / Song (Spotify) / Image (Supabase)
Link cards    → Auto-preview on URL paste
LaTeX entries  → English → GPT-4o-mini → KaTeX render

Critical: All types must handle 3 integration points:
  1. Main load (~line 696 entries.js)
  2. Sub-page load (~line 1291)
  3. Undo/restore (~line 7209)
```

### SMS Bot (Jarvis)

```
Twilio webhook → /api/twilio/sms → handleIncomingSms()
  ↓
classifyIntent(message) — LLM classification
  ├── "join"       → joinGroup(phone, code)
  ├── "announce"   → startDraft(phone, text) → broadcast to group
  ├── "poll"       → createPoll(question) → collect responses
  ├── "query"      → queryContent(question, context)
  │                   context = entries + slack facts + conversation history + notifications
  ├── "follow-up"  → resolveFollowUp(history + recent notifications → trace to source)
  └── "other"      → freeform LLM response

Response → applyPersonality() → send via TwiML XML
```

### Slack Integration

```
Cron (30min) → syncAllChannels()
  ├── List accessible channels
  ├── Fetch recent messages (500/channel)
  ├── LLM extracts facts: { type, extracted_fact, deadline, raw_text }
  │   Types: deadline | event | announcement | actionable | general
  ├── Recency bias: new facts supersede outdated ones
  ├── Auto-create canvas entries for actionable facts
  │   Tagged: source='slack_auto', ID=slack-fact-{factId}
  └── Soft-delete past-date auto-entries

Cron (5min) → sendNotifications()
  ├── Morning-of (6-9am PST)
  ├── 2-hours-before
  └── Catch-up (backfill today's events)
  Each: LLM composes clean SMS → Twilio send → save enriched text to DB
```

### Sharing & Collaboration

```
Owner invites editor:
  POST /api/page-editors → { owner_user_id, editor_phone, shared_entry_id }
  IF editor has account → editor_user_id set
  ELSE → pending_phone (converted on first login)

Route: /:username → renders canvas
  IF isOwner OR isEditor → full edit mode
  ELSE → read-only view
```

## Database Schema

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `users` | id, phone, username (UNIQUE), bg_url, bg_uploads | User accounts |
| `entries` | id, text, position_x/y, parent_entry_id, user_id, text_html, media_card_data, link_cards_data, latex_data, background_image, deleted_at | All canvas content |
| `phone_verification_codes` | phone, code, expires_at | SMS auth |
| `google_tokens` | user_id, access/refresh_token, calendar_settings | Google OAuth |
| `page_editors` | owner_user_id, editor_user_id, shared_entry_id, pending_phone, role | Sharing (role: admin/member) |
| `sms_groups` | id, join_code, admin_phone, group_name | SMS groups |
| `sms_members` | phone, group_id, is_admin | Group membership |
| `sms_conversations` | phone, group_id, message_text, direction | SMS history |
| `slack_channels` | channel_id, channel_name, last_sync_ts | Synced channels |
| `slack_facts` | id, channel_id, extracted_fact, fact_type, deadline, status | Extracted facts |
| `slack_notifications` | user_phone, fact_id, notification_type, message_text | Notification log |

## Branching & Git Strategy

- **Main branch:** `master`
- **Active branches:** `feature/jarvis-sms-merge`, `beta`
- **Naming:** `feat/`, `fix/`, `bug/`, `refactor/`, `optimization/`
- **Deploy:** Push to master → Vercel auto-deploys
- **Completed branches:** background-images, canvas-chat, canvas-templates, deadlines-template-plus, images, media-autocomplete, text-format-bar

## Recent Changes Log

| Date | Change | Why | Impact |
|------|--------|-----|--------|
| 2026-03-11 | Add /login page + /api/auth/review-login for Google OAuth reviewer | Google OAuth verification requires test account login. Added email-based login restricted to allowlisted email, auto-creates `google-reviewer` user with JWT auth. | routes.js only — standalone HTML page + API endpoint. No frontend JS, api/ mirror, or auth middleware changes needed (routes.js is shared). Verified: existing phone auth, JWT flow, cookie handling all unchanged |
| 2026-03-11 | SMS admin shared entries: traversable trenches with bidirectional sync | Shared entries were non-navigable links to owner's home page. Now they load as real entries with descendants, support double-click navigation, and sync bidirectionally. | routes.js (load real entry+descendants via getEntryWithDescendants, add ownerUserId/ownerUsername, remove smsAdminLink), entries.js (register sharedEntryOwners, remove click handler, start sync for shared owners), article.js (set visibility on synced new entries). Verified: navigation, breadcrumb/URL, editor inheritance, save/update/delete pageOwnerId, server permissions, green border CSS, sync parentEntryId preservation all unchanged |
| 2026-03-11 | Rework Slack notifications: remove immediate SMS, add weekly digest, send to all members | Too noisy — every fact triggered instant SMS. Now: dated events get deadline_reminder only, non-dated facts go in Sunday 7PM PST weekly digest, ALL page members receive notifications | slack.js (removed initial notif type, isMaterialUpdate, simplified sync dedup, added sendWeeklyDigests, checkAndSendNotifications sends to all members), slack-db.js (getUndigestedFactsByEntry, markFactsDigested, getEntriesWithEnabledSyncs), db.js (digested_at column), routes.js (weekly-digest cron endpoint), vercel.json (Mon 3AM UTC cron). Verified: fact extraction, recency bias, auto canvas entries, deadline_reminder scheduling unchanged |
| 2026-03-11 | Fix sharing: trust server-side editor detection, restore SMS admin text+border style | Editor access failed because client required /api/auth/me success; SMS admin cards lost text. Shared cards condition too restrictive. | entries.js (editable trusts PAGE_IS_EDITOR, smsAdminLink keeps text+green border, shared cards load when PAGE_IS_OWNER without editable check) — sharing/editor flows fixed |
| 2026-03-11 | Admin sharing: navigate to owner's page + role support (admin/member) | Shared pages should open on owner's canvas like Google Docs, not inline. Members get read-only view. | db.js (role column, getEditorRole), routes.js (role-aware sharing, lightweight cards API), article.js (navigation cards instead of inline entries), entries.js (role-based editing, member sync), index.html (role selector), styles.css (card/role styles) — sharing flow rewritten, editor/sync flows updated |
| 2026-03-11 | Fix link card disappearing on sync + add daily link scraping for chat | Link card placeholders cleared by 3s sync poll; users want to query link content in chat | article.js (placeholder preservation), editor.js (targetEntryData fix), db.js (link_scrapes table), llm.js (scrapeUrlContent), routes.js (cron + immediate scrape), chat.js (scraped content in context), vercel.json (cron) — entry sync, link card, chat flows updated |
| 2026-03-09 | Landing page redesign: animations, tighter copy, ink interactions | Page felt bland and wordy | home.html rewritten — no app flows affected |
| 2026-03-08 | Fix link card race condition + increase file limit to 10MB | Link cards hidden by stale .editing class when placeEditorAtWorld fires during async commitEditor; file upload limit too low | editor.js (placeEditorAtWorld guard, .editing cleanup), media.js (10MB limit) — editor/commit flow updated |
| 2026-03-08 | Fix link card disappearing + file upload 413 | Link cards vanished when generateLinkCard failed; file uploads >4MB hit Vercel limit | editor.js, entries.js (3 link card load points), media.js — entry creation/load flows updated |
| 2026-03-08 | Fix page traversal: instant entry placement with fade-in, no panning | Entries appeared at wrong positions during nav animation | navigation.js, camera.js, styles.css — nav flow updated |
| 2026-03-08 | Batch multi-entry deletion: instant UI removal, parallel server calls | Entries deleted one-at-a-time visually | selection.js — delete flow updated |
| 2026-03-08 | Add pale red trash button in format bar when editing | UX: easy single-entry delete | index.html, styles.css, editor.js — editor flow updated |
| 2026-03-08 | Fix settings gear icon: SVG + format-btn aesthetic | Unicode gear looked inconsistent | index.html, styles.css — no flow impact |
| 2026-03-08 | Smooth pan/zoom: RAF batching, scrollbar debounce, GPU compositing | Pan/zoom was choppy | canvas.js, camera.js, styles.css — camera flow updated |
| 2026-03-07 | Fix content query: connect related facts, upgrade to gpt-4o | Better query accuracy | SMS bot query flow updated |
| 2026-03-07 | Move all SMS classification to LLM, remove regex | More flexible intent detection | sms-classifier.js rewritten |
| 2026-03-07 | Fix SMS: draft cancel safety, follow-up context, notification quality | Bug fixes | SMS flows verified |
| 2026-03-07 | Fix card persistence: media/link/image cards no longer disappear | Data loss bug | 3 entry load integration points patched |
| 2026-03-07 | Animate zoom-to-fit on page load | UX polish | Camera flow unchanged |
