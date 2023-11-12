import {
  FischerTimer,
  MultiplayerGame,
  NOMINAL_FRAME_RATE,
  PlayedMove,
  Replay,
  ReplayMetadata,
  ReplayParams,
  ReplayResultReason,
  TimeWarpingGame,
  randomMultiplayer,
} from 'pujo-puyo-core';
import {Player} from './player';
import {
  ClientMessage,
  GameResult,
  GameType,
  PartialParams,
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

export type CompleteCallback = (session: WebSocketSession) => void;

export class WebSocketSession {
  type: GameType | undefined = undefined;

  params: ReplayParams;
  metadata?: ReplayMetadata;
  winner?: number;
  reason: ReplayResultReason;
  players: Player[];
  ready: boolean[];
  waitingForMove: boolean[];
  done: boolean;
  timeouts: (Timer | null)[];
  private: boolean;
  verbose: boolean;
  onComplete?: CompleteCallback;

  constructor(players: Player[], private_: boolean, verbose?: boolean) {
    this.params = randomMultiplayer();
    this.players = players;
    this.ready = Array(players.length).fill(false);
    this.waitingForMove = Array(players.length).fill(false);
    this.done = false;
    this.timeouts = Array(players.length).fill(null);
    this.private = private_;
    this.verbose = !!verbose;
    this.reason = 'ongoing';
  }

  start(origin: MultiplayerGame) {
    if (!this.metadata) {
      throw new Error('Metadata must be set before calling start');
    }
    const params: PartialParams = {
      ...this.params,
      bagSeeds: null,
      initialBags: this.params.initialBags.map(b => b.slice(0, 4)),
    };
    this.players.forEach((player, i) => {
      this.ready[i] = false;
      player.send({
        type: 'game params',
        params,
        identity: i,
        metadata: this.metadata!,
      });
      this.waitForMove(i);
    });
    if (this.verbose) {
      origin.log();
      console.log(
        `Starting game ${this.params.garbageSeeds} (${this.params.garbageSeeds})`
      );
    }
  }

  waitForMove(player: number) {
    this.waitingForMove[player] = true;
    const latePlayer = player;
    if (this.timeouts[player] !== null) {
      clearTimeout(this.timeouts[player]!);
    }
    this.timeouts[player] = setTimeout(
      () => this.disqualifyPlayer(latePlayer),
      MAX_MOVE_TIME
    );
  }

  disqualifyPlayer(player: number, reason: ReplayResultReason = 'timeout') {
    this.winner = 1 - player;
    this.reason = reason;
    this.sendResult();
    this.complete();
  }

  sendResult() {
    if (this.done) {
      return;
    }
    const msSince1970 = new Date().valueOf();
    if (this.metadata) {
      this.metadata.endTime = msSince1970;
    }
    const result: GameResult = {
      type: 'game result',
      winner: this.winner,
      reason: this.reason,
      msSince1970,
      bagSeeds: this.params.bagSeeds,
      initialBags: this.params.initialBags,
    };
    if (this.verbose) {
      console.log('Sending result', result);
    }
    this.players.forEach(p => p.send(result));
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
    if (this.onComplete) {
      this.onComplete(this);
    }
  }

  disconnect(player: Player) {
    if (this.done) {
      return;
    }
    // XXX: Assumes a duel
    this.players.forEach((opponent, i) => {
      if (opponent !== player) {
        this.winner = i;
        this.reason = 'disconnect';
        const msSince1970 = new Date().valueOf();
        if (this.metadata) {
          this.metadata.endTime = msSince1970;
        }
        const result: GameResult = {
          type: 'game result',
          winner: this.winner,
          reason: this.reason,
          msSince1970,
          bagSeeds: this.params.bagSeeds,
          initialBags: this.params.initialBags,
        };
        if (this.verbose) {
          console.log('Sending result', result);
        }
        opponent.send(result);
      }
    });
    this.complete();
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
      this.winner = 1 - index;
      this.reason = clampString(content.reason) as ReplayResultReason;
      this.sendResult();
      this.complete();
    } else if (
      content.type === 'pausing move' ||
      content.type === 'realtime move'
    ) {
      if (content.type === 'pausing move' && !this.waitingForMove[index]) {
        return;
      }
      if (this.timeouts[index] !== null) {
        clearTimeout(this.timeouts[index]!);
      }
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
      this.winner = undefined;
      this.reason = 'double lockout';
      this.sendResult();
      this.complete();
    } else if (game.games[0].lockedOut || game.games[1].lockedOut) {
      this.winner = game.games[0].lockedOut ? 1 : 0;
      this.reason = 'lockout';
      this.sendResult();
      this.complete();
    } else if (
      game.games.every(g => g.consecutiveRerolls >= MAX_CONSECUTIVE_REROLLS)
    ) {
      this.winner = undefined;
      this.reason = 'impasse';
      this.sendResult();
      this.complete();
    } else if (game.age > MAX_GAME_AGE) {
      this.winner = undefined;
      this.reason = 'max time exceeded';
      this.sendResult();
      this.complete();
    }
  }

  toReplay(): Replay {
    if (!this.metadata) {
      throw new Error('Metadata must be set before converting to replay');
    }
    return {
      params: this.params,
      moves: [],
      metadata: this.metadata,
      result: {
        winner: this.winner,
        reason: this.reason,
      },
    };
  }
}

export class PausingSession extends WebSocketSession {
  type = 'pausing' as const;

  game: MultiplayerGame;
  passed: boolean[];
  hiddenMove: ServerPausingMove | null;

  playedMoves: PlayedMove[];

  constructor(players: Player[], private_: boolean, verbose?: boolean) {
    super(players, private_, verbose);
    this.game = new MultiplayerGame(this.params);
    this.passed = Array(players.length).fill(false);
    // TODO: True multiplayer
    this.hiddenMove = null;
    this.playedMoves = [];
  }

  start() {
    this.metadata = {
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
      clients: this.players.map(p => p.clientInfo ?? null),
    };
    super.start(this.game);
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
      this.playedMoves.push(playedMove);
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

  toReplay(): Replay {
    const result = super.toReplay();
    result.moves = this.playedMoves;
    return result;
  }
}

export class RealtimeSession extends WebSocketSession {
  type = 'realtime' as const;

  game: TimeWarpingGame<MultiplayerGame>;
  age: number;

  constructor(players: Player[], private_: boolean, verbose?: boolean) {
    super(players, private_, verbose);
    const origin = new MultiplayerGame(this.params);
    this.game = new TimeWarpingGame(
      origin,
      CHECKPOINT_INTERVAL,
      MAX_CHECKPOINTS
    );
    this.age = 0;
  }

  start() {
    this.metadata = {
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
    super.start(this.game.origin);
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

  toReplay(): Replay {
    const result = super.toReplay();
    result.moves = this.game.moves;
    return result;
  }
}
