const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { hashPassword, verifyPassword } = require('./hash');

// Load environment variables if .env exists
if (fs.existsSync(path.join(__dirname, '.env'))) {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) {}
}

const emailjsConfig = {
  serviceId: process.env.EMAILJS_SERVICE_ID || 'service_z32fcjw',
  templateId: process.env.EMAILJS_TEMPLATE_ID || 'template_0g2iuc7',
  publicKey: process.env.EMAILJS_PUBLIC_KEY || 'Fp31FCH9n5n2OIfyD',
  privateKey: process.env.EMAILJS_PRIVATE_KEY || '1IcnT9JrgVNeMSiDd93Dv'
}; // EmailJS OTP delivery configuration

const semaphoreConfig = {
  apiKey: process.env.SEMAPHORE_API_KEY || 'e5438342ef3f7eddb31c2f52d4402203',
  senderName: process.env.SEMAPHORE_SENDER_NAME || ''
};

function normalizePhPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^\d+]/g, '');
  if (digits.startsWith('+63')) {
    digits = '0' + digits.slice(3);
  } else if (digits.startsWith('63') && digits.length === 12) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

async function sendSemaphoreSms(phone, otpCode) {
  const apiKey = (semaphoreConfig.apiKey || process.env.SEMAPHORE_API_KEY || '').trim();
  const normalizedPhone = normalizePhPhone(phone);

  if (!apiKey) {
    return {
      success: false,
      realSmsSent: false,
      reason: 'no_api_key',
      message: 'No Semaphore API key configured in .env or settings.'
    };
  }

  try {
    const params = new URLSearchParams({
      apikey: apiKey,
      number: normalizedPhone,
      message: `[WUP Registrar] Your password recovery verification code is: ${otpCode}. Valid for 10 minutes. Do not share this code.`
    });
    const sName = (semaphoreConfig.senderName || process.env.SEMAPHORE_SENDER_NAME || '').trim();
    if (sName) {
      params.append('sendername', sName);
    }

    const res = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const responseText = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(responseText); } catch (_) {}

    if (res.ok && Array.isArray(parsed) && parsed.length > 0) {
      return {
        success: true,
        realSmsSent: true,
        httpStatus: res.status,
        messageId: parsed[0].message_id,
        recipient: parsed[0].recipient || normalizedPhone,
        status: parsed[0].status || 'Queued',
        message: 'SMS successfully dispatched to mobile carrier via Semaphore gateway!'
      };
    } else {
      return {
        success: false,
        realSmsSent: false,
        httpStatus: res.status,
        error: responseText,
        message: responseText.slice(0, 220)
      };
    }
  } catch (err) {
    return {
      success: false,
      realSmsSent: false,
      error: err.message,
      message: 'Failed to connect to Semaphore API gateway: ' + err.message
    };
  }
}

// iProg SMS Gateway Configuration (https://iprogsms.com)
const iprogConfig = {
  apiToken: process.env.IPROG_API_TOKEN || ''
};

let activeSmsProvider = (process.env.SMS_PROVIDER || (process.env.IPROG_API_TOKEN ? 'iprog' : 'iprog')).toLowerCase();

async function sendIprogSms(phone, otpCode) {
  const apiToken = (iprogConfig.apiToken || process.env.IPROG_API_TOKEN || '').trim();
  const normalizedPhone = normalizePhPhone(phone); // e.g. 09189876543

  if (!apiToken) {
    return {
      success: false,
      realSmsSent: false,
      provider: 'iprog',
      reason: 'no_api_token',
      message: 'No iProg SMS API token configured. Please enter your iProg API token in settings or .env.'
    };
  }

  try {
    const payload = {
      api_token: apiToken,
      phone_number: normalizedPhone,
      message: `[WUP Registrar] Your password recovery verification code is: ${otpCode}. Valid for 10 minutes. Do not share this code.`
    };

    const res = await fetch('https://www.iprogsms.com/api/v1/sms_messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify(payload)
    });

    const responseText = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(responseText); } catch (_) {}

    const isOk = res.ok && parsed && (parsed.status === 200 || parsed.status === 'success' || parsed.success === true || (parsed.message && parsed.message.toLowerCase().includes('success')));

    if (isOk) {
      return {
        success: true,
        realSmsSent: true,
        provider: 'iprog',
        httpStatus: res.status,
        recipient: normalizedPhone,
        message: parsed.message || 'SMS successfully dispatched to mobile carrier via iProg SMS gateway!'
      };
    } else {
      return {
        success: false,
        realSmsSent: false,
        provider: 'iprog',
        httpStatus: res.status,
        error: parsed?.message || responseText,
        message: parsed?.message || responseText.slice(0, 220)
      };
    }
  } catch (err) {
    return {
      success: false,
      realSmsSent: false,
      provider: 'iprog',
      error: err.message,
      message: 'Failed to connect to iProg SMS gateway: ' + err.message
    };
  }
}

async function dispatchSmsOtp(phone, otpCode) {
  if (activeSmsProvider === 'iprog') {
    return await sendIprogSms(phone, otpCode);
  } else {
    return await sendSemaphoreSms(phone, otpCode);
  }
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}***${user[user.length - 1]}@${domain}`;
}

function maskPhone(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone;
  const start = digits.slice(0, 4);
  const end = digits.slice(-3);
  return `${start} ••• •${end}`;
}

const app = express();
app.set('trust proxy', 1); // Render/Vercel sits behind a proxy; needed so the Secure cookie flag works over https
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Health / Database Status check endpoint
app.get('/api/db-status', async (req, res) => {
  try {
    const isPostgres = !!db.isPostgres;
    const hasDbUrl = !!process.env.DATABASE_URL;
    let studentCount = null;
    let staffCount = null;
    let error = null;
    try {
      const stu = await db.prepare('SELECT count(*) as c FROM students').get();
      studentCount = Number(stu?.c || 0);
      const stf = await db.prepare('SELECT count(*) as c FROM staff').get();
      staffCount = Number(stf?.c || 0);
    } catch (e) {
      error = e.message;
    }
    res.json({
      connected: studentCount !== null && error === null,
      isPostgres,
      hasDbUrl,
      dbUrlConfigured: hasDbUrl ? `${process.env.DATABASE_URL.slice(0, 20)}...` : 'NOT_CONFIGURED',
      studentCount,
      staffCount,
      error
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- helpers ----------

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function getFullRequest(ref) {
  const row = await db.prepare('SELECT * FROM requests WHERE ref = ?').get(ref);
  if (!row) return null;

  const student = await db.prepare('SELECT name, course FROM students WHERE id = ?').get(row.student_id);
  const items = await db.prepare('SELECT name, copies FROM request_items WHERE ref = ?').all(ref);
  const timeline = await db.prepare('SELECT title, time FROM request_timeline WHERE ref = ? ORDER BY id ASC').all(ref);
  const receipt = row.or_number ? await db.prepare('SELECT amount, description, date_issued FROM official_receipts WHERE UPPER(or_number) = ?').get(normalizeOr(row.or_number)) : null;

  return {
    ref: row.ref,
    studentId: row.student_id,
    studentName: student ? student.name : row.student_id,
    course: student ? student.course : '',
    items,
    orNumber: row.or_number,
    orAmount: receipt ? receipt.amount : null,
    orDescription: receipt ? receipt.description : '',
    orDateIssued: receipt ? receipt.date_issued : '',
    assessmentPhoto: row.assessment_photo,
    clearancePhoto: row.clearance_photo || '',
    status: row.status,
    declineReason: row.rejection_reason,
    claimDate: row.claim_date || '',
    dateSubmitted: row.date_submitted,
    timeline
  };
}

async function getAllRequests({ studentId } = {}) {
  const rows = studentId
    ? await db.prepare('SELECT ref FROM requests WHERE student_id = ? ORDER BY rowid DESC').all(studentId)
    : await db.prepare('SELECT ref FROM requests ORDER BY rowid DESC').all();
  const results = [];
  for (const r of rows) {
    results.push(await getFullRequest(r.ref));
  }
  return results;
}

async function addTimelineAndStatus(ref, status, title) {
  await db.prepare('UPDATE requests SET status = ? WHERE ref = ?').run(status, ref);
  await db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)').run(ref, title, nowTime());
}

async function nextRef() {
  const year = new Date().getFullYear();
  const prefix = `DOC-${year}-`;
  const res = await db.prepare('SELECT COUNT(*) AS c FROM requests WHERE ref LIKE ?').get(prefix + '%');
  const count = Number(res?.c || 0);
  return `${prefix}${1000 + count + 1}`;
}

async function nextOrNumber() {
  const year = new Date().getFullYear();
  const prefix = `OR-${year}-`;
  const rows = await db.prepare("SELECT or_number FROM official_receipts WHERE UPPER(or_number) LIKE ?").all(`${prefix}%`);
  let maxNum = 50000;
  for (const r of rows) {
    const parts = r.or_number.split('-');
    if (parts.length >= 3) {
      const num = parseInt(parts[2], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  let candidate = `${prefix}${maxNum + 1}`;
  while (await findOfficialReceipt(candidate)) {
    maxNum++;
    candidate = `${prefix}${maxNum + 1}`;
  }
  return candidate;
}

function normalizeOr(value) {
  return String(value || '').trim().toUpperCase();
}

async function findOfficialReceipt(orNumber) {
  return await db.prepare('SELECT * FROM official_receipts WHERE UPPER(or_number) = ?').get(normalizeOr(orNumber));
}

// An OR number is "used" if any request that is not declined already carries it.
const OR_USED_MESSAGE = 'This OR number has already been used and cannot be used again.';
async function isOrUsed(orNumber) {
  const row = await db.prepare("SELECT 1 FROM requests WHERE UPPER(or_number) = ? AND status != 'declined'").get(normalizeOr(orNumber));
  return !!row;
}

// Today's date in the Philippines (YYYY-MM-DD), used to stop claim dates in the past.
function todayPH() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !Number.isNaN(Date.parse(str));
}
function prettyDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ---------- sessions (keeps people logged in across page refreshes) ----------
const SESSION_COOKIE = 'wup_sid';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours — covers a full 8am-5pm registrar shift

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(req, res, token, maxAgeMs) {
  const flags = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (req.secure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

async function createSession(req, res, role, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, role, user_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, role, userId, Date.now() + SESSION_MS);
  setSessionCookie(req, res, token, SESSION_MS);
}

async function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (Number(s.expires_at) < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  // sliding expiry: stays alive as long as the person keeps using the system
  await db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() + SESSION_MS, token);
  return s;
}

async function requireLogin(req, res, next) {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in.' });
    req.session = s;
    next();
  } catch (err) {
    next(err);
  }
}

async function requireStaff(req, res, next) {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: 'Not logged in.' });
    if (s.role !== 'staff') return res.status(403).json({ error: 'Registrar staff only.' });
    req.session = s;
    next();
  } catch (err) {
    next(err);
  }
}

async function buildUser(role, id) {
  if (role === 'staff') {
    const st = await db.prepare('SELECT * FROM staff WHERE username = ?').get(id);
    return st && {
      role: 'staff',
      id: st.username,
      username: st.username,
      name: st.name,
      department: st.department,
      email: st.email || '',
      phoneNumber: st.phone_number || '',
      mustChangePassword: !!st.must_change_password
    };
  }
  const stu = await db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  return stu && {
    role: 'student',
    id: stu.id,
    username: stu.username || '',
    name: stu.name,
    course: stu.course,
    email: stu.email || '',
    phoneNumber: stu.phone_number || '',
    mustChangePassword: !!stu.must_change_password
  };
}

// clean out expired sessions and old OTPs once an hour
setInterval(async () => {
  try {
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    await db.prepare('DELETE FROM password_reset_otps WHERE expires_at < ?').run(Date.now() - 24 * 60 * 60 * 1000);
  } catch (e) {}
}, 60 * 60 * 1000).unref();

// ---------- auth ----------

app.post('/api/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const staff = await db.prepare('SELECT * FROM staff WHERE username = ?').get(username.toLowerCase());
  if (staff && verifyPassword(password, staff.password_hash)) {
    await createSession(req, res, 'staff', staff.username);
    return res.json({
      role: 'staff',
      id: staff.username,
      name: staff.name,
      department: staff.department,
      email: staff.email || '',
      phoneNumber: staff.phone_number || '',
      mustChangePassword: !!staff.must_change_password
    });
  }

  const student = await db.prepare("SELECT * FROM students WHERE id = ? OR (username != '' AND LOWER(username) = LOWER(?))").get(username.toUpperCase(), username);
  if (student && verifyPassword(password, student.password_hash)) {
    await createSession(req, res, 'student', student.id);
    return res.json({
      role: 'student',
      id: student.id,
      username: student.username || '',
      name: student.name,
      course: student.course,
      email: student.email || '',
      phoneNumber: student.phone_number || '',
      mustChangePassword: !!student.must_change_password
    });
  }

  res.status(401).json({ error: 'Invalid credentials.' });
});

// Who is logged in right now? The page calls this on load so a refresh doesn't log people out.
app.get('/api/me', async (req, res) => {
  const s = await getSession(req);
  const user = s && (await buildUser(s.role, s.user_id));
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json(user);
});

app.post('/api/logout', async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  setSessionCookie(req, res, '', 0);
  res.json({ success: true });
});

// Change password — requires the current password (used from an already-logged-in session).
app.post('/api/change-password', requireLogin, async (req, res) => {
  const { currentPassword, newPassword, email } = req.body;
  const id = req.session.user_id;
  const role = req.session.role;

  if (!id || !role || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  if (String(newPassword) === String(currentPassword)) {
    return res.status(400).json({ error: 'New password must be different from the current password.' });
  }

  const cleanEmail = String(email || '').trim();
  if (cleanEmail && (!cleanEmail.includes('@') || !cleanEmail.includes('.'))) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const table = role === 'staff' ? 'staff' : 'students';
  const keyCol = role === 'staff' ? 'username' : 'id';
  const lookupId = role === 'staff' ? String(id).toLowerCase() : String(id).toUpperCase();

  const row = await db.prepare(`SELECT * FROM ${table} WHERE ${keyCol} = ?`).get(lookupId);
  if (!row) return res.status(404).json({ error: 'Account not found.' });

  if (!verifyPassword(currentPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  if (role === 'staff') {
    if (cleanEmail) {
      await db.prepare('UPDATE staff SET password_hash = ?, email = ?, must_change_password = 0 WHERE username = ?')
        .run(hashPassword(newPassword), cleanEmail, lookupId);
    } else {
      await db.prepare('UPDATE staff SET password_hash = ?, must_change_password = 0 WHERE username = ?')
        .run(hashPassword(newPassword), lookupId);
    }
  } else {
    if (cleanEmail) {
      await db.prepare('UPDATE students SET password_hash = ?, email = ?, must_change_password = 0 WHERE id = ?')
        .run(hashPassword(newPassword), cleanEmail, lookupId);
    } else {
      await db.prepare('UPDATE students SET password_hash = ?, must_change_password = 0 WHERE id = ?')
        .run(hashPassword(newPassword), lookupId);
    }
  }
  res.json({ success: true, email: cleanEmail || row.email || '' });
});

// Change username — needs current password.
app.post('/api/change-username', requireLogin, async (req, res) => {
  const { newUsername, currentPassword } = req.body;
  const role = req.session.role;
  const id = req.session.user_id;
  const wanted = String(newUsername || '').trim().toLowerCase();

  if (!wanted || !currentPassword) return res.status(400).json({ error: 'Enter a new username and your current password.' });
  if (wanted.length < 4 || wanted.length > 30) return res.status(400).json({ error: 'Username must be 4 to 30 characters.' });
  if (!/^[a-z0-9._-]+$/.test(wanted)) return res.status(400).json({ error: 'Use only letters, numbers, dots, dashes and underscores (no spaces).' });

  const table = role === 'staff' ? 'staff' : 'students';
  const keyCol = role === 'staff' ? 'username' : 'id';
  const row = await db.prepare(`SELECT * FROM ${table} WHERE ${keyCol} = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Account not found.' });
  if (!verifyPassword(String(currentPassword), row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const current = role === 'staff' ? row.username : (row.username || '');
  if (wanted === current.toLowerCase()) return res.status(400).json({ error: 'That is already your username.' });

  const taken =
    (await db.prepare('SELECT 1 FROM staff WHERE LOWER(username) = ? AND NOT (? = \'staff\' AND username = ?)').get(wanted, role, id)) ||
    (await db.prepare('SELECT 1 FROM students WHERE LOWER(id) = ?').get(wanted)) ||
    (await db.prepare("SELECT 1 FROM students WHERE username != '' AND LOWER(username) = ? AND id != ?").get(wanted, role === 'student' ? id : ''));
  if (taken) return res.status(409).json({ error: 'That username is already taken. Try another one.' });

  await db.exec('BEGIN');
  try {
    if (role === 'staff') {
      await db.prepare('UPDATE staff SET username = ? WHERE username = ?').run(wanted, id);
      await db.prepare("UPDATE sessions SET user_id = ? WHERE role = 'staff' AND user_id = ?").run(wanted, id);
    } else {
      await db.prepare('UPDATE students SET username = ? WHERE id = ?').run(wanted, id);
    }
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Could not change the username.' });
  }
  res.json(await buildUser(role, role === 'staff' ? wanted : id));
});

// ---------- contact information (email & phone) ----------

app.post('/api/change-contact', requireLogin, async (req, res) => {
  const { email, phoneNumber, currentPassword } = req.body;
  const id = req.session.user_id;
  const role = req.session.role;

  if (!currentPassword) {
    return res.status(400).json({ error: 'Please enter your current password to save contact changes.' });
  }

  const table = role === 'staff' ? 'staff' : 'students';
  const keyCol = role === 'staff' ? 'username' : 'id';
  const row = await db.prepare(`SELECT * FROM ${table} WHERE ${keyCol} = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Account not found.' });

  if (!verifyPassword(String(currentPassword), row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const cleanEmail = (email || '').trim();
  const cleanPhone = (phoneNumber || '').trim();

  if (role === 'staff') {
    await db.prepare('UPDATE staff SET email = ?, phone_number = ? WHERE username = ?').run(cleanEmail, cleanPhone, id);
  } else {
    await db.prepare('UPDATE students SET email = ?, phone_number = ? WHERE id = ?').run(cleanEmail, cleanPhone, id);
  }

  res.json({ success: true, email: cleanEmail, phoneNumber: cleanPhone });
});

// Registrar staff managing student contact info
app.patch('/api/students/:id', requireStaff, async (req, res) => {
  const id = req.params.id.toUpperCase();
  const { phoneNumber, email } = req.body;

  const student = await db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  if (phoneNumber !== undefined) {
    await db.prepare('UPDATE students SET phone_number = ? WHERE id = ?').run(String(phoneNumber).trim(), id);
  }
  if (email !== undefined) {
    await db.prepare('UPDATE students SET email = ? WHERE id = ?').run(String(email).trim(), id);
  }

  const updated = await db.prepare('SELECT id, name, course, phone_number, email FROM students WHERE id = ?').get(id);
  res.json({
    id: updated.id,
    name: updated.name,
    course: updated.course,
    phoneNumber: updated.phone_number,
    email: updated.email
  });
});

app.get('/api/students/:id', requireStaff, async (req, res) => {
  const id = req.params.id.trim().toUpperCase();
  const student = await db.prepare('SELECT id, name, course, phone_number, email FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  res.json({ id: student.id, name: student.name, course: student.course, phoneNumber: student.phone_number, email: student.email });
});

// ---------- forgot password with OTP ----------

app.get('/api/auth/emailjs-config', (req, res) => {
  res.json({
    serviceId: emailjsConfig.serviceId || process.env.EMAILJS_SERVICE_ID || '',
    templateId: emailjsConfig.templateId || process.env.EMAILJS_TEMPLATE_ID || '',
    publicKey: emailjsConfig.publicKey || process.env.EMAILJS_PUBLIC_KEY || ''
  });
});

app.post('/api/auth/emailjs-config', (req, res) => {
  const { serviceId, templateId, publicKey } = req.body;
  if (serviceId !== undefined) emailjsConfig.serviceId = String(serviceId).trim();
  if (templateId !== undefined) emailjsConfig.templateId = String(templateId).trim();
  if (publicKey !== undefined) emailjsConfig.publicKey = String(publicKey).trim();
  res.json({ success: true, emailjsConfig });
});

app.get('/api/auth/semaphore-config', async (req, res) => {
  const apiKey = (semaphoreConfig.apiKey || process.env.SEMAPHORE_API_KEY || '').trim();
  let account = null;
  let accountError = null;

  if (apiKey) {
    try {
      const semRes = await fetch(`https://api.semaphore.co/api/v4/account?apikey=${apiKey}`);
      if (semRes.ok) {
        account = await semRes.json();
      } else {
        accountError = await semRes.text();
      }
    } catch (e) {
      accountError = e.message;
    }
  }

  res.json({
    configured: !!apiKey,
    maskedApiKey: apiKey ? `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}` : '',
    senderName: semaphoreConfig.senderName || process.env.SEMAPHORE_SENDER_NAME || '',
    account,
    accountError
  });
});

app.get('/api/auth/sms-config', async (req, res) => {
  const iprogToken = (iprogConfig.apiToken || process.env.IPROG_API_TOKEN || '').trim();
  const semKey = (semaphoreConfig.apiKey || process.env.SEMAPHORE_API_KEY || '').trim();

  let semAccount = null;
  if (semKey) {
    try {
      const semRes = await fetch(`https://api.semaphore.co/api/v4/account?apikey=${semKey}`);
      if (semRes.ok) semAccount = await semRes.json();
    } catch (_) {}
  }

  res.json({
    activeProvider: activeSmsProvider,
    iprog: {
      configured: !!iprogToken,
      maskedToken: iprogToken ? `${iprogToken.slice(0, 4)}••••••••${iprogToken.slice(-4)}` : '',
      endpoint: 'https://www.iprogsms.com/api/v1/sms_messages'
    },
    semaphore: {
      configured: !!semKey,
      maskedApiKey: semKey ? `${semKey.slice(0, 4)}••••••••${semKey.slice(-4)}` : '',
      senderName: semaphoreConfig.senderName || process.env.SEMAPHORE_SENDER_NAME || '',
      account: semAccount
    }
  });
});

app.post('/api/auth/sms-config', (req, res) => {
  const { provider, iprogToken, semaphoreApiKey, semaphoreSenderName } = req.body;
  if (provider && (provider === 'iprog' || provider === 'semaphore')) {
    activeSmsProvider = provider;
  }
  if (iprogToken !== undefined) {
    iprogConfig.apiToken = String(iprogToken).trim();
  }
  if (semaphoreApiKey !== undefined) {
    semaphoreConfig.apiKey = String(semaphoreApiKey).trim();
  }
  if (semaphoreSenderName !== undefined) {
    semaphoreConfig.senderName = String(semaphoreSenderName).trim();
  }
  res.json({
    success: true,
    activeProvider: activeSmsProvider,
    iprogConfigured: !!(iprogConfig.apiToken || process.env.IPROG_API_TOKEN),
    semaphoreConfigured: !!(semaphoreConfig.apiKey || process.env.SEMAPHORE_API_KEY)
  });
});

app.post('/api/auth/semaphore-config', (req, res) => {
  const { apiKey, senderName } = req.body;
  if (apiKey !== undefined) semaphoreConfig.apiKey = String(apiKey).trim();
  if (senderName !== undefined) semaphoreConfig.senderName = String(senderName).trim();
  res.json({ success: true, semaphoreConfig });
});

// Step 1: Look up account by Student ID, Username, or Registered Email
app.post('/api/auth/forgot-password/lookup', async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  if (!identifier) {
    return res.status(400).json({ error: 'Please enter your Student ID, username, or registered email.' });
  }

  let student = await db.prepare("SELECT * FROM students WHERE UPPER(id) = UPPER(?)").get(identifier);
  if (!student) {
    student = await db.prepare("SELECT * FROM students WHERE LOWER(email) = LOWER(?) AND email != ''").get(identifier);
  }
  if (!student) {
    student = await db.prepare("SELECT * FROM students WHERE LOWER(username) = LOWER(?) AND username != ''").get(identifier);
  }

  if (student) {
    return res.json({
      found: true,
      userType: 'student',
      userId: student.id,
      name: student.name,
      course: student.course,
      email: student.email || '',
      maskedEmail: maskEmail(student.email),
      phoneNumber: student.phone_number || '',
      maskedPhone: maskPhone(student.phone_number)
    });
  }

  let staff = await db.prepare('SELECT * FROM staff WHERE LOWER(username) = LOWER(?)').get(identifier);
  if (!staff) {
    staff = await db.prepare("SELECT * FROM staff WHERE LOWER(email) = LOWER(?) AND email != ''").get(identifier);
  }

  if (staff) {
    return res.json({
      found: true,
      userType: 'staff',
      userId: staff.username,
      name: staff.name,
      department: staff.department,
      email: staff.email || '',
      maskedEmail: maskEmail(staff.email),
      phoneNumber: staff.phone_number || '',
      maskedPhone: maskPhone(staff.phone_number)
    });
  }

  res.status(404).json({ error: 'No account found. Please check your Student ID, username, or registered email.' });
});

// Step 2: Send OTP
app.post('/api/auth/forgot-password/send-otp', async (req, res) => {
  const { identifier, method, customTarget } = req.body;
  const deliveryMethod = method === 'email' ? 'email' : 'sms';

  if (!identifier) {
    return res.status(400).json({ error: 'Account identifier is required.' });
  }

  let student = await db.prepare("SELECT * FROM students WHERE UPPER(id) = UPPER(?)").get(String(identifier).trim());
  if (!student) {
    student = await db.prepare("SELECT * FROM students WHERE LOWER(email) = LOWER(?) AND email != ''").get(String(identifier).trim());
  }
  if (!student) {
    student = await db.prepare("SELECT * FROM students WHERE LOWER(username) = LOWER(?) AND username != ''").get(String(identifier).trim());
  }
  let staff = !student ? await db.prepare('SELECT * FROM staff WHERE LOWER(username) = LOWER(?)').get(String(identifier).trim()) : null;
  if (!student && !staff) {
    staff = await db.prepare("SELECT * FROM staff WHERE LOWER(email) = LOWER(?) AND email != ''").get(String(identifier).trim());
  }

  const user = student || staff;
  const userType = student ? 'student' : 'staff';
  const userId = student ? student.id : (staff ? staff.username : null);

  if (!user) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  let targetDestination = '';
  if (deliveryMethod === 'email') {
    const rawEmail = String(user.email || customTarget || '').trim();
    if (!rawEmail || !rawEmail.includes('@')) {
      return res.status(400).json({ error: 'No valid recovery email registered for this account.' });
    }
    targetDestination = rawEmail;
    if (!user.email && rawEmail) {
      if (userType === 'student') await db.prepare('UPDATE students SET email = ? WHERE id = ?').run(rawEmail, userId);
      else await db.prepare('UPDATE staff SET email = ? WHERE username = ?').run(rawEmail, userId);
    }
  } else {
    const rawPhone = String(customTarget || user.phone_number || '').trim();
    if (!rawPhone || rawPhone.length < 7) {
      return res.status(400).json({ error: 'A valid phone number is required to receive the OTP.' });
    }
    targetDestination = rawPhone;
    if (!user.phone_number && rawPhone) {
      if (userType === 'student') await db.prepare('UPDATE students SET phone_number = ? WHERE id = ?').run(rawPhone, userId);
      else await db.prepare('UPDATE staff SET phone_number = ? WHERE username = ?').run(rawPhone, userId);
    }
  }

  // Invalidate any previous pending OTPs
  await db.prepare('UPDATE password_reset_otps SET used = 1 WHERE user_id = ? AND used = 0').run(userId);

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const resetToken = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;

  await db.prepare(`
    INSERT INTO password_reset_otps (user_type, user_id, delivery_method, target_destination, otp_code, reset_token, expires_at, used, attempts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
  `).run(userType, userId, deliveryMethod, targetDestination, otpCode, resetToken, expiresAt, now);

  const masked = deliveryMethod === 'email' ? maskEmail(targetDestination) : maskPhone(targetDestination);

  let smsResult = null;
  if (deliveryMethod === 'sms') {
    smsResult = await dispatchSmsOtp(targetDestination, otpCode);
  }

  const cfg = {
    serviceId: emailjsConfig.serviceId || process.env.EMAILJS_SERVICE_ID || '',
    templateId: emailjsConfig.templateId || process.env.EMAILJS_TEMPLATE_ID || '',
    publicKey: emailjsConfig.publicKey || process.env.EMAILJS_PUBLIC_KEY || ''
  };

  res.json({
    success: true,
    resetToken,
    method: deliveryMethod,
    target: masked,
    rawTarget: targetDestination,
    normalizedPhone: normalizePhPhone(targetDestination),
    userName: user.name,
    otpCode,
    expiresInSeconds: 600,
    emailjsConfig: cfg,
    smsResult
  });
});

// Step 3: Verify OTP
app.post('/api/auth/forgot-password/verify-otp', async (req, res) => {
  const { resetToken, otpCode } = req.body;
  if (!resetToken || !otpCode) {
    return res.status(400).json({ error: 'Verification token and OTP code are required.' });
  }

  const record = await db.prepare('SELECT * FROM password_reset_otps WHERE reset_token = ?').get(resetToken);
  if (!record) {
    return res.status(404).json({ error: 'Invalid or expired reset session. Please request a new code.' });
  }

  if (Number(record.used) === 1) {
    return res.status(400).json({ error: 'This verification code has already been used. Please request a new one.' });
  }

  if (Number(record.expires_at) < Date.now()) {
    return res.status(400).json({ error: 'This verification code has expired. Please request a new code.' });
  }

  if (Number(record.attempts) >= 5) {
    return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
  }

  if (record.otp_code.trim() !== String(otpCode).trim()) {
    await db.prepare('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ?').run(record.id);
    const remaining = 4 - Number(record.attempts);
    return res.status(400).json({
      error: remaining > 0
        ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
        : 'Incorrect verification code. Session locked, please request a new code.'
    });
  }

  const changeToken = crypto.randomBytes(32).toString('hex');
  await db.prepare('UPDATE password_reset_otps SET used = 1, change_token = ? WHERE id = ?').run(changeToken, record.id);

  res.json({
    success: true,
    changeToken,
    userId: record.user_id,
    userType: record.user_type
  });
});

// Step 4: Reset password
app.post('/api/auth/forgot-password/reset-password', async (req, res) => {
  const { changeToken, newPassword } = req.body;
  if (!changeToken || !newPassword) {
    return res.status(400).json({ error: 'Change token and new password are required.' });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const record = await db.prepare('SELECT * FROM password_reset_otps WHERE change_token = ?').get(changeToken);
  if (!record) {
    return res.status(400).json({ error: 'Invalid or expired password reset session. Please try again.' });
  }

  if (Number(record.expires_at) + 15 * 60 * 1000 < Date.now()) {
    return res.status(400).json({ error: 'Password reset session has expired. Please start over.' });
  }

  const hashedPassword = hashPassword(newPassword);
  if (record.user_type === 'student') {
    await db.prepare('UPDATE students SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashedPassword, record.user_id);
    if (record.delivery_method === 'email' && record.target_destination) {
      await db.prepare('UPDATE students SET email = ? WHERE id = ?').run(record.target_destination, record.user_id);
    }
  } else {
    await db.prepare('UPDATE staff SET password_hash = ?, must_change_password = 0 WHERE username = ?').run(hashedPassword, record.user_id);
    if (record.delivery_method === 'email' && record.target_destination) {
      await db.prepare('UPDATE staff SET email = ? WHERE username = ?').run(record.target_destination, record.user_id);
    }
  }

  await db.prepare("UPDATE password_reset_otps SET change_token = '' WHERE id = ?").run(record.id);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(record.user_id);

  res.json({
    success: true,
    userId: record.user_id,
    message: 'Your password has been reset successfully. You can now sign in with your new password.'
  });
});

// ---------- requests: read ----------

app.get('/api/requests', requireLogin, async (req, res) => {
  const studentId = req.session.role === 'student' ? req.session.user_id : (req.query.studentId || undefined);
  res.json(await getAllRequests({ studentId }));
});

app.get('/api/requests/lookup/:ref', requireLogin, async (req, res) => {
  const ref = req.params.ref.trim().toUpperCase();
  const match = await db.prepare('SELECT ref FROM requests WHERE UPPER(ref) = ?').get(ref);
  if (!match) return res.status(404).json({ error: 'Not found.' });
  const full = await getFullRequest(match.ref);
  if (req.session.role === 'student' && full.studentId !== req.session.user_id) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json(full);
});

// ---------- requests: create ----------

app.post('/api/requests', requireLogin, async (req, res) => {
  const { items, orNumber, assessmentPhoto } = req.body;

  const studentId = req.session.role === 'student' ? req.session.user_id : req.body.studentId;
  if (!studentId || !Array.isArray(items) || items.length === 0 || !orNumber || !assessmentPhoto) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const activeDocsRows = await db.prepare('SELECT name FROM documents WHERE active = 1').all();
  const activeDocs = activeDocsRows.map(d => d.name);
  const cleanItems = [];
  for (const it of items) {
    const match = activeDocs.find(n => n.toLowerCase() === String(it.name || '').toLowerCase());
    const copies = Number(it.copies);
    if (!match || !Number.isInteger(copies) || copies < 1 || copies > 20) {
      return res.status(400).json({ error: 'One or more selected documents are not available for request.' });
    }
    cleanItems.push({ name: match, copies });
  }

  const orClean = normalizeOr(orNumber);

  const receipt = await findOfficialReceipt(orClean);
  if (!receipt) {
    return res.status(400).json({ error: 'Invalid Official Receipt (OR) number. Receipt not found in Treasury records.' });
  }
  if (receipt.student_id && receipt.student_id.toUpperCase() !== studentId.toUpperCase()) {
    return res.status(400).json({ error: `This OR number was issued to student ${receipt.student_id}.` });
  }
  if (await isOrUsed(orClean)) {
    return res.status(409).json({ error: OR_USED_MESSAGE });
  }

  const student = await db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const ref = await nextRef();
  const dateSubmitted = new Date().toLocaleString();

  await db.exec('BEGIN');
  try {
    await db.prepare(`
      INSERT INTO requests (ref, student_id, or_number, assessment_photo, clearance_photo, status, rejection_reason, date_submitted)
      VALUES (?, ?, ?, ?, ?, 'pending_verification', '', ?)
    `).run(ref, studentId, orClean, assessmentPhoto, '', dateSubmitted);

    const insertItem = db.prepare('INSERT INTO request_items (ref, name, copies) VALUES (?, ?, ?)');
    for (const it of cleanItems) {
      await insertItem.run(ref, it.name, it.copies);
    }

    await db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)')
      .run(ref, `Submitted Online with OR ${orClean} & Assessment Form`, nowTime());

    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    if (/UNIQUE/i.test(String(err.message))) return res.status(409).json({ error: OR_USED_MESSAGE });
    return res.status(500).json({ error: 'Failed to create request.' });
  }

  res.status(201).json(await getFullRequest(ref));
});

// ---------- requests: status actions ----------

async function loadForAction(req, res, expectedStatus) {
  const row = await db.prepare('SELECT status FROM requests WHERE ref = ?').get(req.params.ref);
  if (!row) { res.status(404).json({ error: 'Not found.' }); return null; }
  if (row.status !== expectedStatus) {
    res.status(409).json({ error: 'This request is no longer in the right step for that action. Refresh and try again.' });
    return null;
  }
  return row;
}

app.post('/api/requests/:ref/approve-payment', requireStaff, async (req, res) => {
  if (!(await loadForAction(req, res, 'pending_verification'))) return;
  const ref = req.params.ref;
  await addTimelineAndStatus(ref, 'processing', 'OR & Assessment Verified by Registrar; Document In-Processing');
  res.json(await getFullRequest(ref));
});

app.post('/api/requests/:ref/mark-ready', requireStaff, async (req, res) => {
  const claimDate = String(req.body.claimDate || '').trim();
  if (!isValidDate(claimDate)) return res.status(400).json({ error: 'Pick a claim date.' });
  if (claimDate < todayPH()) return res.status(400).json({ error: 'The claim date cannot be in the past.' });
  if (!(await loadForAction(req, res, 'processing'))) return;
  const ref = req.params.ref;
  await db.prepare('UPDATE requests SET claim_date = ? WHERE ref = ?').run(claimDate, ref);
  await addTimelineAndStatus(ref, 'ready', `Ready to Claim at the Registrar Claiming Window on ${prettyDate(claimDate)}`);
  res.json(await getFullRequest(ref));
});

app.post('/api/requests/:ref/claim-date', requireStaff, async (req, res) => {
  const claimDate = String(req.body.claimDate || '').trim();
  if (!isValidDate(claimDate)) return res.status(400).json({ error: 'Pick a claim date.' });
  if (claimDate < todayPH()) return res.status(400).json({ error: 'The claim date cannot be in the past.' });
  if (!(await loadForAction(req, res, 'ready'))) return;
  const ref = req.params.ref;
  await db.prepare('UPDATE requests SET claim_date = ? WHERE ref = ?').run(claimDate, ref);
  await db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)')
    .run(ref, `Claim date changed to ${prettyDate(claimDate)}`, nowTime());
  res.json(await getFullRequest(ref));
});

app.post('/api/requests/:ref/mark-completed', requireStaff, async (req, res) => {
  if (!(await loadForAction(req, res, 'ready'))) return;
  const ref = req.params.ref;
  await addTimelineAndStatus(ref, 'completed', 'Document Claimed at Window Counter');
  res.json(await getFullRequest(ref));
});

app.post('/api/requests/:ref/decline', requireStaff, async (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A reason for declining is required.' });
  if (!(await loadForAction(req, res, 'pending_verification'))) return;
  const ref = req.params.ref;

  await db.prepare('UPDATE requests SET status = ?, rejection_reason = ? WHERE ref = ?').run('declined', reason, ref);
  await db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)')
    .run(ref, `Declined: ${reason}`, nowTime());

  res.json(await getFullRequest(ref));
});

// ---------- OR numbers & Treasury Official Receipts ----------

app.get('/api/or-check', requireLogin, async (req, res) => {
  const or = normalizeOr(req.query.or);
  if (!or) return res.json({ valid: false, used: false, error: '' });

  const receipt = await findOfficialReceipt(or);
  if (!receipt) {
    return res.json({
      valid: false,
      used: false,
      error: 'Invalid OR number. This receipt was not found in Treasury records.'
    });
  }

  const studentId = req.session.role === 'student' ? req.session.user_id : null;
  if (studentId && receipt.student_id && receipt.student_id.toUpperCase() !== studentId.toUpperCase()) {
    return res.json({
      valid: false,
      used: false,
      error: `This OR number was issued to student ${receipt.student_id}.`
    });
  }

  if (await isOrUsed(or)) {
    return res.json({
      valid: false,
      used: true,
      error: OR_USED_MESSAGE
    });
  }

  res.json({
    valid: true,
    used: false,
    receipt: {
      orNumber: receipt.or_number,
      studentId: receipt.student_id,
      studentName: receipt.student_name,
      amount: receipt.amount,
      description: receipt.description,
      dateIssued: receipt.date_issued
    }
  });
});

app.get('/api/receipts', requireStaff, async (req, res) => {
  const rows = await db.prepare(`
    SELECT 
      r.or_number,
      r.student_id,
      r.student_name,
      r.amount,
      r.description,
      r.date_issued,
      req.ref AS used_ref,
      req.student_id AS used_by_student,
      req.status AS req_status
    FROM official_receipts r
    LEFT JOIN requests req ON UPPER(req.or_number) = UPPER(r.or_number) AND req.status != 'declined'
    ORDER BY r.rowid DESC
  `).all();
  res.json(rows.map(r => ({
    orNumber: r.or_number,
    studentId: r.student_id,
    studentName: r.student_name,
    amount: r.amount,
    description: r.description,
    dateIssued: r.date_issued,
    isUsed: !!r.used_ref,
    usedRef: r.used_ref || '',
    usedByStudent: r.used_by_student || '',
    requestStatus: r.req_status || ''
  })));
});

app.get('/api/receipts/next-or', requireStaff, async (req, res) => {
  res.json({ orNumber: await nextOrNumber() });
});

app.post('/api/receipts/generate', requireStaff, async (req, res) => {
  const targetStudentId = String(req.body.studentId || '').trim().toUpperCase();

  let targetStudentName = '';
  if (targetStudentId) {
    const stu = await db.prepare('SELECT name FROM students WHERE id = ?').get(targetStudentId);
    if (stu) targetStudentName = stu.name;
  }
  if (!targetStudentName && req.body.studentName) {
    targetStudentName = String(req.body.studentName).trim();
  }

  const orNumber = await nextOrNumber();
  const amount = Number(req.body.amount) || 150;
  const description = String(req.body.description || 'Auto-generated Treasury Receipt').trim();
  const dateIssued = todayPH();

  await db.prepare(`
    INSERT INTO official_receipts (or_number, student_id, student_name, amount, description, date_issued)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orNumber, targetStudentId, targetStudentName, amount, description, dateIssued);

  res.status(201).json(await findOfficialReceipt(orNumber));
});

app.post('/api/receipts', requireStaff, async (req, res) => {
  const orNumber = normalizeOr(req.body.orNumber) || (await nextOrNumber());
  const studentId = String(req.body.studentId || '').trim().toUpperCase();
  let studentName = String(req.body.studentName || '').trim();
  const amount = Number(req.body.amount) || 0;
  const description = String(req.body.description || '').trim();
  const dateIssued = String(req.body.dateIssued || todayPH()).trim();

  if (!studentId) {
    return res.status(400).json({ error: 'Student ID is required to add an Official Receipt.' });
  }

  const student = await db.prepare('SELECT id, name FROM students WHERE id = ?').get(studentId);
  if (!student) {
    return res.status(404).json({ error: `Student with ID "${studentId}" was not found in university records.` });
  }

  if (!studentName) {
    studentName = student.name;
  }

  if (await findOfficialReceipt(orNumber)) {
    return res.status(409).json({ error: 'This OR number already exists in Treasury records.' });
  }

  await db.prepare(`
    INSERT INTO official_receipts (or_number, student_id, student_name, amount, description, date_issued)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orNumber, student.id, studentName, amount, description, dateIssued);

  res.status(201).json(await findOfficialReceipt(orNumber));
});

app.delete('/api/receipts/:or', requireStaff, async (req, res) => {
  const or = normalizeOr(req.params.or);
  const receipt = await findOfficialReceipt(or);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found.' });
  if (await isOrUsed(or)) {
    return res.status(400).json({ error: 'Cannot delete an OR number that has already been used in an active request.' });
  }
  await db.prepare('DELETE FROM official_receipts WHERE UPPER(or_number) = ?').run(or);
  res.json({ deleted: true });
});

// ---------- documents students can request ----------

function docRow(d) {
  return { id: d.id, name: d.name, description: d.description, active: !!d.active };
}

app.get('/api/documents', requireLogin, async (req, res) => {
  const rows = req.session.role === 'staff'
    ? await db.prepare('SELECT * FROM documents ORDER BY sort_order, id').all()
    : await db.prepare('SELECT * FROM documents WHERE active = 1 ORDER BY sort_order, id').all();
  res.json(rows.map(docRow));
});

app.post('/api/documents', requireStaff, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  if (!name) return res.status(400).json({ error: 'Document name is required.' });
  if (name.length > 80) return res.status(400).json({ error: 'Document name is too long (80 characters max).' });
  if (await db.prepare('SELECT 1 FROM documents WHERE name = ?').get(name)) {
    return res.status(409).json({ error: 'A document with this name already exists.' });
  }

  await db.exec('BEGIN');
  try {
    const sortRes = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM documents').get();
    const nextSort = Number(sortRes?.n || 1);
    const info = await db.prepare('INSERT INTO documents (name, description, active, sort_order) VALUES (?, ?, 1, ?)')
      .run(name, description, nextSort);
    if (!(await db.prepare('SELECT 1 FROM fees WHERE name = ?').get(name))) {
      const feeRes = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM fees').get();
      const feeSort = Number(feeRes?.n || 1);
      await db.prepare('INSERT INTO fees (name, price, sort_order) VALUES (?, 0, ?)').run(name, feeSort);
    }
    await db.exec('COMMIT');
    const created = await db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(docRow(created || { id: info.lastInsertRowid, name, description, active: 1 }));
  } catch (err) {
    await db.exec('ROLLBACK');
    res.status(500).json({ error: 'Could not add the document.' });
  }
});

app.patch('/api/documents/:id', requireStaff, async (req, res) => {
  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const name = req.body.name !== undefined ? String(req.body.name).trim() : doc.name;
  const description = req.body.description !== undefined ? String(req.body.description).trim() : doc.description;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : doc.active;

  if (!name) return res.status(400).json({ error: 'Document name is required.' });
  if (name.length > 80) return res.status(400).json({ error: 'Document name is too long (80 characters max).' });
  const clash = await db.prepare('SELECT id FROM documents WHERE name = ? AND id != ?').get(name, doc.id);
  if (clash) return res.status(409).json({ error: 'A document with this name already exists.' });

  await db.exec('BEGIN');
  try {
    await db.prepare('UPDATE documents SET name = ?, description = ?, active = ? WHERE id = ?').run(name, description, active, doc.id);
    if (name !== doc.name) {
      await db.prepare('UPDATE request_items SET name = ? WHERE name = ?').run(name, doc.name);
      const feeClash = await db.prepare('SELECT id FROM fees WHERE name = ?').get(name);
      if (!feeClash) await db.prepare('UPDATE fees SET name = ? WHERE name = ?').run(name, doc.name);
    }
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Could not update the document.' });
  }
  res.json(docRow(await db.prepare('SELECT * FROM documents WHERE id = ?').get(doc.id)));
});

app.delete('/api/documents/:id', requireStaff, async (req, res) => {
  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  await db.exec('BEGIN');
  try {
    await db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    await db.prepare('DELETE FROM fees WHERE name = ?').run(doc.name);
    await db.exec('COMMIT');
  } catch (err) {
    await db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Could not delete the document.' });
  }
  res.json({ deleted: true });
});

// ---------- Clearance Fees ----------

function feeRow(f) {
  return { id: f.id, name: f.name, price: f.price };
}

app.get('/api/fees', requireLogin, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM fees ORDER BY sort_order, id').all();
  res.json(rows.map(feeRow));
});

app.patch('/api/fees/:id', requireStaff, async (req, res) => {
  const fee = await db.prepare('SELECT * FROM fees WHERE id = ?').get(Number(req.params.id));
  if (!fee) return res.status(404).json({ error: 'Fee not found.' });
  const price = Number(req.body.price);
  if (!Number.isFinite(price) || price < 0 || price > 1000000) {
    return res.status(400).json({ error: 'Enter a price of 0 or more.' });
  }
  await db.prepare('UPDATE fees SET price = ? WHERE id = ?').run(Math.round(price * 100) / 100, fee.id);
  res.json(feeRow(await db.prepare('SELECT * FROM fees WHERE id = ?').get(fee.id)));
});

app.delete('/api/fees/:id', requireStaff, async (req, res) => {
  const fee = await db.prepare('SELECT * FROM fees WHERE id = ?').get(Number(req.params.id));
  if (!fee) return res.status(404).json({ error: 'Fee not found.' });
  await db.prepare('DELETE FROM fees WHERE id = ?').run(fee.id);
  res.json({ deleted: true });
});

// ---------- debug ----------
app.get('/api/_debug/data', async (req, res) => {
  if (!process.env.DEBUG_KEY || req.query.key !== process.env.DEBUG_KEY) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json({
    students: await db.prepare('SELECT id, name, course, phone_number, must_change_password FROM students').all(),
    staff: await db.prepare('SELECT username, name, department FROM staff').all(),
    requests: await db.prepare('SELECT * FROM requests ORDER BY rowid DESC').all(),
    official_receipts: await db.prepare('SELECT * FROM official_receipts ORDER BY rowid DESC').all(),
    request_items: await db.prepare('SELECT * FROM request_items').all(),
    request_timeline: await db.prepare('SELECT * FROM request_timeline ORDER BY id ASC').all()
  });
});

// Serve index.html for frontend navigation routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const filePath = path.join(__dirname, 'public', req.path === '/' ? 'index.html' : req.path);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  next();
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WUP Registrar System running at http://localhost:${PORT}`);
  });
}

module.exports = app;
