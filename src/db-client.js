import WebSocket from 'ws';
import sql from './db.js';
import {updateElos} from './elo.js';

function clampString(str, maxLength = 255) {
  return [...str].slice(0, maxLength).join('');
}

const authorization = process.argv[2];

if (!authorization) {
  throw new Error('No authorization token given');
}

const ws = new WebSocket('ws://localhost:3003');

ws.on('error', error => {
  console.error(error);
});

ws.on('open', () => {
  ws.send(JSON.stringify({type: 'database:hello', authorization}));
});

ws.on('close', () => {
  console.error('Database client disconnected');
});

ws.on('message', async data => {
  console.log('Database client received data');
  let content;
  if (data instanceof Buffer) {
    content = JSON.parse(data.toString());
  } else {
    content = JSON.parse(data);
  }
  console.log('Content:', content);

  if (content.type === 'user') {
    let rows;
    if (content.username) {
      rows = await sql`UPDATE users SET username = ${clampString(
        content.username
      )} WHERE auth_uuid = ${content.authUuid} RETURNING *;`;
    } else {
      rows =
        await sql`SELECT * FROM users WHERE auth_uuid = ${content.authUuid};`;
    }
    if (!rows.length) {
      rows = await sql`INSERT INTO users (username, auth_uuid, elo) VALUES (${
        content.username || 'Anonymous'
      }, ${content.authUuid}, 1000) RETURNING *;`;
    }
    const payload = {
      type: 'user',
      username: rows[0].username,
      elo: rows[0].elo,
    };
    ws.send(
      JSON.stringify({
        type: 'database:user',
        authorization,
        socketId: content.socketId,
        payload,
      })
    );
  }

  if (content.type === 'elo update') {
    const elos = [NaN, NaN];
    for (let i = 0; i < 2; ++i) {
      const rows =
        await sql`SELECT * FROM users WHERE auth_uuid = ${content.authUuids[i]};`;
      elos[i] = rows[0].elo;
    }
    const resultA = content.winner === undefined ? 0.5 : 1 - content.winner;
    const newElos = updateElos(elos[0], elos[1], resultA);
    for (let i = 0; i < 2; ++i) {
      const authUuid = content.authUuids[i];
      let elo = newElos[i];
      // Make the random bot an anchor.
      if (authUuid === process.env.BOT_UUID_RANDOM) {
        elo = 1000;
      }
      await sql`UPDATE users SET elo = ${elo} WHERE auth_uuid = ${authUuid};`;
    }
  }
});
