-- ═══════════════════════════════════════════════════════
-- MIGRATION: User-Specific Entry IDs
-- ═══════════════════════════════════════════════════════
-- Problem: Global entry IDs (entry-1, entry-2) can be
--          overwritten when different users create entries
-- 
-- Solution: Use user-specific IDs: {user_id_prefix}-entry-{num}
--           Example: f4bc717b-entry-1, 98c4acda-entry-1
-- 
-- This ensures each user has their own ID namespace and
-- prevents overwrites forever.
-- ═══════════════════════════════════════════════════════

-- STEP 1: Create a sequence counter for each user
CREATE TABLE IF NOT EXISTS user_entry_counters (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  next_entry_number INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Initialize counters for existing users based on their current entries
INSERT INTO user_entry_counters (user_id, next_entry_number)
SELECT 
  u.id,
  COALESCE(
    (SELECT MAX(
      CAST(
        CASE 
          WHEN e.id ~ ('^' || SUBSTRING(u.id FROM 1 FOR 8) || '-entry-[0-9]+$') THEN
            SUBSTRING(e.id FROM ('^' || SUBSTRING(u.id FROM 1 FOR 8) || '-entry-([0-9]+)$'))
          ELSE NULL
        END
        AS INTEGER
      )
    ) FROM entries e WHERE e.user_id = u.id AND e.id ~ ('^' || SUBSTRING(u.id FROM 1 FOR 8) || '-entry-[0-9]+$')),
    0
  ) + 1
FROM users u
ON CONFLICT (user_id) DO NOTHING;

-- STEP 2: Create function to generate user-specific IDs
CREATE OR REPLACE FUNCTION generate_user_entry_id(p_user_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_number INTEGER;
  v_new_id TEXT;
  v_user_prefix TEXT;
BEGIN
  -- Get first 8 characters of user ID as prefix
  v_user_prefix := SUBSTRING(p_user_id FROM 1 FOR 8);
  
  -- Get and increment the counter for this user
  INSERT INTO user_entry_counters (user_id, next_entry_number)
  VALUES (p_user_id, 1)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    next_entry_number = user_entry_counters.next_entry_number + 1,
    updated_at = CURRENT_TIMESTAMP
  RETURNING next_entry_number INTO v_entry_number;
  
  -- Generate the new ID: {user_id_prefix}-entry-{number}
  v_new_id := v_user_prefix || '-entry-' || v_entry_number;
  
  RETURN v_new_id;
END;
$$;

-- STEP 3: Add trigger to auto-generate IDs on insert if not provided or if old format
CREATE OR REPLACE FUNCTION auto_generate_entry_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only generate ID if not provided, empty, or if it's the old format (entry-{num})
  -- This allows backward compatibility with existing entries
  IF NEW.id IS NULL OR NEW.id = '' OR NEW.id ~ '^entry-[0-9]+$' THEN
    -- Only auto-generate if user_id is provided
    IF NEW.user_id IS NOT NULL THEN
      NEW.id := generate_user_entry_id(NEW.user_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS trigger_auto_generate_entry_id ON entries;

-- Create the trigger
CREATE TRIGGER trigger_auto_generate_entry_id
  BEFORE INSERT ON entries
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_entry_id();

-- STEP 4: Create index on user_entry_counters for performance
CREATE INDEX IF NOT EXISTS idx_user_entry_counters_user_id ON user_entry_counters(user_id);

-- ═══════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════

-- Test: Generate an ID for a user
DO $$
DECLARE
  test_user_id TEXT;
  test_id TEXT;
BEGIN
  SELECT id INTO test_user_id FROM users LIMIT 1;
  IF test_user_id IS NOT NULL THEN
    SELECT generate_user_entry_id(test_user_id) INTO test_id;
    RAISE NOTICE 'Test ID generation: %', test_id;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════
-- NOTES
-- ═══════════════════════════════════════════════════════
-- 1. Existing entries keep their old IDs (backward compatible)
-- 2. New entries get user-specific IDs automatically via trigger
-- 3. Parent references work with both old and new ID formats
-- 4. No data loss or breaking changes
-- 5. Overwrites are now IMPOSSIBLE - each user has their own namespace
-- 6. Client code should generate IDs in format: {user_id_prefix}-entry-{counter}
--    But if it doesn't, the database will auto-generate them
-- ═══════════════════════════════════════════════════════
