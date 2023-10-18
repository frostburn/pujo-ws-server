import {ServerWebSocket} from 'bun';
import {
  ApplicationInfo,
  FischerTimer,
  HEIGHT,
  MultiplayerGame,
  ReplayMetadata,
  ReplayResultReason,
  WIDTH,
  randomColorSelection,
  randomSeed,
} from 'pujo-puyo-core';
import {CLIENT_INFO} from './src/util';

let LOG = false;

if (process.argv.length >= 3) {
  LOG = true;
}

const NOMINAL_FRAME_RATE = 30;
// Terminate games that last longer than 10 virtual minutes.
const MAX_GAME_AGE = NOMINAL_FRAME_RATE * 60 * 10;
// These 10 minutes are measured in wall clock time to prune players who leave their browsers open.
const MAX_MOVE_TIME = 10 * 60 * 1000;

type NormalMove = {
  type: 'move';
  player: number;
  x1: number;
  y1: number;
  x2?: number;
  y2?: number;
  orientation?: number;
  hardDrop: boolean;
  pass: false;
  msRemaining: number;
};
type PassingMove = {
  type: 'move';
  player: number;
  pass: true;
  msRemaining: number;
};

type Move = NormalMove | PassingMove;

function clampString(str: string, maxLength = 256) {
  return [...str].slice(0, maxLength).join('');
}

function sanitizeClientInfo(content: any): ApplicationInfo {
  const result: ApplicationInfo = {
    name: clampString(content.name),
    version: clampString(content.version),
  };
  if (content.resolved !== undefined) {
    result.resolved = clampString(content.resolved);
  }
  if (content.core !== undefined) {
    result.core = {
      version: clampString(content.core.version),
    };
    if (content.core.resolved !== undefined) {
      result.core.resolved = clampString(content.core.resolved);
    }
  }
  return result;
}

function sanitizeMove(player: number, content: any): Move {
  if (content.pass) {
    return {
      type: 'move',
      player,
      pass: true,
      msRemaining: parseFloat(content.msRemaining),
    };
  }
  if (content.x2 !== undefined) {
    if (content.y2 === content.y1 - 1) {
      content.orientation = 0;
    } else if (content.y2 === content.y1 + 1) {
      content.orientation = 2;
    } else if (content.x2 === content.x1 - 1) {
      content.orientation = 1;
    } else if (content.x2 === content.x1 + 1) {
      content.orientation = 3;
    } else {
      throw new Error('Unable to sanitize move coordinates');
    }
  }
  return {
    type: 'move',
    player,
    x1: Math.max(0, Math.min(WIDTH - 1, parseInt(content.x1, 10))),
    y1: Math.max(1, Math.min(HEIGHT - 1, parseInt(content.y1, 10))),
    orientation: parseInt(content.orientation, 10) & 3,
    hardDrop: !!content.hardDrop,
    pass: false,
    msRemaining: parseFloat(content.msRemaining),
  };
}

class Player {
  socket: ServerWebSocket<{socketId: number}>;
  name: string;
  clientInfo?: ApplicationInfo;

  constructor(
    socket: ServerWebSocket<{socketId: number}>,
    name: string,
    clientInfo?: ApplicationInfo
  ) {
    this.socket = socket;
    this.name = name;
    this.clientInfo = clientInfo;
  }

  send(message: any) {
    this.socket.send(JSON.stringify(message));
  }
}

class WebSocketGameSession {
  gameSeed: number;
  screenSeed: number;
  colorSelection: number[];
  game: MultiplayerGame;
  players: Player[];
  waitingForMove: boolean[];
  done: boolean;
  hiddenMove: Move | null;
  timeouts: (NodeJS.Timeout | null)[];

  constructor(player: Player) {
    this.gameSeed = randomSeed();
    this.screenSeed = randomSeed();
    this.colorSelection = randomColorSelection();
    this.game = new MultiplayerGame(
      this.gameSeed,
      this.colorSelection,
      this.screenSeed
    );
    this.players = [player];
    // TODO: True multiplayer
    this.waitingForMove = [false, false];
    this.done = false;
    this.hiddenMove = null;
    this.timeouts = [null, null];
  }

  disqualifyPlayer(player: number) {
    const reason: ReplayResultReason = 'timeout';
    const msSince1970 = new Date().valueOf();
    this.players[player].send({
      type: 'game result',
      result: 'loss',
      reason,
      msSince1970,
      verboseReason: 'maximum move time exceeded',
      gameSeed: this.gameSeed,
    });
    this.players[1 - player].send({
      type: 'game result',
      result: 'win',
      reason,
      msSince1970,
      verboseReason: 'opponent timeout',
      gameSeed: this.gameSeed,
    });
    this.complete();
  }

  start() {
    const metadata: ReplayMetadata = {
      names: this.players.map(p => p.name),
      priorWins: [0, 0],
      event: 'Free Play (alpha)',
      site: 'https://pujo.lumipakkanen.com',
      round: 0,
      timeControl: new FischerTimer().toString(),
      msSince1970: new Date().valueOf(),
      server: CLIENT_INFO,
      clients: this.players.map(p => p.clientInfo || null),
    };
    this.players.forEach((player, i) => {
      player.send({
        type: 'game params',
        colorSelection: this.colorSelection,
        screenSeed: this.screenSeed,
        identity: i,
        metadata,
      });
      for (let j = 0; j < this.game.games.length; ++j) {
        player.send({
          type: 'bag',
          player: j,
          bag: this.game.games[j].visibleBag,
        });
      }
      this.waitingForMove[i] = true;
      const latePlayer = i;
      this.timeouts[i] = setTimeout(
        () => this.disqualifyPlayer(latePlayer),
        MAX_MOVE_TIME
      );
    });
    if (LOG) {
      this.game.log();
      console.log(`Starting game ${this.gameSeed} (${this.screenSeed})`);
    }
  }

  complete() {
    if (this.done) {
      return;
    }
    this.done = true;
    this.timeouts.forEach(timeout => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
    });
    this.players.forEach(player =>
      sessionBySocketId.delete(player.socket.data.socketId)
    );
  }

  disconnect(player: Player) {
    if (this.done) {
      return;
    }
    this.players.forEach(opponent => {
      if (opponent !== player) {
        const reason: ReplayResultReason = 'disconnect';
        const msSince1970 = new Date().valueOf();
        opponent.send({
          type: 'game result',
          result: 'win',
          reason,
          msSince1970,
          verboseReason: 'opponent disconnected',
          gameSeed: this.gameSeed,
        });
      }
    });
    this.complete();
  }

  message(player: Player, content: any) {
    if (this.done) {
      return;
    }
    const index = this.players.indexOf(player);

    if (content.type === 'simple state request') {
      player.send({
        type: 'simple state',
        state: this.game.toSimpleGame(index),
      });
    } else if (content.type === 'result') {
      const loser = index;
      const winner = 1 - loser;
      const reason: ReplayResultReason = clampString(
        content.reason
      ) as ReplayResultReason;
      const msSince1970 = new Date().valueOf();
      this.players[winner].send({
        type: 'game result',
        result: 'win',
        reason,
        msSince1970,
        gameSeed: this.gameSeed,
      });
      this.players[loser].send({
        type: 'game result',
        result: 'loss',
        reason,
        msSince1970,
        gameSeed: this.gameSeed,
      });
      this.complete();
    } else if (content.type === 'move') {
      if (!this.waitingForMove[index]) {
        return;
      }
      const move = sanitizeMove(index, content);
      clearTimeout(this.timeouts[move.player]!);
      if (!move.pass) {
        const playedMove = this.game.play(
          move.player,
          move.x1,
          move.y1,
          move.orientation!,
          move.hardDrop
        );
        move.x1 = playedMove.x1;
        move.y1 = playedMove.y1;
        move.x2 = playedMove.x2;
        move.y2 = playedMove.y2;
      }
      // Hide the first of simultaneous moves
      if (this.waitingForMove.every(w => w)) {
        if (LOG) {
          console.log('Hiding move by', move.player);
        }
        this.players[1 - move.player].send({
          type: 'timer',
          msRemaining: move.msRemaining,
        });
        this.players[move.player].send(move);
        this.hiddenMove = move;
      } else if (this.hiddenMove !== null) {
        if (LOG) {
          console.log('Revealing move by', this.hiddenMove.player);
        }
        this.players[1 - this.hiddenMove.player].send(this.hiddenMove);
        this.hiddenMove = null;
        this.players.forEach(p => p.send(move));
      } else {
        this.players.forEach(p => p.send(move));
      }
      this.waitingForMove[index] = false;

      while (
        this.game.games.every(game => game.busy) ||
        (move.pass && this.game.games.some(game => game.busy))
      ) {
        const tickResults = this.game.tick();

        if (this.done) {
          return;
        }

        if (tickResults[0].lockedOut && tickResults[1].lockedOut) {
          const reason: ReplayResultReason = 'double lockout';
          const msSince1970 = new Date().valueOf();
          this.players.forEach(p =>
            p.send({
              type: 'game result',
              result: 'draw',
              reason,
              msSince1970,
              verboseReason: 'double lockout',
              gameSeed: this.gameSeed,
            })
          );
          this.complete();
        } else if (tickResults[0].lockedOut || tickResults[1].lockedOut) {
          const winner = tickResults[0].lockedOut ? 1 : 0;
          const loser = 1 - winner;
          const reason: ReplayResultReason = 'lockout';
          const msSince1970 = new Date().valueOf();
          this.players[winner].send({
            type: 'game result',
            result: 'win',
            reason,
            msSince1970,
            verboseReason: 'opponent lockout',
            gameSeed: this.gameSeed,
          });
          this.players[loser].send({
            type: 'game result',
            result: 'loss',
            reason,
            msSince1970,
            verboseReason: 'lockout',
            gameSeed: this.gameSeed,
          });
          this.complete();
        } else if (this.game.age > MAX_GAME_AGE) {
          const reason: ReplayResultReason = 'max time exceeded';
          const msSince1970 = new Date().valueOf();
          this.players.forEach(p =>
            p.send({
              type: 'game result',
              result: 'draw',
              reason,
              msSince1970,
              verboseReason: 'time limit exceeded',
              gameSeed: this.gameSeed,
            })
          );
          this.complete();
        }
      }

      if (this.done) {
        return;
      }

      for (let i = 0; i < this.players.length; ++i) {
        if (!this.game.games[i].busy && !this.waitingForMove[i]) {
          this.players.forEach(p =>
            p.send({
              type: 'bag',
              player: i,
              bag: this.game.games[i].visibleBag,
            })
          );
          if (LOG) {
            this.game.log();
            console.log('Sent bag of', i, this.game.games[i].visibleBag);
          }
          this.waitingForMove[i] = true;
          const latePlayer = i;
          this.timeouts[i] = setTimeout(
            () => this.disqualifyPlayer(latePlayer),
            MAX_MOVE_TIME
          );
        }
      }
    }
  }
}

const playerBySocketId: Map<number, Player> = new Map();
const sessionBySocketId: Map<number, WebSocketGameSession> = new Map();

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
      playerBySocketId.set(ws.data.socketId, new Player(ws, name));
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

      let content;
      if (message instanceof Buffer) {
        content = message.toJSON();
      } else {
        content = JSON.parse(message);
      }

      const player = playerBySocketId.get(ws.data.socketId)!;

      if (content.type === 'game request') {
        if (content.name !== undefined) {
          player.name = clampString(content.name, 64);
        }
        if (content.clientInfo !== undefined) {
          player.clientInfo = sanitizeClientInfo(content.clientInfo);
        }
        // Disregard request if already in game
        if (sessionBySocketId.has(ws.data.socketId)) {
          console.log(`Duplicate game request from ${ws.data.socketId}`);
          return;
        }
        // TODO: Keep an array of open games.
        for (const session of sessionBySocketId.values()) {
          if (session.players.length < 2) {
            session.players.push(player);
            sessionBySocketId.set(ws.data.socketId, session);
            session.start();
            return;
          }
        }
        sessionBySocketId.set(
          ws.data.socketId,
          new WebSocketGameSession(player)
        );
        return;
      }

      const session = sessionBySocketId.get(ws.data.socketId);
      if (session !== undefined) {
        session.message(player, content);
      }
    },
  },
  port: 3003,
});

console.log(`Listening on ${server.hostname}:${server.port}`);
