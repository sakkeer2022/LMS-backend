// Shows the development mailbox (EMAIL_TRANSPORT=log writes it): `npm run mail` prints the latest
// message, `npm run mail -- --follow` also prints each new one as it arrives.
const fs = require('node:fs');
const file = process.env.EMAIL_LOG_FILE || '.data/emails/outbox.log';

const entries = () =>
  fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split(/^(?===== )/m).filter((entry) => entry.trim())
    : [];

const shown = entries();
if (shown.length === 0) console.log(`No emails yet in ${file}. Trigger one (for example a signup code).`);
else process.stdout.write(shown[shown.length - 1]);

if (process.argv.includes('--follow')) {
  let seen = shown.length;
  fs.watchFile(file, { interval: 500 }, () => {
    const all = entries();
    all.slice(seen).forEach((entry) => process.stdout.write(entry));
    seen = all.length;
  });
}
