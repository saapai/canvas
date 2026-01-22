# Database Migration: User-Specific Entry IDs

## Problem
Entry IDs were global (`entry-1`, `entry-2`), causing overwrites when different users created entries with the same ID.

## Solution
Migrated to user-specific IDs: `{user_id_prefix}-entry-{number}` (e.g., `f4bc717b-entry-1`)

## Migration Steps

### 1. Run Database Migration
Execute `database-migration-user-specific-ids.sql` in Supabase SQL Editor.

This will:
- Create `user_entry_counters` table to track per-user entry numbers
- Create `generate_user_entry_id()` function
- Add trigger to auto-generate IDs if client doesn't provide user-specific format
- Maintain backward compatibility with existing entries

### 2. Code Changes
- ✅ Updated `public/app.js` to generate user-specific IDs client-side
- ✅ Database trigger handles auto-generation as fallback
- ✅ Both `api/db.js` and `server/db.js` work with new format

### 3. Data Recovery
Run `RESTORE_ALL_MISSING.sql` to restore 15 overwritten entries from backups.

## Verification

After migration, test by creating a new entry:
```sql
-- Check that new entries use user-specific format
SELECT id, user_id, text 
FROM entries 
WHERE id ~ '^[a-f0-9]{8}-entry-[0-9]+$'
ORDER BY created_at DESC
LIMIT 10;
```

## Benefits
- ✅ **No more overwrites** - Each user has their own ID namespace
- ✅ **Backward compatible** - Old entries still work
- ✅ **Auto-generation** - Database handles ID generation if client doesn't
- ✅ **Data integrity** - Guaranteed unique IDs per user
