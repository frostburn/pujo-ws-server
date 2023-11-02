import WebSocket from 'ws';
import sql from './db.js';
import {updateElos} from './elo.js';
import {loadReplay, saveReplay} from './storage.js';

const MAX_REPLAYS_PER_ORDERED_PAIR = 500;

function clampString(str, maxLength = 255) {
  return [...str].slice(0, maxLength).join('');
}

const authorization = process.argv[2];

if (!authorization) {
  throw new Error('No authorization token given');
}

const ws = new WebSocket('ws://localhost:3003');

ws.on('error', error => {
  console.error('Websocket error:', error);
});

ws.on('open', () => {
  ws.send(JSON.stringify({type: 'database:hello', authorization}));
});

ws.on('close', () => {
  console.error('Database client disconnected');
});

function relayPayload(ws, type, content, payload) {
  ws.send(
    JSON.stringify({
      type,
      authorization,
      socketId: content.socketId,
      payload,
    })
  );
}

async function onMessage(data) {
  console.log('Database client received data');
  let content;
  if (data instanceof Buffer) {
    content = JSON.parse(data.toString());
  } else {
    content = JSON.parse(data);
  }
  console.log('Content:', content);

  if (content.type === 'self') {
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
      rows =
        await sql`INSERT INTO users (username, auth_uuid, elo_realtime, elo_pausing) VALUES (${
          content.username || 'Anonymous'
        }, ${content.authUuid}, 1000, 1000) RETURNING *;`;
    }
    const payload = {
      type: 'self',
      username: rows[0].username,
      eloRealtime: rows[0].eloRealtime,
      eloPausing: rows[0].eloPausing,
    };
    relayPayload(ws, 'database:self', content, payload);
    return;
  }

  if (content.type === 'get user') {
    const rows =
      await sql`SELECT username, elo_realtime, elo_pausing FROM users WHERE id = ${content.id};`;
    const user = rows.length ? rows[0] : undefined;
    const payload = {
      type: 'user',
      user,
    };
    relayPayload(ws, 'database:user', content, payload);
    return;
  }

  if (content.type === 'elo update') {
    const elos = [NaN, NaN];
    for (let i = 0; i < 2; ++i) {
      const rows =
        await sql`SELECT * FROM users WHERE auth_uuid = ${content.authUuids[i]};`;
      elos[i] =
        content.gameType === 'realtime'
          ? rows[0].eloRealtime
          : rows[0].eloPausing;
    }
    const resultA = content.winner === undefined ? 0.5 : 1 - content.winner;
    const newElos = updateElos(elos[0], elos[1], resultA);
    for (let i = 0; i < 2; ++i) {
      const authUuid = content.authUuids[i];
      let elo = newElos[i];
      // Make the random bot an anchor.
      if (authUuid === process.env.BOT_UUID_RANDOM) {
        elo = 1000;
      } else if (authUuid === process.env.BOT_UUID_SOFT_RANDOM) {
        // Based on a score of 100569.5 out of 194877 games against random.
        elo = 1011;
      } else if (authUuid === process.env.BOT_UUID_FLEX1) {
        // Based on a score of 104194 out of 104330 games against random.
        elo = 2154;
      } else if (authUuid === process.env.BOT_UUID_SOFT_FLEX1) {
        // Based on a score of 99075 out of 100026 games against random.
        elo = 1807;
      }
      if (content.gameType === 'realtime') {
        await sql`UPDATE users SET elo_realtime = ${elo} WHERE auth_uuid = ${authUuid};`;
      } else {
        await sql`UPDATE users SET elo_pausing = ${elo} WHERE auth_uuid = ${authUuid};`;
      }
    }
    return;
  }

  if (content.type === 'replay') {
    const userIds = [];
    for (const authUuid of content.authUuids) {
      const rows =
        await sql`SELECT id FROM users WHERE auth_uuid = ${authUuid};`;
      userIds.push(rows[0].id);
    }
    if (content.marginFrames === null) {
      content.marginFrames = Infinity;
    }
    if (content.mercyFrames === null) {
      content.mercyFrames = Infinity;
    }
    await saveReplay(content.replay, content.private, userIds);

    const rows =
      await sql`SELECT COUNT(id) FROM replays WHERE left_player = ${userIds[0]} AND right_player = ${userIds[1]};`;
    const count = rows[0].count;
    if (count > MAX_REPLAYS_PER_ORDERED_PAIR) {
      const excess = count - MAX_REPLAYS_PER_ORDERED_PAIR;
      await sql`DELETE FROM replays WHERE id IN (
        SELECT id FROM replays WHERE left_player = ${userIds[0]} AND right_player = ${userIds[1]} ORDER BY id LIMIT ${excess}
      );`;
    }
    return;
  }

  if (content.type === 'list replays') {
    const limit = Math.max(1, Math.min(50, parseInt(content.limit) | 0));
    const offset = Math.max(0, parseInt(content.offset) | 0);
    let orderBy;
    if (content.direction === 'DESC') {
      orderBy = sql`ORDER BY ${content.orderBy ?? 'id'} DESC`;
    } else {
      orderBy = sql`ORDER BY ${content.orderBy ?? 'id'} ASC`;
    }
    let where = sql`WHERE NOT private`;
    if (content.userId !== undefined) {
      where = sql`WHERE NOT private AND (left_player = ${content.userId} OR right_player = ${content.userId})`;
    }
    const replays = await sql`
      SELECT id, winner, reason, names, elos, event, site, round, ms_since1970, end_time, type, time_control, left_player, right_player
        FROM replays ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset};`;

    for (const replay of replays) {
      replay.userIds = [replay.leftPlayer, replay.rightPlayer];
      delete replay.leftPlayer;
      delete replay.rightPlayer;
      replay.msSince1970 = parseInt(replay.msSince1970, 10);
      if (replay.endTime) {
        replay.endTime = parseInt(replay.endTime, 10);
      }
    }

    const payload = {
      type: 'replays',
      replays,
    };
    relayPayload(ws, 'database:replays', content, payload);
    return;
  }

  if (content.type === 'get replay') {
    const replay = await loadReplay(content.id);
    const payload = {
      type: 'replay',
      replay,
    };
    relayPayload(ws, 'database:replay', content, payload);
    return;
  }
}

ws.on('message', async data => {
  try {
    await onMessage(data);
  } catch (e) {
    console.error(e);
  }
});
