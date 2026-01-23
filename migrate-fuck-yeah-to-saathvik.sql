-- Migration: Move entries from fuck-yeah to Saathvik
-- This fixes entries that were incorrectly assigned to the wrong user_id

-- User IDs
-- Saathvik: 9703fd4e-fac9-4b7d-bbde-2e99ce0b1237
-- fuck-yeah: 170e2d8a-e93f-4061-b207-3127229a17af

-- Step 1: Check how many entries need to be migrated
SELECT 
  COUNT(*) as entries_to_migrate,
  'fuck-yeah entries (non-deleted)' as description
FROM entries 
WHERE user_id = '170e2d8a-e93f-4061-b207-3127229a17af' 
  AND deleted_at IS NULL;

-- Step 2: Preview sample entries that will be migrated
SELECT 
  id,
  LEFT(text, 50) as text_preview,
  created_at,
  user_id
FROM entries 
WHERE user_id = '170e2d8a-e93f-4061-b207-3127229a17af' 
  AND deleted_at IS NULL 
ORDER BY created_at DESC 
LIMIT 10;

-- Step 3: Perform the migration
-- WARNING: This will UPDATE entries! Make sure you've reviewed the preview above.
-- Uncomment the lines below to execute the migration:

/*
UPDATE entries 
SET user_id = '9703fd4e-fac9-4b7d-bbde-2e99ce0b1237' 
WHERE user_id = '170e2d8a-e93f-4061-b207-3127229a17af' 
  AND deleted_at IS NULL;
*/

-- Step 4: Verify migration (run after uncommenting and executing Step 3)
SELECT 
  COUNT(*) as remaining_fuck_yeah_entries
FROM entries 
WHERE user_id = '170e2d8a-e93f-4061-b207-3127229a17af' 
  AND deleted_at IS NULL;

-- Step 5: Check total entries for Saathvik after migration
SELECT 
  COUNT(*) as total_saathvik_entries
FROM entries 
WHERE user_id = '9703fd4e-fac9-4b7d-bbde-2e99ce0b1237' 
  AND deleted_at IS NULL;

-- Step 6: View both users' entry counts side by side
SELECT 
  u.username,
  u.id as user_id,
  COUNT(e.id) as entry_count
FROM users u
LEFT JOIN entries e ON e.user_id = u.id AND e.deleted_at IS NULL
WHERE u.id IN ('9703fd4e-fac9-4b7d-bbde-2e99ce0b1237', '170e2d8a-e93f-4061-b207-3127229a17af')
GROUP BY u.id, u.username
ORDER BY u.created_at ASC;
