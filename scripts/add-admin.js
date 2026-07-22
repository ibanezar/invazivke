// Ustvari skrbniški račun: node scripts/add-admin.js <uporabnisko-ime> <geslo> [vloga]
// Vloga: urednik (privzeto, sme verificirati in brisati) ali pregledovalec (samo pregled).
const db = require('../db');

const [username, password, role = 'urednik'] = process.argv.slice(2);
if (!username || !password) {
  console.error('Uporaba: node scripts/add-admin.js <uporabnisko-ime> <geslo> [urednik|pregledovalec]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Geslo mora imeti vsaj 8 znakov.');
  process.exit(1);
}
if (!db.ROLES.includes(role)) {
  console.error(`Neveljavna vloga "${role}". Dovoljeni: ${db.ROLES.join(', ')}.`);
  process.exit(1);
}
db.createAdmin(username, password, role)
  .then(() => console.log(`Skrbnik "${username}" (${role}) je ustvarjen.`))
  .catch((err) => {
    console.error(/UNIQUE/.test(err.message) ? `Skrbnik "${username}" že obstaja.` : err.message);
    process.exit(1);
  });
