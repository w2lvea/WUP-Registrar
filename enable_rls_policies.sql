-- ============================================================
-- Wesleyan University - Philippines (WUP) Registrar System
-- Enable Row Level Security (RLS) & Add CRUD Policies
-- 
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/eliqsjcbjgzbduxzlesc/sql/new
-- ============================================================

-- 1. Enable Row Level Security (RLS) on all tables
ALTER TABLE IF EXISTS students ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS official_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS request_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sessions ENABLE ROW LEVEL SECURITY;

-- 2. Clean up any existing policies
DROP POLICY IF EXISTS "Allow all access to students" ON students;
DROP POLICY IF EXISTS "Allow all access to staff" ON staff;
DROP POLICY IF EXISTS "Allow all access to documents" ON documents;
DROP POLICY IF EXISTS "Allow all access to fees" ON fees;
DROP POLICY IF EXISTS "Allow all access to official_receipts" ON official_receipts;
DROP POLICY IF EXISTS "Allow all access to requests" ON requests;
DROP POLICY IF EXISTS "Allow all access to request_items" ON request_items;
DROP POLICY IF EXISTS "Allow all access to request_timeline" ON request_timeline;
DROP POLICY IF EXISTS "Allow all access to sessions" ON sessions;

-- 3. Create permissive policies for the system
CREATE POLICY "Allow all access to students" ON students FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to staff" ON staff FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to documents" ON documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to fees" ON fees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to official_receipts" ON official_receipts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to requests" ON requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to request_items" ON request_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to request_timeline" ON request_timeline FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
