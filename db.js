const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./hash');

// Load environment variables if .env exists
if (fs.existsSync(path.join(__dirname, '.env'))) {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) {}
}

const DATABASE_URL = process.env.DATABASE_URL;

let db;

if (DATABASE_URL) {
  // =============================================================
  // Supabase (PostgreSQL) Mode
  // =============================================================
  const { Pool, types } = require('pg');

  // Parse BIGINT (type 20) as integer so counts & timestamps are JS numbers
  types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));
  // Parse NUMERIC (type 1700) as float so prices/amounts are JS numbers
  types.setTypeParser(1700, val => (val === null ? null : parseFloat(val)));

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  function toPgSql(sql) {
    let i = 1;
    let inStr = false;
    let out = '';
    for (let j = 0; j < sql.length; j++) {
      const char = sql[j];
      if (char === "'" && (j === 0 || sql[j - 1] !== '\\')) {
        inStr = !inStr;
        out += char;
      } else if (char === '?' && !inStr) {
        out += `$${i++}`;
      } else {
        out += char;
      }
    }
    out = out.replace(/ORDER BY\s+r\.rowid\s+DESC/gi, 'ORDER BY r.date_issued DESC, r.or_number DESC');
    out = out.replace(/FROM\s+official_receipts\s+ORDER BY\s+rowid\s+DESC/gi, 'FROM official_receipts ORDER BY date_issued DESC, or_number DESC');
    out = out.replace(/ORDER BY\s+rowid\s+DESC/gi, 'ORDER BY date_submitted DESC, ref DESC');
    return out;
  }

  db = {
    isPostgres: true,
    pool,
    prepare(sql) {
      let pgSql = toPgSql(sql);
      const isInsertWithId = /INSERT\s+INTO\s+(documents|fees|request_items|request_timeline|password_reset_otps)/i.test(pgSql);
      if (isInsertWithId && !/RETURNING/i.test(pgSql)) {
        pgSql += ' RETURNING id';
      }

      return {
        async get(...args) {
          const flatArgs = args.flat();
          const res = await pool.query(pgSql, flatArgs);
          return res.rows[0] || null;
        },
        async all(...args) {
          const flatArgs = args.flat();
          const res = await pool.query(pgSql, flatArgs);
          return res.rows;
        },
        async run(...args) {
          const flatArgs = args.flat();
          const res = await pool.query(pgSql, flatArgs);
          return {
            changes: res.rowCount || 0,
            lastInsertRowid: res.rows[0]?.id || null
          };
        }
      };
    },
    async query(sql, params = []) {
      const pgSql = toPgSql(sql);
      const res = await pool.query(pgSql, params.flat());
      return res.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    }
  };
} else if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // Running in Vercel serverless environment but DATABASE_URL was not set!
  console.error('[CRITICAL] DATABASE_URL is not set in Vercel Environment Variables!');
  console.error('[CRITICAL] Please go to Vercel Dashboard -> Project Settings -> Environment Variables, add DATABASE_URL, and redeploy.');
  db = {
    isPostgres: false,
    prepare() {
      return {
        async get() { return null; },
        async all() { return []; },
        async run() {
          throw new Error('DATABASE_URL is not configured in Vercel Environment Variables. Please set DATABASE_URL in Vercel Project Settings and redeploy.');
        }
      };
    },
    async query() { return []; },
    async exec() {
      throw new Error('DATABASE_URL is not configured in Vercel Environment Variables.');
    }
  };
} else {
  // =============================================================
  // SQLite Local Fallback Mode (node:sqlite)
  // =============================================================
  const { DatabaseSync } = require('node:sqlite');
  const DATA_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const DB_PATH = path.join(DATA_DIR, 'wup_registrar.db');
  const sqliteDb = new DatabaseSync(DB_PATH);

  sqliteDb.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_requests_or ON requests(or_number);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_items_ref ON request_items(ref);
    CREATE INDEX IF NOT EXISTS idx_timeline_ref ON request_timeline(ref);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  function hasColumn(table, col) {
    return sqliteDb.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  }

  if (!hasColumn('staff', 'must_change_password')) {
    sqliteDb.exec('ALTER TABLE staff ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1');
  }
  if (!hasColumn('students', 'username')) {
    sqliteDb.exec("ALTER TABLE students ADD COLUMN username TEXT NOT NULL DEFAULT ''");
  }
  sqliteDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_username ON students(username COLLATE NOCASE) WHERE username != ''");
  if (!hasColumn('requests', 'claim_date')) {
    sqliteDb.exec("ALTER TABLE requests ADD COLUMN claim_date TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn('students', 'email')) {
    sqliteDb.exec("ALTER TABLE students ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn('staff', 'email')) {
    sqliteDb.exec("ALTER TABLE staff ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }
  if (!hasColumn('staff', 'phone_number')) {
    sqliteDb.exec("ALTER TABLE staff ADD COLUMN phone_number TEXT NOT NULL DEFAULT ''");
  }

  sqliteDb.exec(`
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

    CREATE TABLE IF NOT EXISTS documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      active      INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS fees (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      price      REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

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

  const studentCount = sqliteDb.prepare('SELECT COUNT(*) AS c FROM students').get().c;
  if (studentCount === 0) {
    const insertStudent = sqliteDb.prepare(
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
    students.forEach(s => insertStudent.run(s.id, s.name, s.course, s.phone, hashPassword('student123')));

    const insertStaff = sqliteDb.prepare(
      'INSERT INTO staff (username, password_hash, name, department, must_change_password) VALUES (?, ?, ?, ?, 1)'
    );
    insertStaff.run('jelai', hashPassword('jelai123'), 'Jeremiah Miguel Eugenio', 'Office of Records');

    const insertDoc = sqliteDb.prepare('INSERT INTO documents (name, description, sort_order) VALUES (?, ?, ?)');
    insertDoc.run('Transcript of Records', 'Processing time: 5-7 days', 1);
    insertDoc.run('Certificate of Grades', 'Processing time: 2-3 days', 2);
    insertDoc.run('Certificate of Enrollment', 'Processing time: 1-2 days', 3);

    const insertFee = sqliteDb.prepare('INSERT INTO fees (name, price, sort_order) VALUES (?, ?, ?)');
    [
      { name: 'Diploma', price: 1500, sort: 1 },
      { name: 'Transcript of Records', price: 600, sort: 2 },
      { name: 'Honorable Dismissal', price: 550, sort: 3 },
      { name: 'Certificate of Grades', price: 150, sort: 4 },
      { name: 'Certificate of Enrollment', price: 150, sort: 5 },
      { name: 'Certification – Graduate', price: 150, sort: 6 },
      { name: 'Certificate – Others', price: 150, sort: 7 },
      { name: 'Print-out of Curriculum', price: 100, sort: 8 },
      { name: 'Print-out of Grades', price: 150, sort: 9 },
      { name: 'Scanning', price: 100, sort: 10 },
      { name: 'RLE', price: 200, sort: 11 }
    ].forEach(f => insertFee.run(f.name, f.price, f.sort));
  }

  db = {
    isPostgres: false,
    sqliteDb,
    prepare(sql) {
      const stmt = sqliteDb.prepare(sql);
      return {
        async get(...args) {
          return stmt.get(...args.flat()) || null;
        },
        async all(...args) {
          return stmt.all(...args.flat());
        },
        async run(...args) {
          return stmt.run(...args.flat());
        }
      };
    },
    async query(sql, params = []) {
      const stmt = sqliteDb.prepare(sql);
      return stmt.all(...params.flat());
    },
    async exec(sql) {
      sqliteDb.exec(sql);
    }
  };
}

module.exports = db;
