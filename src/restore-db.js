import {readFileSync} from 'fs';
import sql from './db.js';

// TODO: Make streaming before there's too much data.
(async () => {
  const data = JSON.parse(readFileSync(process.argv[2]));

  await sql`DELETE FROM users;`;
  if (data.users.length) {
    await sql`INSERT INTO users ${sql(data.users)};`;
  }

  await sql`DELETE FROM replays;`;
  if (data.replays.length) {
    await sql`INSERT INTO replays ${sql(data.replays)};`;
  }

  await sql.end();
})();
