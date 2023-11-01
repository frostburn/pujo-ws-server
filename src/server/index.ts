import {NOMINAL_FRAME_RATE, randomSeed} from 'pujo-puyo-core';
import {clampString, sanitizeChallenge, sanitizeClientInfo} from '../util';
import argParse from 'minimist';
import {Challenge, ClientMessage, DatabaseMessage} from '../api';
import {Player} from './player';
import {PausingSession, RealtimeSession, WebSocketSession} from './session';
import {DatabaseSocket} from './database-socket';

// Command line arguments
const args = argParse(process.argv.slice(2));

// Types
interface OpenChallenge extends Challenge {
  player: Player;
  password?: string;
}

// State
const playerBySocketId: Map<number, Player> = new Map();
const challenges: Set<OpenChallenge> = new Set();
const sessionBySocketId: Map<number, PausingSession | RealtimeSession> =
  new Map();

// Bun is still a bit rough around the edges so we spawn a Node process to handle postgres.
const databaseAuthorization = crypto.randomUUID();
let databaseSocket: DatabaseSocket | null = null;

function onPausingComplete(session: WebSocketSession) {
  session.players.forEach(player =>
    sessionBySocketId.delete(player.socket.data.socketId)
  );
  if (
    databaseSocket &&
    session.players.length === 2 &&
    session.players.every(p => p.authUuid)
  ) {
    const authUuids = session.players.map(p => p.authUuid!);
    databaseSocket.send({
      type: 'elo update',
      gameType: 'pausing',
      winner: session.winner,
      authUuids,
    });
    databaseSocket.send({
      type: 'replay',
      replay: session.toReplay(),
      authUuids,
    });
  }
}

function onRealtimeComplete(session: WebSocketSession) {
  if (activeRealtimeSessions.includes(session as RealtimeSession)) {
    activeRealtimeSessions.splice(
      activeRealtimeSessions.indexOf(session as RealtimeSession),
      1
    );
  }
  session.players.forEach(player =>
    sessionBySocketId.delete(player.socket.data.socketId)
  );
  if (
    databaseSocket &&
    session.players.length === 2 &&
    session.players.every(p => p.authUuid)
  ) {
    const authUuids = session.players.map(p => p.authUuid!);
    databaseSocket.send({
      type: 'elo update',
      gameType: 'realtime',
      winner: session.winner,
      authUuids,
    });
    databaseSocket.send({
      type: 'replay',
      replay: session.toReplay(),
      authUuids,
    });
  }
}

// This loop should probably run in a worker/child process if the cloud server ever upgrades.
// On a single core machine this is better.
const activeRealtimeSessions: RealtimeSession[] = [];
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

function startSession(challenge: OpenChallenge, challenger: Player) {
  const players = [challenge.player, challenger];
  let session: PausingSession | RealtimeSession;
  if (challenge.gameType === 'pausing') {
    session = new PausingSession(players, args.verbose);
    session.onComplete = onPausingComplete;
  } else {
    session = new RealtimeSession(players, args.verbose);
    session.onComplete = onRealtimeComplete;
    activeRealtimeSessions.push(session);
  }
  players.forEach(p => sessionBySocketId.set(p.socket.data.socketId, session));
  session.start();
  challenges.delete(challenge);
}

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

      for (const challenge of challenges) {
        if (challenge.player === player) {
          challenges.delete(challenge);
          break;
        }
      }

      playerBySocketId.delete(ws.data.socketId);
      const session = sessionBySocketId.get(ws.data.socketId);
      if (session !== undefined) {
        session.disconnect(player);
      }
    },
    // this is called when a message is received
    async message(ws, message) {
      if (message === 'ping') {
        ws.send('pong');
        if (args.verbose) {
          console.log(`Heartbeat from ${ws.data.socketId}`);
        }
        return;
      }

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
          player.authUuid = clampString(content.authUuid);
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
        if (content.autoMatch) {
          for (const challenge of challenges) {
            if (!challenge.autoMatch || challenge.password !== undefined) {
              continue;
            }
            if (!content.botsAllowed && challenge.player.isBot) {
              continue;
            }
            if (!challenge.botsAllowed && player.isBot) {
              continue;
            }
            if (
              challenge.gameType === content.gameType &&
              challenge.ranked === content.ranked
            ) {
              startSession(challenge, player);
              return;
            }
          }
          // No open challenge found. Make one.
          const challenge = sanitizeChallenge(content);
          challenges.add({
            player,
            ...challenge,
          });
        } else {
          const challenge = sanitizeChallenge(content);
          challenges.add({
            player,
            ...challenge,
          });
        }
        return;
      }
      if (content.type === 'cancel game request') {
        for (const challenge of challenges) {
          if (challenge.player === player) {
            challenges.delete(challenge);
            return;
          }
        }
        return;
      }
      if (content.type === 'challenge list') {
        const listing: Challenge[] = [];
        for (const challenge of challenges) {
          if (challenge.password !== undefined) {
            continue;
          }
          // Strip away player to protect user info
          listing.push({
            uuid: challenge.uuid,
            name: challenge.name ?? challenge.player.name,
            ranked: challenge.ranked,
            gameType: challenge.gameType,
            autoMatch: challenge.autoMatch,
            botsAllowed: challenge.botsAllowed,
          });
        }
        player.send({
          type: 'challenge list',
          challenges: listing,
        });
        return;
      }
      if (content.type === 'accept challenge') {
        for (const challenge of challenges) {
          if (
            challenge.password !== undefined &&
            challenge.password === content.password
          ) {
            startSession(challenge, player);
            return;
          }
          if (challenge.uuid === content.uuid) {
            startSession(challenge, player);
            return;
          }
        }
        player.send({
          type: 'challenge not found',
          uuid: content.uuid,
          password: content.password,
        });
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
