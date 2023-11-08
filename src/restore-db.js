import {readFileSync} from 'fs';
import sql from './db.js';
import {saveReplay} from './storage.js';

// TODO: Make streaming before there's too much data.
(async () => {
  const data = JSON.parse(readFileSync(process.argv[2]));

  await sql`DELETE FROM replays;`;
  await sql`DELETE FROM users;`;

  if (data.users.length) {
    await sql`INSERT INTO users ${sql(data.users)};`;
  }

  for (const replay of data.replays) {
    await saveReplay(replay, replay.private, [
      replay.leftPlayer,
      replay.rightPlayer,
    ]);
  }

  await sql.end();
})();
