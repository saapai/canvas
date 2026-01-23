-- Add text_html column to entries table for preserving HTML formatting (bold, etc.)
ALTER TABLE entries 
ADD COLUMN IF NOT EXISTS text_html TEXT;
