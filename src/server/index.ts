import {NOMINAL_FRAME_RATE, randomSeed} from 'pujo-puyo-core';
import {clampString, sanitizeClientInfo} from '../util';
import argParse from 'minimist';
import {ClientMessage, DatabaseMessage} from '../api';
import {Player} from './player';
import {
  WebSocketPausingSession,
  WebSocketRealtimeSession,
  WebSocketSession,
} from './session';
import {DatabaseSocket} from './database-socket';

// Command line arguments
const args = argParse(process.argv.slice(2));

// State
const playerBySocketId: Map<number, Player> = new Map();
const sessionBySocketId: Map<
  number,
  WebSocketPausingSession | WebSocketRealtimeSession
> = new Map();

// Bun is still a bit rough around the edges so we spawn a Node process to handle postgres.
const databaseAuthorization = crypto.randomUUID();
let databaseSocket: DatabaseSocket | null = null;

function onPausingComplete(
  session: WebSocketSession,
  players: Player[],
  winner?: number
) {
  players.forEach(player =>
    sessionBySocketId.delete(player.socket.data.socketId)
  );
  if (
    databaseSocket &&
    players.length === 2 &&
    players.every(p => p.authUuid)
  ) {
    databaseSocket.send({
      type: 'elo update',
      gameType: 'pausing',
      winner,
      authUuids: players.map(p => p.authUuid!),
    });
  }
}

function onRealtimeComplete(
  session: WebSocketSession,
  players: Player[],
  winner?: number
) {
  if (activeRealtimeSessions.includes(session as WebSocketRealtimeSession)) {
    activeRealtimeSessions.splice(
      activeRealtimeSessions.indexOf(session as WebSocketRealtimeSession),
      1
    );
  }
  players.forEach(player =>
    sessionBySocketId.delete(player.socket.data.socketId)
  );
  if (
    databaseSocket &&
    players.length === 2 &&
    players.every(p => p.authUuid)
  ) {
    databaseSocket.send({
      type: 'elo update',
      gameType: 'realtime',
      winner,
      authUuids: players.map(p => p.authUuid!),
    });
  }
}

// This loop should probably run in a worker/child process if the cloud server ever upgrades.
// On a single core machine this is better.
const activeRealtimeSessions: WebSocketRealtimeSession[] = [];
let numTicks = 0;
let tickStart: number | null = null;
function tick() {
  if (tickStart === null) {
    tickStart = performance.now();
  }
  for (const session of activeRealtimeSessions) {
    if (args.debug) {
      console.log('Tick of', session.gameSeed, ':', session.age);
    }
    session.tick();
  }
  numTicks++;
  const nextTickTime = tickStart + (1000 / NOMINAL_FRAME_RATE) * numTicks;
  const deltaTime = nextTickTime - performance.now();
  tickId = setTimeout(tick, deltaTime);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tickId: Timer = setTimeout(tick, 1);

const server = Bun.serve<{socketId: number}>({
  fetch(req, server) {
    const success = server.upgrade(req, {
      data: {
        socketId: randomSeed(),
      },
    });
    if (success) {
      // Bun automatically returns a 101 Switching Protocols
      // if the upgrade succeeds
      return undefined;
    }

    // handle HTTP request normally
    return new Response(
      'This is a WebSocket server for Pujo Puyo. Please use a compatible client.'
    );
  },
  websocket: {
    async open(ws) {
      console.log(`New connection opened by ${ws.data.socketId}.`);
      const name = `Anonymous${ws.data.socketId.toString().slice(0, 5)}`;
      playerBySocketId.set(ws.data.socketId, new Player(ws, name, args.debug));
    },
    async close(ws, code, reason) {
      console.log('Connection closed.', code, reason);

      const player = playerBySocketId.get(ws.data.socketId)!;
      playerBySocketId.delete(ws.data.socketId);
      const session = sessionBySocketId.get(ws.data.socketId);
      if (session !== undefined) {
        session.disconnect(player);
      }
    },
    // this is called when a message is received
    async message(ws, message) {
      console.log(`Received ${message} from ${ws.data.socketId}`);

      let content: ClientMessage | DatabaseMessage;
      if (message instanceof Buffer) {
        content = JSON.parse(message.toString());
      } else {
        content = JSON.parse(message);
      }

      if (content.type === 'database:hello') {
        if (content.authorization === databaseAuthorization) {
          console.log('Database connection established.');
          databaseSocket = new DatabaseSocket(ws, databaseAuthorization);
        } else {
          console.error(
            `Fraudulent database connection detected: auth = ${content.authorization} != ${databaseAuthorization}`
          );
        }
        return;
      }

      if (databaseSocket && databaseSocket.reject(content)) {
        return;
      }

      if (content.type === 'database:user') {
        const receiver = playerBySocketId.get(content.socketId);
        if (receiver) {
          receiver.eloRealtime = content.payload.eloRealtime;
          receiver.eloPausing = content.payload.eloPausing;
          receiver.send(content.payload);
        }
        return;
      }

      const player = playerBySocketId.get(ws.data.socketId)!;

      if (content.type === 'user') {
        if (content.username) {
          player.name = clampString(content.username, 64);
        }
        if (content.clientInfo) {
          player.clientInfo = sanitizeClientInfo(content.clientInfo);
        }
        if (content.isBot !== undefined) {
          player.isBot = !!content.isBot;
        }
        if (content.authUuid) {
          player.authUuid = content.authUuid;
        } else {
          content.authUuid = player.authUuid;
        }
        if (databaseSocket) {
          content.socketId = ws.data.socketId;
          databaseSocket.send(content);
        }
        return;
      }

      if (content.type === 'game request') {
        // Disregard request if already in game
        // Note that this only applies per socket. One user may play multiple games.
        if (sessionBySocketId.has(ws.data.socketId)) {
          console.log(`Duplicate game request from ${ws.data.socketId}`);
          return;
        }
        // TODO: Keep an array of open games.
        if (content.gameType === 'pausing') {
          for (const session of sessionBySocketId.values()) {
            if (session.type === 'pausing' && session.players.length < 2) {
              session.players.push(player);
              sessionBySocketId.set(ws.data.socketId, session);
              session.start();
              return;
            }
          }
          const session = new WebSocketPausingSession(player, args.verbose);
          session.onComplete = onPausingComplete;
          sessionBySocketId.set(ws.data.socketId, session);
          return;
        } else {
          for (const session of sessionBySocketId.values()) {
            if (session.type === 'realtime' && session.players.length < 2) {
              session.players.push(player);
              sessionBySocketId.set(ws.data.socketId, session);
              session.start();
              activeRealtimeSessions.push(session);
              return;
            }
          }
          const session = new WebSocketRealtimeSession(player, args.verbose);
          session.onComplete = onRealtimeComplete;
          sessionBySocketId.set(ws.data.socketId, session);
          return;
        }
      }

      const session = sessionBySocketId.get(ws.data.socketId);
      if (session !== undefined) {
        session.onMessage(player, content);
      }
    },
  },
  port: 3003,
});

console.log(`Listening on ${server.hostname}:${server.port}`);

if (args.db === false) {
  console.log('Please connect the database client manually.');
  console.log(databaseAuthorization);
} else {
  Bun.spawnSync(['node', 'src/db-client.js', databaseAuthorization], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
}
