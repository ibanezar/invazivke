// Ustvari skrbniški račun: node scripts/add-admin.js <uporabnisko-ime> <geslo>
const db = require('../db');

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Uporaba: node scripts/add-admin.js <uporabnisko-ime> <geslo>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Geslo mora imeti vsaj 8 znakov.');
  process.exit(1);
}
try {
  db.createAdmin(username, password);
  console.log(`Skrbnik "${username}" je ustvarjen.`);
} catch (err) {
  console.error(/UNIQUE/.test(err.message) ? `Skrbnik "${username}" že obstaja.` : err.message);
  process.exit(1);
}
