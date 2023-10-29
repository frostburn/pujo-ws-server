import {
  FischerTimer,
  MultiplayerGame,
  NOMINAL_FRAME_RATE,
  ReplayMetadata,
  ReplayResultReason,
  TimeWarpingGame,
  randomColorSelection,
  randomSeed,
} from 'pujo-puyo-core';
import {Player} from './player';
import {
  ClientMessage,
  GameResult,
  PausingMove,
  PieceMessage,
  RealtimeMove,
  Retcon,
  ServerPausingMove,
  ServerRealtimeMove,
} from '../api';
import {
  CLIENT_INFO,
  MAX_CONSECUTIVE_REROLLS,
  clampString,
  sanitizePausingMove,
  sanitizeRealtimeMove,
} from '../util';

// Terminate games that last longer than 10 virtual minutes.
const MAX_GAME_AGE = NOMINAL_FRAME_RATE * 60 * 10;
// These 10 minutes are measured in wall clock time to prune players who leave their browsers open.
const MAX_MOVE_TIME = 10 * 60 * 1000;

// 500ms measured in frames
const MAX_LAG = 15;
// 100ms measured in frames
const MAX_ADVANTAGE = 3;

const CHECKPOINT_INTERVAL = 5;
const MAX_CHECKPOINTS = 10;

export type CompleteCallback = (
  session: WebSocketSession,
  players: Player[],
  winner?: number
) => void;

export class WebSocketSession {
  gameSeed: number;
  screenSeed: number;
  colorSelections: number[][];
  players: Player[];
  ready: boolean[];
  waitingForMove: boolean[];
  done: boolean;
  timeouts: (Timer | null)[];
  verbose: boolean;
  onComplete?: CompleteCallback;

  constructor(player: Player, verbose?: boolean) {
    this.gameSeed = randomSeed();
    this.screenSeed = randomSeed();
    const colorSelection = randomColorSelection();
    this.colorSelections = [colorSelection, colorSelection];
    this.players = [player];
    // TODO: True multiplayer
    this.ready = [false, false];
    this.waitingForMove = [false, false];
    this.done = false;
    this.timeouts = [null, null];
    this.verbose = !!verbose;
  }

  start(origin: MultiplayerGame, metadata: ReplayMetadata) {
    const initialBags = origin.initialBags;
    this.players.forEach((player, i) => {
      this.ready[i] = false;
      player.send({
        type: 'game params',
        colorSelections: this.colorSelections,
        screenSeed: this.screenSeed,
        targetPoints: origin.targetPoints,
        marginFrames: origin.marginFrames,
        mercyFrames: origin.mercyFrames,
        initialBags,
        identity: i,
        metadata,
      });
      this.waitForMove(i);
    });
    if (this.verbose) {
      origin.log();
      console.log(`Starting game ${this.gameSeed} (${this.screenSeed})`);
    }
  }

  waitForMove(player: number) {
    this.waitingForMove[player] = true;
    const latePlayer = player;
    this.timeouts[player] = setTimeout(
      () => this.disqualifyPlayer(latePlayer),
      MAX_MOVE_TIME
    );
  }

  disqualifyPlayer(player: number, reason: ReplayResultReason = 'timeout') {
    const winner = 1 - player;
    this.sendResult(winner, reason);
    this.complete(winner);
  }

  sendResult(winner: number | undefined, reason: ReplayResultReason) {
    const msSince1970 = new Date().valueOf();
    const result: GameResult = {
      type: 'game result',
      winner,
      reason,
      msSince1970,
      gameSeed: this.gameSeed,
    };
    if (this.verbose) {
      console.log('Sending result', result);
    }
    this.players.forEach(p => p.send(result));
  }

  complete(winner?: number) {
    if (this.done) {
      return;
    }
    this.done = true;
    this.timeouts.forEach(timeout => {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
    });
    if (this.onComplete) {
      this.onComplete(this, this.players, winner);
    }
  }

  disconnect(player: Player) {
    if (this.done) {
      return;
    }
    // XXX: Assumes a duel
    let winner: number | undefined;
    this.players.forEach((opponent, i) => {
      if (opponent !== player) {
        winner = i;
        const reason: ReplayResultReason = 'disconnect';
        const msSince1970 = new Date().valueOf();
        const result: GameResult = {
          type: 'game result',
          winner,
          reason,
          msSince1970,
          gameSeed: this.gameSeed,
        };
        if (this.verbose) {
          console.log('Sending result', result);
        }
        opponent.send(result);
      }
    });
    this.complete(winner);
  }

  onMessage(player: Player, content: ClientMessage) {
    if (this.done) {
      return;
    }
    const index = this.players.indexOf(player);

    if (content.type === 'ready') {
      this.ready[index] = true;
      if (this.ready.every(Boolean)) {
        this.players.forEach(p => p.send({type: 'go'}));
        this.postGo();
      }
    } else if (content.type === 'simple state request') {
      this.onSimpleGameRequest(player);
    } else if (content.type === 'result') {
      const winner = 1 - index;
      const reason: ReplayResultReason = clampString(
        content.reason
      ) as ReplayResultReason;
      this.sendResult(winner, reason);
      this.complete(winner);
    } else if (
      content.type === 'pausing move' ||
      content.type === 'realtime move'
    ) {
      if (content.type === 'pausing move' && !this.waitingForMove[index]) {
        return;
      }
      clearTimeout(this.timeouts[index]!);
      this.waitingForMove[index] = false;
      // Subclass hook
      this.onMove(index, content);
    }
  }

  postGo() {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onSimpleGameRequest(player: Player) {
    throw new Error('Subclasses must implement onSimpleGameRequest method');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onMove(player: number, move: PausingMove | RealtimeMove) {
    throw new Error('Subclasses must implement an onMove method');
  }

  postTick(game: MultiplayerGame) {
    if (this.done) {
      return;
    }
    if (game.games[0].lockedOut && game.games[1].lockedOut) {
      const reason: ReplayResultReason = 'double lockout';
      const winner = undefined;
      this.sendResult(winner, reason);
      this.complete(winner);
    } else if (game.games[0].lockedOut || game.games[1].lockedOut) {
      const winner = game.games[0].lockedOut ? 1 : 0;
      const reason: ReplayResultReason = 'lockout';
      this.sendResult(winner, reason);
      this.complete(winner);
    } else if (
      game.games.every(g => g.consecutiveRerolls >= MAX_CONSECUTIVE_REROLLS)
    ) {
      const reason: ReplayResultReason = 'impasse';
      const winner = undefined;
      this.sendResult(winner, reason);
      this.complete(winner);
    } else if (game.age > MAX_GAME_AGE) {
      const reason: ReplayResultReason = 'max time exceeded';
      const winner = undefined;
      this.sendResult(winner, reason);
      this.complete(winner);
    }
  }
}

export class WebSocketPausingSession extends WebSocketSession {
  game: MultiplayerGame;
  passed: boolean[];
  hiddenMove: ServerPausingMove | null;

  constructor(player: Player, verbose?: boolean) {
    super(player, verbose);
    this.game = new MultiplayerGame(
      this.gameSeed,
      this.screenSeed,
      this.colorSelections
    );
    this.passed = [false, false];
    this.hiddenMove = null;
  }

  start() {
    const metadata: ReplayMetadata = {
      names: this.players.map(p => p.name),
      elos: this.players.map(p => p.eloPausing),
      priorWins: [0, 0],
      event: 'Free Play (pausing / alpha)',
      site: 'https://pujo.lumipakkanen.com',
      round: 0,
      timeControl: new FischerTimer().toString(),
      msSince1970: new Date().valueOf(),
      type: 'pausing',
      server: CLIENT_INFO,
      clients: this.players.map(p => p.clientInfo || null),
    };
    super.start(this.game, metadata);
  }

  postGo() {
    for (const player of this.players) {
      for (let j = 0; j < this.game.games.length; ++j) {
        player.send({
          type: 'piece',
          time: this.game.age,
          player: j,
          piece: this.game.games[j].nextPiece,
        });
      }
    }
  }

  onSimpleGameRequest(player: Player): void {
    const index = this.players.indexOf(player);
    player.send({
      type: 'simple state',
      state: this.game.toSimpleGame(index),
    });
  }

  onMove(player: number, content: PausingMove | RealtimeMove) {
    if (content.type !== 'pausing move') {
      throw new Error('Wrong move type for a pausing session');
    }
    const sanitized = sanitizePausingMove(content);
    let move: ServerPausingMove;
    if (sanitized.pass) {
      this.passed[player] = true;
      move = {player, ...sanitized};
    } else {
      const playedMove = this.game.play(
        player,
        sanitized.x1,
        sanitized.y1,
        sanitized.orientation,
        sanitized.hardDrop
      );
      move = {
        type: 'pausing move',
        msRemaining: sanitized.msRemaining,
        pass: false,
        ...playedMove,
      };
    }
    // Hide the first of simultaneous moves
    if (this.waitingForMove.every(w => w)) {
      if (this.verbose) {
        console.log('Hiding move by', move.player);
      }
      this.players[1 - move.player].send({
        type: 'timer',
        player: move.player,
        msRemaining: move.msRemaining,
      });
      this.players[move.player].send(move);
      this.hiddenMove = move;
    } else if (this.hiddenMove !== null) {
      if (this.verbose) {
        console.log('Revealing move by', this.hiddenMove.player);
      }
      this.players[1 - this.hiddenMove.player].send(this.hiddenMove);
      this.hiddenMove = null;
      this.players.forEach(p => p.send(move));
    } else {
      this.players.forEach(p => p.send(move));
    }

    while (
      this.game.games.every(game => game.busy) ||
      (move.pass && this.game.games.some(game => game.busy))
    ) {
      this.game.tick();
      this.postTick(this.game);
      if (this.done) {
        return;
      }
    }

    for (let i = 0; i < this.players.length; ++i) {
      if (!this.game.games[i].busy && !this.waitingForMove[i]) {
        let piece: number[];
        if (this.passed[i]) {
          piece = [];
          this.passed[i] = false;
        } else {
          piece = this.game.games[i].nextPiece;
        }
        this.players.forEach(p =>
          p.send({
            type: 'piece',
            time: this.game.age,
            player: i,
            piece,
          })
        );
        if (this.verbose) {
          this.game.log();
          console.log('Sent piece of', i, piece);
        }
        this.waitForMove(i);
      }
    }
  }
}

export class WebSocketRealtimeSession extends WebSocketSession {
  game: TimeWarpingGame<MultiplayerGame>;
  age: number;

  constructor(player: Player, verbose?: boolean) {
    super(player, verbose);
    const origin = new MultiplayerGame(
      this.gameSeed,
      this.screenSeed,
      this.colorSelections
    );
    this.game = new TimeWarpingGame(
      origin,
      CHECKPOINT_INTERVAL,
      MAX_CHECKPOINTS
    );
    this.age = 0;
  }

  start() {
    const metadata: ReplayMetadata = {
      names: this.players.map(p => p.name),
      elos: this.players.map(p => p.eloRealtime),
      priorWins: [0, 0],
      event: 'Free Play (realtime / alpha)',
      site: 'https://pujo.lumipakkanen.com',
      round: 0,
      msSince1970: new Date().valueOf(),
      type: 'realtime',
      server: CLIENT_INFO,
      clients: this.players.map(p => p.clientInfo || null),
    };
    super.start(this.game.origin, metadata);
  }

  onSimpleGameRequest(player: Player): void {
    const index = this.players.indexOf(player);
    player.send({
      type: 'simple state',
      state: this.game.warp(this.age).toSimpleGame(index),
    });
  }

  onMove(player: number, content: PausingMove | RealtimeMove) {
    if (content.type !== 'realtime move') {
      throw new Error('Wrong move type for a realtime session');
    }
    const sanitized = sanitizeRealtimeMove(this.age, content);
    if (sanitized.time < this.age - MAX_LAG) {
      this.disqualifyPlayer(player, 'lagging');
      return;
    } else if (sanitized.time > this.age + MAX_ADVANTAGE) {
      this.disqualifyPlayer(player, 'advancing');
      return;
    }
    const playedMove = this.game
      .warp(sanitized.time)
      .play(
        player,
        sanitized.x1,
        sanitized.y1,
        sanitized.orientation,
        sanitized.hardDrop
      );
    const rejectedMoves = this.game.addMove(playedMove);
    const move: ServerRealtimeMove = {
      type: 'realtime move',
      ...playedMove,
    };
    if (rejectedMoves.length === 1 && rejectedMoves.includes(playedMove)) {
      // No need to bother the other player if one client is misbehaving.
      this.players[player].send(move);
      const retcon: Retcon = {
        type: 'retcon',
        time: this.age,
        rejectedMoves,
      };
      if (this.verbose) {
        console.log('Single retcon', retcon);
      }
      this.players[player].send(retcon);
    } else {
      this.players.forEach(p => p.send(move));
      if (rejectedMoves.length) {
        const retcon: Retcon = {
          type: 'retcon',
          time: this.age,
          rejectedMoves,
        };
        if (this.verbose) {
          console.log('Retconning', retcon);
        }
        this.players.forEach(p => p.send(retcon));
      }
    }
  }

  // This should be called 30 times per second.
  tick() {
    if (this.done || !this.ready.every(Boolean)) {
      return;
    }
    this.age++;
    const pieces = this.game.revealPieces(this.age);
    const game = this.game.warp(this.age);
    this.postTick(game);
    if (this.done) {
      return;
    }
    for (const piece of pieces) {
      if (this.verbose) {
        game.log();
        console.log('Revealing piece', piece);
      }
      const msg: PieceMessage = {
        type: 'piece',
        ...piece,
      };
      this.players.forEach(p => p.send(msg));
      this.waitForMove(piece.player);
    }
  }
}
