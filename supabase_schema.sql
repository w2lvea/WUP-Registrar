-- ============================================================
-- Wesleyan University - Philippines (WUP) Registrar System
-- Supabase (PostgreSQL) Schema & Base Data Migration Script
--
-- How to apply this script:
-- 1. Open your Supabase Dashboard: https://supabase.com/dashboard
-- 2. Select your project -> Click "SQL Editor" in the left sidebar
-- 3. Click "New query", paste this entire script, and click "Run"
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Students Table
CREATE TABLE IF NOT EXISTS students (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  course               TEXT NOT NULL,
  phone_number         TEXT NOT NULL DEFAULT '',
  email                TEXT NOT NULL DEFAULT '',
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  username             TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_username ON students(LOWER(username)) WHERE username != '';

-- 2. Staff Table
CREATE TABLE IF NOT EXISTS staff (
  username             TEXT PRIMARY KEY,
  password_hash        TEXT NOT NULL,
  name                 TEXT NOT NULL,
  department           TEXT NOT NULL,
  email                TEXT NOT NULL DEFAULT '',
  phone_number         TEXT NOT NULL DEFAULT '',
  must_change_password INTEGER NOT NULL DEFAULT 1
);

-- 3. Documents Table (requestable documents)
CREATE TABLE IF NOT EXISTS documents (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 4. Fees Table (price reference)
CREATE TABLE IF NOT EXISTS fees (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  price      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 5. Official Receipts Table (Treasury records)
CREATE TABLE IF NOT EXISTS official_receipts (
  or_number    TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL DEFAULT '',
  student_name TEXT NOT NULL DEFAULT '',
  amount       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  description  TEXT NOT NULL DEFAULT '',
  date_issued  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_receipts_student ON official_receipts(student_id);

-- 6. Requests Table
CREATE TABLE IF NOT EXISTS requests (
  ref              TEXT PRIMARY KEY,
  student_id       TEXT NOT NULL REFERENCES students(id),
  or_number        TEXT NOT NULL,
  assessment_photo TEXT,
  clearance_photo  TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'pending_verification',
  rejection_reason TEXT NOT NULL DEFAULT '',
  claim_date       TEXT NOT NULL DEFAULT '',
  date_submitted   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id);

-- 7. Request Items Table
CREATE TABLE IF NOT EXISTS request_items (
  id     BIGSERIAL PRIMARY KEY,
  ref    TEXT NOT NULL REFERENCES requests(ref) ON DELETE CASCADE,
  name   TEXT NOT NULL,
  copies INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_items_ref ON request_items(ref);

-- 8. Request Timeline Table
CREATE TABLE IF NOT EXISTS request_timeline (
  id    BIGSERIAL PRIMARY KEY,
  ref   TEXT NOT NULL REFERENCES requests(ref) ON DELETE CASCADE,
  title TEXT NOT NULL,
  time  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_timeline_ref ON request_timeline(ref);

-- 9. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  role       TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

-- 10. Password Reset OTPs Table
CREATE TABLE IF NOT EXISTS password_reset_otps (
  id                 BIGSERIAL PRIMARY KEY,
  user_type          TEXT NOT NULL,
  user_id            TEXT NOT NULL,
  delivery_method    TEXT NOT NULL,
  target_destination TEXT NOT NULL,
  otp_code           TEXT NOT NULL,
  reset_token        TEXT NOT NULL,
  change_token       TEXT,
  expires_at         BIGINT NOT NULL,
  used               INTEGER NOT NULL DEFAULT 0,
  attempts           INTEGER NOT NULL DEFAULT 0,
  created_at         BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otps_reset_token ON password_reset_otps(reset_token);
CREATE INDEX IF NOT EXISTS idx_otps_change_token ON password_reset_otps(change_token);
CREATE INDEX IF NOT EXISTS idx_otps_user ON password_reset_otps(user_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================
-- 1. Enable Row Level Security on all tables
ALTER TABLE IF EXISTS students ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS official_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS request_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS password_reset_otps ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if any
DROP POLICY IF EXISTS "Allow all access to students" ON students;
DROP POLICY IF EXISTS "Allow all access to staff" ON staff;
DROP POLICY IF EXISTS "Allow all access to documents" ON documents;
DROP POLICY IF EXISTS "Allow all access to fees" ON fees;
DROP POLICY IF EXISTS "Allow all access to official_receipts" ON official_receipts;
DROP POLICY IF EXISTS "Allow all access to requests" ON requests;
DROP POLICY IF EXISTS "Allow all access to request_items" ON request_items;
DROP POLICY IF EXISTS "Allow all access to request_timeline" ON request_timeline;
DROP POLICY IF EXISTS "Allow all access to sessions" ON sessions;
DROP POLICY IF EXISTS "Allow all access to password_reset_otps" ON password_reset_otps;

-- 3. Create full CRUD policies allowing access for app operations
CREATE POLICY "Allow all access to students" ON students FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to staff" ON staff FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to documents" ON documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to fees" ON fees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to official_receipts" ON official_receipts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to requests" ON requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to request_items" ON request_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to request_timeline" ON request_timeline FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to password_reset_otps" ON password_reset_otps FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Students
INSERT INTO students (id, name, course, phone_number, password_hash, must_change_password, username) VALUES
  ('WUP-24-1122-112', 'Dave Sabite', 'BS Information Technology', '', 'scrypt:e2ff5a8b274537233f9cebde9033bc0c:58f117e43a11b3c6464eaebc93b5b4ef305292b278a7faab0e6f796b6365b3f171d1ab885fd1755cb1586b172fe7422b5883ecfdcd4e1d5766cbf1bde4b30907', 1, 'dave'),
  ('WUP-24-1123-132', 'Joshua Lleva', 'BS Information Technology', '', 'scrypt:00a5d2fe3475a62c27c2146c01544cb9:5452169772db367e6bee6fb6a8f98dbf2c864b1bb3e17253b29639af3731df4f7963b49ff709821c591d7db4ec0cc2fb23f9f3e3a0f8da89e7c06a7588f715e3', 1, ''),
  ('WUP-24-2045-881', 'Justine Abello', 'BS Business Administration', '', 'scrypt:e097318afff1d83519d16cf011c4875e:a9e1b8002c002f1544b47acd4f25670a174ccc3a4d30dcd8977c29679af9a57fa1154a3a5be5f0cd65af1aac95655e8fe3ed8772ac50a206cd361e4f22956b99', 1, ''),
  ('WUP-23-0941-008', 'Daphne Carvajal', 'BS Nursing', '', 'scrypt:b56c1847dcf578439a79c99cbeea49e4:f1b124ef016da5a06286827dfda0b7ab2d21cddb63e933461de5af9d7792aa955fd9fbda3ae5a8da09db5ff9a0b350a8f05502388de02ae961bbbec14a7f080b', 1, 'daphne'),
  ('WUP-11-1111-111', 'Demo', 'BS Information Technology', '', 'scrypt:9c8e0b48a88de2b0694e658099fdbf20:76b8e0a90c1d7218898dc49dd1054858017fdabfe115d56484925c70f9a10545fba91b2f27be681a0a4fe41f979dced29f70b3851a26023b45662c63aae8623a', 1, ''),
  ('WUP-11-1112-112', 'Demo1', 'BS Information Technology', '', 'scrypt:1772b2aeea44e97b42e5fc330503a0f9:dde394789544de1c6aa5b3dc8077051df4ff3e6e039aae3fe1684cde15e2c6ab2c2cbacc51d15a155731b2bb134542c30da0fc5281d0ef0af177a29ddd42d91e', 1, '')
ON CONFLICT (id) DO NOTHING;

-- Staff
INSERT INTO staff (username, password_hash, name, department, must_change_password) VALUES
  ('jelai', 'scrypt:4d297ffc9bdb4a262088a32099e6ec3d:ac94e0b3c902585bb295dca52d564074933336708f03d86351115e636c9422616f0e8055444310e08b8c29f4e2523b92fa7119e66ac4639a410654414a04d652', 'Jeremiah Miguel Eugenio', 'Office of Records', 0)
ON CONFLICT (username) DO NOTHING;

-- Documents
INSERT INTO documents (name, description, active, sort_order) VALUES
  ('Transcript of Records', 'Processing time: 5-7 days', 1, 1),
  ('Certificate of Grades', 'Processing time: 2-3 days', 1, 2),
  ('Certificate of Enrollment', 'Processing time: 1-2 days', 1, 3)
ON CONFLICT (name) DO NOTHING;

-- Clearance Fees
INSERT INTO fees (name, price, sort_order) VALUES
  ('Diploma', 1500, 1),
  ('Transcript of Records', 600, 2),
  ('Honorable Dismissal', 550, 3),
  ('Certificate of Grades', 150, 4),
  ('Certificate of Enrollment', 150, 5),
  ('Certification – Graduate', 150, 6),
  ('Certificate – Others', 150, 7),
  ('Print-out of Curriculum', 100, 8),
  ('Print-out of Grades', 150, 9),
  ('Scanning', 100, 10),
  ('RLE', 200, 11)
ON CONFLICT (name) DO NOTHING;

-- Official Receipts (Treasury Records)
INSERT INTO official_receipts (or_number, student_id, student_name, amount, description, date_issued) VALUES
  ('OR-2026-88192', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Treasury Clearance Receipt', '2026-09-21'),
  ('OR-2026-90412', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Treasury Clearance Receipt', '2026-09-24'),
  ('OR-2026-77301', 'WUP-23-0941-008', 'Daphne Carvajal', 150, 'Treasury Clearance Receipt', '2026-09-24'),
  ('OR-2026-66410', 'WUP-24-2045-881', 'Justine Abello', 150, 'Treasury Clearance Receipt', '2026-09-24'),
  ('OR-2026-21354', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21344', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21322', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21425', 'WUP-23-0941-008', 'Daphne Carvajal', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-24548', 'WUP-23-0941-008', 'Daphne Carvajal', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-45145', 'WUP-23-0941-008', 'Daphne Carvajal', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21456', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21548', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21452', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21457', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21454', 'WUP-23-0941-008', 'Daphne Carvajal', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2024-2912', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2024-2941', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-21458', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-22002', 'WUP-24-1123-132', 'Joshua Lleva', 600, 'Transcript of Records', '2026-10-22'),
  ('OR-294-2949', 'WUP-294-2849', 'Joshua Lleva', 150, 'Document Request Fee', '2026-10-23'),
  ('20-20205', 'WUP-23-0941-008', 'Daphne Carvajal', 150, 'Treasury Clearance Receipt', '10/22/2026'),
  ('OR-2026-22001', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Certificate of Grades', '2026-10-22'),
  ('OR-2026-11001', 'WUP-24-1122-112', 'Dave Sabite', 150, 'Certificate of Enrollment', '2026-10-22'),
  ('OR-2026-11002', 'WUP-24-1122-112', 'Dave Sabite', 300, 'Certifications', '2026-10-22'),
  ('OR-2026-33001', 'WUP-24-2045-881', 'Justine Abello', 150, 'Certificate of Grades', '2026-10-22'),
  ('OR-2026-44001', 'WUP-23-0941-008', 'Daphne Carvajal', 150, 'Certificate of Enrollment', '2026-10-22'),
  ('OR-2026-10001', 'WUP-11-1111-111', 'Demo', 150, 'Certificate of Grades', '2026-10-22'),
  ('OR-2026-10002', 'WUP-11-1112-112', 'Demo1', 150, 'Certificate of Enrollment', '2026-10-22'),
  ('OR-2026-90413', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90414', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90415', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90416', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90417', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90418', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90419', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90420', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90421', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90422', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90423', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90424', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90425', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90426', 'WUP-24-1123-132', 'Joshua Lleva', 150, 'Auto-generated Treasury Receipt', '2026-10-23'),
  ('OR-2026-90427', 'WUP-24-2045-881', 'Justine Abello', 150, 'Document Request Fee', '2026-10-23'),
  ('OR-2026-90428', 'WUP-11-1111-111', 'Demo', 150, 'Transcript of Records Fee', '2026-10-23'),
  ('OR-2026-90429', 'WUP-11-1111-111', 'Demo', 150, 'Transcript of Records Fee', '2026-10-23')
ON CONFLICT (or_number) DO NOTHING;
