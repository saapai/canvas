# DuttaPad Features — Status & Changelog

## Canvas Core

| Feature | Status | Notes |
|---------|--------|-------|
| Infinite 2D canvas with pan/zoom | Implemented | `cam = { x, y, z }`, scroll=pan, pinch=zoom |
| Click anywhere to type | Implemented | Single contenteditable div repositioned on click |
| Ink-bleed melt animation | Implemented | `meltify()` wraps chars in staggered-delay spans |
| Entry persistence (PostgreSQL) | Implemented | Soft deletes via `deleted_at` |
| Nested entries (trenches) | Implemented | Double-click navigates in, breadcrumb navigates back |
| Zoom-to-fit on navigation | Implemented | Zooms in AND out to fit content; instant on initial load, animated on nav |
| Scroll = Pan | Implemented | Mouse wheel pans; pinch-to-zoom via trackpad (ctrlKey) and mobile touch |
| Virtual scrollbar | Implemented | Notion-style: always visible (faint) when content overflows, brighter on scroll, draggable |
| Mobile double-tap navigation | Implemented | Manual double-tap detector for touch devices (350ms window) |
| Per-page backgrounds | Implemented | Each subpage stores its own `background_image`/`background_uploads`; root uses user-level bg |
| Undo/redo | Implemented | Entry-level undo stack |
| Multi-select & drag | Implemented | Lasso select, multi-drag with undo |
| Entry resize | Implemented | Drag handles on selected entries |

## Entry Types

| Type | Status | Notes |
|------|--------|-------|
| Plain text | Implemented | Contenteditable with formatting toolbar (bold, italic, etc.) |
| Deadline table | Implemented | `deadline-table` class, interactive cells |
| Calendar card | Implemented | Google Calendar integration, monthly grid view |
| Media cards (Movie/Song) | Implemented | TMDB (movies), Spotify (songs) via autocomplete |
| Image entries | Implemented | Supabase upload, inline display |
| Link cards | Implemented | Auto-preview for URLs pasted in entries |
| LaTeX entries | Implemented | Plain English → GPT-4o-mini → KaTeX rendering |

## Authentication & Users

| Feature | Status | Notes |
|---------|--------|-------|
| Phone → SMS → JWT auth | Implemented | Twilio SMS verification, 30-day HTTP-only cookie |
| Multiple usernames per phone | Implemented | User can switch between spaces |
| User pages (`/:username`) | Implemented | Public read-only or owner edit |
| Page editors (sharing) | Implemented | Invite by phone, collaborative editing |

## SMS Bot (Jarvis)

| Feature | Status | Notes |
|---------|--------|-------|
| SMS group management | Implemented | Join codes, member list, admin roles |
| Announcements | Implemented | Admin drafts → send to all members |
| Polls (yes/no/maybe) | Implemented | With optional excuse requirement for "no" |
| Content queries | Implemented | Ask questions about page content, Slack facts, announcements |
| Follow-up question resolution | Implemented | Bot uses conversation history + recent notifications to resolve "what work?", "what form?" |
| Personality/casual tone | Implemented | LLM personality layer for responses |
| Answer quality evaluation | Implemented | Flags unanswered questions for later recheck |

## Slack Integration

| Feature | Status | Notes |
|---------|--------|-------|
| Channel sync | Implemented | Fetch messages, extract facts via LLM, 30-min cron |
| Fact extraction | Implemented | Preserves specific details (form names, URLs, actions); handles reply context |
| Recency bias handling | Implemented | Supersedes outdated facts when new info arrives |
| Notification scheduling | Implemented | Morning-of, 2-hours-before, catch-up notifications via SMS |
| Enriched notifications | Implemented | LLM composes clean SMS from all today's facts; enriched message saved to DB |
| Auto-entry creation | Implemented | Actionable Slack facts (deadline/event/announcement) auto-create canvas entries |
| Auto-cleanup old entries | Implemented | Past-date auto-created entries soft-deleted on sync |

## Background & Theming

| Feature | Status | Notes |
|---------|--------|-------|
| User-level background | Implemented | Upload or choose preset, stored in users table |
| Per-page background | Implemented | Each subpage can have independent background |
| Background picker dropdown | Implemented | Upload, presets, none; right-click to delete uploads |

## Google Calendar

| Feature | Status | Notes |
|---------|--------|-------|
| OAuth integration | Implemented | Access/refresh tokens, calendar settings |
| Calendar card widget | Implemented | Monthly view with events from Google Calendar |

---

## Changelog

### 2026-03-07 — Canvas UX + Bot Intelligence + Auto-Entries

**Frontend:**
- Changed scroll behavior: mouse wheel = pan, trackpad pinch (ctrlKey) = zoom
- Added Notion-style virtual scrollbar (always visible when content overflows, faint → brighter on activity, draggable)
- Fixed zoom-to-fit: now zooms both in AND out to fit content on navigation (removed `Math.min(clampedZoom, cam.z)`)
- Added mobile double-tap detection for navigating into entries
- Implemented per-page backgrounds (each subpage stores its own background independently)
- Initial page load: instant zoom-to-fit (no 800ms animation pan)

**Backend — Bot:**
- Improved Slack fact extraction prompt: preserves specific details (form names, URLs, exact actions), handles reply messages (`^` prefix)
- Fixed conversation context bug: `m.message_text` → `m.text` (field name mismatch, context was all `undefined`)
- Content queries now include conversation history + recent notifications for follow-up resolution
- Recent notifications now fetched with underlying fact's `raw_text` for full context tracing
- Strengthened follow-up prompt: LLM instructed to trace notification → fact → original Slack message
- Enriched notification messages now saved back to DB (`markNotificationSent` stores final text)
- Notification enrichment prompt: never generalize action items, combine adjacent related facts

**Backend — Auto-Entries:**
- Actionable Slack facts (deadline/event/announcement) auto-create canvas entries under the synced page
- Entries tagged with `source: 'slack_auto'` in mediaCardData, ID format `slack-fact-{factId}`
- Old auto-created entries (past deadline) soft-deleted on each `syncAllChannels()` run

**Backend — DB:**
- Added `background_image TEXT` and `background_uploads JSONB` columns to entries table
- Added `GET/PUT /api/entries/:id/background` endpoints
- Added `getEntryBackground()` and `setEntryBackground()` to shared/db.js, server/db.js, api/db.js
