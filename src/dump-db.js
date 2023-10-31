import sql from './db.js';

// TODO: Make streaming before there's too much data.
(async () => {
  const users = await sql`SELECT * FROM users;`;
  const replays = await sql`SELECT * FROM replays;`;

  process.stdout.write(JSON.stringify({users, replays}));
  process.stdout.write('\n');

  await sql.end();
})();
