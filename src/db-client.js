import WebSocket from 'ws';
import sql from './db.js';

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

  if (content.type === 'user request') {
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
});
