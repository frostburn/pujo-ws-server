import sql from './db.js';
import {loadReplay} from './storage.js';

// TODO: Make streaming before there's too much data.
(async () => {
  const users = await sql`SELECT * FROM users;`;
  const rows =
    await sql`SELECT id, private, left_player, right_player FROM replays;`;

  const replays = [];
  for (const row of rows) {
    const replay = await loadReplay(row.id);
    replay.private = row.private;
    replay.leftPlayer = row.leftPlayer;
    replay.rightPlayer = row.rightPlayer;
    replays.push(replay);
  }

  process.stdout.write(JSON.stringify({users, replays}));
  process.stdout.write('\n');

  await sql.end();
})();
