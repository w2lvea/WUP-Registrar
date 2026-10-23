const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./hash');

// DB_DIR lets you point this at a mounted persistent disk in production (e.g. Render's
// persistent disk feature) without any code changes — just set the env var. Defaults to
// a local ./data folder, which is what runs on the free tier (see README).
const DATA_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'wup_registrar.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS students (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    course               TEXT NOT NULL,
    phone_number         TEXT NOT NULL DEFAULT '',
    password_hash        TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS staff (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    department    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    ref               TEXT PRIMARY KEY,
    student_id        TEXT NOT NULL REFERENCES students(id),
    or_number         TEXT NOT NULL,
    assessment_photo  TEXT,
    clearance_photo   TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'pending_verification',
    rejection_reason  TEXT NOT NULL DEFAULT '',
    date_submitted    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_items (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ref    TEXT NOT NULL REFERENCES requests(ref),
    name   TEXT NOT NULL,
    copies INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS request_timeline (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ref   TEXT NOT NULL REFERENCES requests(ref),
    title TEXT NOT NULL,
    time  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    role       TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id);
  CREATE INDEX IF NOT EXISTS idx_items_ref ON request_items(ref);
  CREATE INDEX IF NOT EXISTS idx_timeline_ref ON request_timeline(ref);
`);

// ---- Schema upgrades (safe to run on an existing database; nothing is deleted) ----
function hasColumn(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

// Registrar staff now have the same forced first-login password change as students.
// Existing staff accounts get the flag set to 1, so they change their password on next sign-in.
if (!hasColumn('staff', 'must_change_password')) {
  db.exec('ALTER TABLE staff ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1');
}
// Students can pick a username on top of their WUP ID (the ID stays the official record and always works to log in).
if (!hasColumn('students', 'username')) {
  db.exec("ALTER TABLE students ADD COLUMN username TEXT NOT NULL DEFAULT ''");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_username ON students(username COLLATE NOCASE) WHERE username != ''");
// Date the registrar picked for claiming (YYYY-MM-DD), set when a request is marked ready.
if (!hasColumn('requests', 'claim_date')) {
  db.exec("ALTER TABLE requests ADD COLUMN claim_date TEXT NOT NULL DEFAULT ''");
}
// Students and staff email & phone for OTP password recovery
if (!hasColumn('students', 'email')) {
  db.exec("ALTER TABLE students ADD COLUMN email TEXT NOT NULL DEFAULT ''");
}
if (!hasColumn('staff', 'email')) {
  db.exec("ALTER TABLE staff ADD COLUMN email TEXT NOT NULL DEFAULT ''");
}
if (!hasColumn('staff', 'phone_number')) {
  db.exec("ALTER TABLE staff ADD COLUMN phone_number TEXT NOT NULL DEFAULT ''");
}

db.exec(`
  -- One-Time Passwords (OTPs) for forgot-password verification
  CREATE TABLE IF NOT EXISTS password_reset_otps (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_type          TEXT NOT NULL,
    user_id            TEXT NOT NULL,
    delivery_method    TEXT NOT NULL,
    target_destination TEXT NOT NULL,
    otp_code           TEXT NOT NULL,
    reset_token        TEXT NOT NULL,
    change_token       TEXT,
    expires_at         INTEGER NOT NULL,
    used               INTEGER NOT NULL DEFAULT 0,
    attempts           INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_otps_reset_token ON password_reset_otps(reset_token);
  CREATE INDEX IF NOT EXISTS idx_otps_change_token ON password_reset_otps(change_token);
  CREATE INDEX IF NOT EXISTS idx_otps_user ON password_reset_otps(user_id);
`);

// Populate default contact details for demo accounts so OTP works out-of-the-box
try {
  db.prepare("UPDATE students SET email = 'davesabite@gmail.com', phone_number = '09171234567' WHERE id = 'WUP-24-1122-112' AND (email = '' OR phone_number = '')").run();
  db.prepare("UPDATE students SET email = 'llevajoshua54@gmail.com', phone_number = '09189876543' WHERE id = 'WUP-24-1123-132' AND (email = '' OR phone_number = '')").run();
  db.prepare("UPDATE students SET email = 'justineabello@gmail.com', phone_number = '09191112233' WHERE id = 'WUP-24-2045-881' AND (email = '' OR phone_number = '')").run();
  db.prepare("UPDATE students SET email = 'daphnecarvajal@gmail.com', phone_number = '09205556677' WHERE id = 'WUP-23-0941-008' AND (email = '' OR phone_number = '')").run();
  db.prepare("UPDATE students SET email = 'demo@wup.edu.ph', phone_number = '09214443322' WHERE id = 'WUP-11-1111-111' AND (email = '' OR phone_number = '')").run();
  db.prepare("UPDATE students SET email = 'demo1@wup.edu.ph', phone_number = '09227778899' WHERE id = 'WUP-11-1112-112' AND (email = '' OR phone_number = '')").run();
  db.prepare("UPDATE staff SET email = 'jelai@wup.edu.ph', phone_number = '09170001122' WHERE username = 'jelai' AND (email = '' OR phone_number = '')").run();
  db.prepare("UPDATE staff SET email = 'admin@wup.edu.ph', phone_number = '09170001122' WHERE username = 'registrar_admin' AND (email = '' OR phone_number = '')").run();
} catch (e) {
  console.warn('Could not update default contact info:', e.message);
}

db.exec(`
  -- Documents students can request. Managed from the registrar's Documents tab.
  -- Documents are switched off (active = 0) rather than deleted, so old requests keep working.
  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  -- Clearance Fees: a price reference only. It is not the list of requestable documents.
  CREATE TABLE IF NOT EXISTS fees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    price      REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  -- Official Receipts issued by the University Treasury / Cashier.
  -- Students cannot proceed if they put random OR numbers; the OR must exist in this table.
  CREATE TABLE IF NOT EXISTS official_receipts (
    or_number    TEXT PRIMARY KEY COLLATE NOCASE,
    student_id   TEXT NOT NULL DEFAULT '',
    student_name TEXT NOT NULL DEFAULT '',
    amount       REAL NOT NULL DEFAULT 0,
    description  TEXT NOT NULL DEFAULT '',
    date_issued  TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_receipts_student ON official_receipts(student_id);
`);

// ---- Seed only on first run (empty database) ----
const studentCount = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
if (studentCount === 0) {
  seed();
}

function seed() {
  const insertStudent = db.prepare(
    'INSERT INTO students (id, name, course, phone_number, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)'
  );
  const students = [
    { id: 'WUP-24-1122-112', name: 'Dave Sabite', course: 'BS Information Technology', phone: '' },
    { id: 'WUP-24-1123-132', name: 'Joshua Lleva', course: 'BS Information Technology', phone: '' },
    { id: 'WUP-24-2045-881', name: 'Justine Abello', course: 'BS Business Administration', phone: '' },
    { id: 'WUP-23-0941-008', name: 'Daphne Carvajal', course: 'BS Nursing', phone: '' },
    { id: 'WUP-11-1111-111', name: 'Demo', course: 'BS Information Technology', phone: '' },
    { id: 'WUP-11-1112-112', name: 'Demo1', course: 'BS Information Technology', phone: '' }
  ];
  students.forEach(s => {
    // default password = the numeric part of their ID (e.g. "24-1122-112"), same as before, now hashed.
    // must_change_password starts at 1 — they're forced to set a real password on first login.
    const defaultPassword = s.id.replace(/^WUP-/, '');
    insertStudent.run(s.id, s.name, s.course, s.phone, hashPassword(defaultPassword));
  });

  db.prepare('INSERT INTO staff (username, password_hash, name, department) VALUES (?, ?, ?, ?)')
    .run('registrar_admin', hashPassword('admin123'), 'Jeremiah Miguel Eugenio', 'Office of Records');

  const insertRequest = db.prepare(`
    INSERT INTO requests (ref, student_id, or_number, assessment_photo, status, rejection_reason, date_submitted, claim_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare('INSERT INTO request_items (ref, name, copies) VALUES (?, ?, ?)');
  const insertEvent = db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)');

  const seedRequests = [
    {
      ref: 'DOC-2026-1001',
      student_id: 'WUP-24-1122-112',
      or_number: 'OR-2026-88192',
      assessment_photo: 'Assessment_Form_Dave_Sabite_Term1.pdf',
      status: 'ready',
      rejection_reason: '',
      claim_date: '2026-10-30',
      date_submitted: '2026-09-21 09:30 AM',
      items: [
        { name: 'Certificate of Enrollment', copies: 1 },
        { name: 'Certificate of Grades', copies: 1 }
      ],
      timeline: [
        { title: 'Submitted Online with OR-2026-88192 & Assessment Form', time: '2026-09-21 09:30 AM' },
        { title: 'Verified by Registrar & Processing', time: '2026-09-22 08:45 AM' },
        { title: 'Ready to Claim at the Registrar Claiming Window', time: '2026-09-23 02:10 PM' }
      ]
    },
    {
      ref: 'DOC-2026-1002',
      student_id: 'WUP-24-1122-112',
      or_number: 'OR-2026-90412',
      assessment_photo: 'Assessment_Dave_Term2.jpg',
      status: 'pending_verification',
      rejection_reason: '',
      date_submitted: '2026-09-24 08:15 AM',
      items: [{ name: 'Certificate of Grades', copies: 2 }],
      timeline: [
        { title: 'Submitted Online with OR-2026-90412 & Assessment Form', time: '2026-09-24 08:15 AM' }
      ]
    },
    {
      ref: 'DOC-2026-0984',
      student_id: 'WUP-23-0941-008',
      or_number: 'OR-2026-77301',
      assessment_photo: 'Assessment_Form_Daphne.png',
      status: 'pending_verification',
      rejection_reason: '',
      date_submitted: '2026-09-24 10:20 AM',
      items: [{ name: 'Transcript of Records', copies: 1 }],
      timeline: [
        { title: 'Submitted Online with OR-2026-77301 & Assessment Form', time: '2026-09-24 10:20 AM' }
      ]
    },
    {
      ref: 'DOC-2026-1033',
      student_id: 'WUP-24-2045-881',
      or_number: 'OR-2026-66410',
      assessment_photo: 'Assessment_Form_Kiffy.jpg',
      status: 'pending_verification',
      rejection_reason: '',
      date_submitted: '2026-09-24 02:30 PM',
      items: [{ name: 'Certificate of Grades', copies: 1 }],
      timeline: [
        { title: 'Submitted Online with OR-2026-66410 & Assessment Form', time: '2026-09-24 02:30 PM' }
      ]
    }
  ];

  db.exec('BEGIN');
  try {
    for (const r of seedRequests) {
      insertRequest.run(r.ref, r.student_id, r.or_number, r.assessment_photo, r.status, r.rejection_reason, r.date_submitted, r.claim_date || '');
      r.items.forEach(it => insertItem.run(r.ref, it.name, it.copies));
      r.timeline.forEach(ev => insertEvent.run(r.ref, ev.title, ev.time));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}


// ---- Reference data (only filled when the tables are empty) ----
const DEFAULT_DOCUMENTS = [
  { name: 'Transcript of Records',  description: 'Processing time: 5-7 days' },
  { name: 'Certificate of Grades',  description: 'Processing time: 2-3 days' },
  { name: 'Certificate of Enrollment', description: 'Processing time: 1-2 days' }
];
if (db.prepare('SELECT COUNT(*) AS c FROM documents').get().c === 0) {
  const ins = db.prepare('INSERT INTO documents (name, description, active, sort_order) VALUES (?, ?, 1, ?)');
  DEFAULT_DOCUMENTS.forEach((d, i) => ins.run(d.name, d.description, i + 1));
}

const DEFAULT_FEES = [
  ['Diploma', 1000], ['Transcript of Records', 600], ['Honorable Dismissal', 550],
  ['Certificate of Grades', 150], ['Certificate of Enrollment', 150],
  ['Certification – Graduate', 150], ['Certificate – Others', 150],
  ['Print-out of Curriculum', 100], ['Print-out of Grades', 150],
  ['Scanning', 100], ['RLE', 200]
];
if (db.prepare('SELECT COUNT(*) AS c FROM fees').get().c === 0) {
  const ins = db.prepare('INSERT INTO fees (name, price, sort_order) VALUES (?, ?, ?)');
  DEFAULT_FEES.forEach((f, i) => ins.run(f[0], f[1], i + 1));
}

// ---- Rename old data to the new wording (idempotent) ----
// Full document names everywhere (no TOR / COG / COE) and "Rejected" becomes "Declined".
db.exec(`
  UPDATE request_items SET name = 'Transcript of Records'     WHERE name = 'Transcript of Records (TOR)';
  UPDATE request_items SET name = 'Certificate of Grades'     WHERE name = 'Certificate of Grades (COG)';
  UPDATE request_items SET name = 'Certificate of Enrollment' WHERE name = 'Certificate of Enrollment (COE)';
  UPDATE requests SET status = 'declined' WHERE status = 'rejected';
  UPDATE request_timeline SET title = 'Declined:' || substr(title, 10) WHERE title LIKE 'Rejected:%';
`);

// Each OR number can be used once. A declined request frees its OR number, so a student
// can resubmit with the same receipt. The unique index is the server-side safety net;
// it is skipped (not fatal) if an older database already contains duplicate OR numbers.
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_or_active
           ON requests(or_number) WHERE status != 'declined'`);
} catch (err) {
  console.warn('OR number unique index not created (existing duplicates?):', err.message);
}

// The registrar's display name no longer carries a job title. Fixes databases created earlier.
db.prepare("UPDATE staff SET name = 'Jeremiah Miguel Eugenio' WHERE name = 'Jeremiah Miguel Eugenio (Registrar Officer)'").run();

// ---- Sync existing request OR numbers into official_receipts so existing history remains intact ----
try {
  db.exec(`
    INSERT OR IGNORE INTO official_receipts (or_number, student_id, student_name, amount, description, date_issued)
    SELECT 
      TRIM(r.or_number),
      r.student_id,
      COALESCE(s.name, ''),
      150.0,
      'Treasury Clearance Receipt',
      COALESCE(SUBSTR(r.date_submitted, 1, 10), '2026-10-22')
    FROM requests r
    LEFT JOIN students s ON s.id = r.student_id
    WHERE r.or_number IS NOT NULL AND TRIM(r.or_number) != '';
  `);
} catch (err) {
  console.warn('Could not sync existing request OR numbers:', err.message);
}

// ---- Seed valid unused Official Receipts (issued by Treasury) ----
// Students must provide an OR number that exists in official_receipts.
const DEFAULT_RECEIPTS = [
  // General pool: valid unused receipts usable by any student
  { or: 'OR-2026-50001', studentId: '', name: '', amount: 150, desc: 'Certificate of Grades Fee', date: '2026-10-22' },
  { or: 'OR-2026-50002', studentId: '', name: '', amount: 150, desc: 'Certificate of Enrollment Fee', date: '2026-10-22' },
  { or: 'OR-2026-50003', studentId: '', name: '', amount: 300, desc: 'Certifications (2 Copies)', date: '2026-10-22' },
  { or: 'OR-2026-50004', studentId: '', name: '', amount: 600, desc: 'Transcript of Records Fee', date: '2026-10-22' },
  { or: 'OR-2026-50005', studentId: '', name: '', amount: 150, desc: 'Certificate – Others', date: '2026-10-22' },
  { or: 'OR-2026-50006', studentId: '', name: '', amount: 200, desc: 'RLE Document Fee', date: '2026-10-22' },
  { or: 'OR-2026-50007', studentId: '', name: '', amount: 450, desc: 'Document Package Fee', date: '2026-10-22' },
  { or: 'OR-2026-50008', studentId: '', name: '', amount: 600, desc: 'Transcript of Records Fee', date: '2026-10-22' },
  { or: 'OR-2026-50009', studentId: '', name: '', amount: 1000, desc: 'Diploma Reissuance Fee', date: '2026-10-22' },
  { or: 'OR-2026-50010', studentId: '', name: '', amount: 150, desc: 'Official Treasury Receipt', date: '2026-10-22' },

  // Assigned student receipts for registered test students
  { or: 'OR-2026-22001', studentId: 'WUP-24-1123-132', name: 'Joshua Lleva', amount: 150, desc: 'Certificate of Grades', date: '2026-10-22' },
  { or: 'OR-2026-22002', studentId: 'WUP-24-1123-132', name: 'Joshua Lleva', amount: 600, desc: 'Transcript of Records', date: '2026-10-22' },
  { or: 'OR-2026-11001', studentId: 'WUP-24-1122-112', name: 'Dave Sabite', amount: 150, desc: 'Certificate of Enrollment', date: '2026-10-22' },
  { or: 'OR-2026-11002', studentId: 'WUP-24-1122-112', name: 'Dave Sabite', amount: 300, desc: 'Certifications', date: '2026-10-22' },
  { or: 'OR-2026-33001', studentId: 'WUP-24-2045-881', name: 'Justine Abello', amount: 150, desc: 'Certificate of Grades', date: '2026-10-22' },
  { or: 'OR-2026-44001', studentId: 'WUP-23-0941-008', name: 'Daphne Carvajal', amount: 150, desc: 'Certificate of Enrollment', date: '2026-10-22' },
  { or: 'OR-2026-10001', studentId: 'WUP-11-1111-111', name: 'Demo', amount: 150, desc: 'Certificate of Grades', date: '2026-10-22' },
  { or: 'OR-2026-10002', studentId: 'WUP-11-1112-112', name: 'Demo1', amount: 150, desc: 'Certificate of Enrollment', date: '2026-10-22' }
];

const insertReceiptStmt = db.prepare(`
  INSERT OR IGNORE INTO official_receipts (or_number, student_id, student_name, amount, description, date_issued)
  VALUES (?, ?, ?, ?, ?, ?)
`);
DEFAULT_RECEIPTS.forEach(r => insertReceiptStmt.run(r.or, r.studentId, r.name, r.amount, r.desc, r.date));

module.exports = db;

