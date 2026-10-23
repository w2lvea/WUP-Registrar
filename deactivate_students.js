const db = require('./db');
const { hashPassword } = require('./hash');

const activatedStudents = db.prepare('SELECT id, name, email FROM students WHERE must_change_password = 0').all();
console.log('Found activated students:', activatedStudents.map(s => `${s.name} (${s.id})`));

for (const student of activatedStudents) {
  const defaultPassword = student.id.replace(/^WUP-/, '');
  const hashed = hashPassword(defaultPassword);
  db.prepare('UPDATE students SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(hashed, student.id);
  console.log(`Deactivated: ${student.name} (${student.id}) -> reset password to default (${defaultPassword}) & must_change_password = 1`);
}

const deletedSessions = db.prepare("DELETE FROM sessions WHERE role = 'student'").run();
console.log(`Terminated active student sessions: ${deletedSessions.changes}`);

const allStudents = db.prepare('SELECT id, name, must_change_password, email FROM students').all();
console.log('\nCurrent status of all students in database:');
console.table(allStudents);
