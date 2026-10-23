// ============================================================
// WUP Registrar System — SQLite to Supabase Data Migrator
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Load environment variables if .env exists
if (fs.existsSync(path.join(__dirname, '.env'))) {
  try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) {}
}

const supabaseUrl = process.env.SUPABASE_URL || process.argv[2];
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.argv[3];

if (!supabaseUrl || !supabaseKey) {
  console.error('\n[ERROR] Missing Supabase credentials!');
  console.error('Usage:');
  console.error('  1. Add to .env:');
  console.error('       SUPABASE_URL=https://xxxx.supabase.co');
  console.error('       SUPABASE_KEY=your-service-role-or-anon-key');
  console.error('     Then run: node migrate_to_supabase.js\n');
  console.error('  OR pass as command line arguments:');
  console.error('       node migrate_to_supabase.js <SUPABASE_URL> <SUPABASE_KEY>\n');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const dbPath = path.join(__dirname, 'data/wup_registrar.db');

if (!fs.existsSync(dbPath)) {
  console.error(`[ERROR] SQLite database not found at ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

async function migrate() {
  console.log('====================================================');
  console.log('    MIGRATING SQLITE DATA TO SUPABASE               ');
  console.log('====================================================');
  console.log(`Target: ${supabaseUrl}\n`);

  try {
    // 1. Students
    const students = db.prepare('SELECT * FROM students').all();
    console.log(`Migrating ${students.length} students...`);
    const { error: stuErr } = await supabase.from('students').upsert(students, { onConflict: 'id' });
    if (stuErr) throw new Error('Students migration failed: ' + stuErr.message);
    console.log('  -> OK!');

    // 2. Staff
    const staff = db.prepare('SELECT * FROM staff').all();
    console.log(`Migrating ${staff.length} staff accounts...`);
    const { error: staffErr } = await supabase.from('staff').upsert(staff, { onConflict: 'username' });
    if (staffErr) throw new Error('Staff migration failed: ' + staffErr.message);
    console.log('  -> OK!');

    // 3. Documents
    const documents = db.prepare('SELECT name, description, active, sort_order FROM documents').all();
    console.log(`Migrating ${documents.length} documents...`);
    const { error: docErr } = await supabase.from('documents').upsert(documents, { onConflict: 'name' });
    if (docErr) throw new Error('Documents migration failed: ' + docErr.message);
    console.log('  -> OK!');

    // 4. Fees
    const fees = db.prepare('SELECT name, price, sort_order FROM fees').all();
    console.log(`Migrating ${fees.length} clearance fees...`);
    const { error: feesErr } = await supabase.from('fees').upsert(fees, { onConflict: 'name' });
    if (feesErr) throw new Error('Fees migration failed: ' + feesErr.message);
    console.log('  -> OK!');

    // 5. Official Receipts
    const receipts = db.prepare('SELECT * FROM official_receipts').all();
    console.log(`Migrating ${receipts.length} official receipts...`);
    // Batch in chunks of 50
    for (let i = 0; i < receipts.length; i += 50) {
      const chunk = receipts.slice(i, i + 50);
      const { error: recErr } = await supabase.from('official_receipts').upsert(chunk, { onConflict: 'or_number' });
      if (recErr) throw new Error('Receipts migration failed: ' + recErr.message);
    }
    console.log('  -> OK!');

    // 6. Requests
    const requests = db.prepare('SELECT * FROM requests').all();
    console.log(`Migrating ${requests.length} requests...`);
    for (const req of requests) {
      const { error: reqErr } = await supabase.from('requests').upsert([req], { onConflict: 'ref' });
      if (reqErr) {
        console.warn(`  Warning on request ${req.ref}: ${reqErr.message}`);
      }
    }
    console.log('  -> OK!');

    // 7. Request Items
    const items = db.prepare('SELECT ref, name, copies FROM request_items').all();
    console.log(`Migrating ${items.length} request items...`);
    for (let i = 0; i < items.length; i += 50) {
      const chunk = items.slice(i, i + 50);
      const { error: itemErr } = await supabase.from('request_items').insert(chunk);
      if (itemErr) console.warn('  Warning inserting items:', itemErr.message);
    }
    console.log('  -> OK!');

    // 8. Request Timeline
    const timeline = db.prepare('SELECT ref, title, time FROM request_timeline').all();
    console.log(`Migrating ${timeline.length} timeline events...`);
    for (let i = 0; i < timeline.length; i += 50) {
      const chunk = timeline.slice(i, i + 50);
      const { error: timeErr } = await supabase.from('request_timeline').insert(chunk);
      if (timeErr) console.warn('  Warning inserting timeline events:', timeErr.message);
    }
    console.log('  -> OK!');

    console.log('\n====================================================');
    console.log('  MIGRATION COMPLETE! All data is now in Supabase.   ');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n[FATAL ERROR]', err.message);
    process.exit(1);
  }
}

migrate();
