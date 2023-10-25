import {
  FischerTimer,
  MultiplayerGame,
  NOMINAL_FRAME_RATE,
  ReplayMetadata,
  ReplayResultReason,
  randomColorSelection,
  randomSeed,
} from 'pujo-puyo-core';
import {Player} from './player';
import {ClientMessage, ServerMoveMessage} from '../api';
import {
  CLIENT_INFO,
  MAX_CONSECUTIVE_REROLLS,
  clampString,
  sanitizeMove,
} from '../util';

// Terminate games that last longer than 10 virtual minutes.
const MAX_GAME_AGE = NOMINAL_FRAME_RATE * 60 * 10;
// These 10 minutes are measured in wall clock time to prune players who leave their browsers open.
const MAX_MOVE_TIME = 10 * 60 * 1000;

export type CompleteCallback = (players: Player[], winner?: number) => void;

export class WebSocketPausingSession {
  gameSeed: number;
  screenSeed: number;
  colorSelection: number[];
  game: MultiplayerGame;
  players: Player[];
  waitingForMove: boolean[];
  passed: boolean[];
  done: boolean;
  hiddenMove: ServerMoveMessage | null;
  timeouts: (Timer | null)[];
  verbose: boolean;
  onComplete?: CompleteCallback;

  constructor(player: Player, verbose?: boolean) {
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
    this.passed = [false, false];
    this.done = false;
    this.hiddenMove = null;
    this.timeouts = [null, null];
    this.verbose = !!verbose;
  }

  disqualifyPlayer(player: number) {
    const reason: ReplayResultReason = 'timeout';
    const winner = 1 - player;
    this.sendResult(winner, reason);
    this.complete(winner);
  }

  start() {
    const metadata: ReplayMetadata = {
      names: this.players.map(p => p.name),
      elos: [1000, 1000],
      priorWins: [0, 0],
      event: 'Free Play (alpha)',
      site: 'https://pujo.lumipakkanen.com',
      round: 0,
      timeControl: new FischerTimer().toString(),
      msSince1970: new Date().valueOf(),
      type: 'pausing',
      server: CLIENT_INFO,
      clients: this.players.map(p => p.clientInfo || null),
    };
    const initialBags = this.game.games.map(g => g.initialBag);
    this.players.forEach((player, i) => {
      player.send({
        type: 'game params',
        colorSelection: this.colorSelection,
        screenSeed: this.screenSeed,
        targetPoints: this.game.targetPoints,
        marginFrames: this.game.marginFrames,
        initialBags,
        identity: i,
        metadata,
      });
      for (let j = 0; j < this.game.games.length; ++j) {
        player.send({
          type: 'piece',
          player: j,
          piece: this.game.games[j].nextPiece,
        });
      }
      this.waitingForMove[i] = true;
      const latePlayer = i;
      this.timeouts[i] = setTimeout(
        () => this.disqualifyPlayer(latePlayer),
        MAX_MOVE_TIME
      );
    });
    if (this.verbose) {
      this.game.log();
      console.log(`Starting game ${this.gameSeed} (${this.screenSeed})`);
    }
  }

  sendResult(winner: number | undefined, reason: ReplayResultReason) {
    const msSince1970 = new Date().valueOf();
    this.players.forEach(p =>
      p.send({
        type: 'game result',
        winner,
        reason,
        msSince1970,
        gameSeed: this.gameSeed,
      })
    );
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
      this.onComplete(this.players, winner);
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
        opponent.send({
          type: 'game result',
          winner,
          reason,
          msSince1970,
          gameSeed: this.gameSeed,
        });
      }
    });
    this.complete(winner);
  }

  message(player: Player, content: ClientMessage) {
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
      const winner = 1 - index;
      const reason: ReplayResultReason = clampString(
        content.reason
      ) as ReplayResultReason;
      this.sendResult(winner, reason);
      this.complete(winner);
    } else if (content.type === 'move') {
      if (!this.waitingForMove[index]) {
        return;
      }
      const move = sanitizeMove(index, this.game.age, content);
      if (this.verbose) {
        console.log('Sanitized', move);
      }
      clearTimeout(this.timeouts[move.player]!);
      if (move.pass) {
        this.passed[move.player] = true;
      } else {
        const playedMove = this.game.play(
          move.player,
          move.x1,
          move.y1,
          move.orientation,
          move.hardDrop
        );
        move.time = playedMove.time;
        move.x1 = playedMove.x1;
        move.y1 = playedMove.y1;
        move.x2 = playedMove.x2;
        move.y2 = playedMove.y2;
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
          const winner = undefined;
          this.sendResult(winner, reason);
          this.complete(winner);
        } else if (tickResults[0].lockedOut || tickResults[1].lockedOut) {
          const winner = tickResults[0].lockedOut ? 1 : 0;
          const reason: ReplayResultReason = 'lockout';
          this.sendResult(winner, reason);
          this.complete(winner);
        } else if (this.game.consecutiveRerolls >= MAX_CONSECUTIVE_REROLLS) {
          const reason: ReplayResultReason = 'impasse';
          const winner = undefined;
          this.sendResult(winner, reason);
          this.complete(winner);
        } else if (this.game.age > MAX_GAME_AGE) {
          const reason: ReplayResultReason = 'max time exceeded';
          const winner = undefined;
          this.sendResult(winner, reason);
          this.complete(winner);
        }
      }

      if (this.done) {
        return;
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
              player: i,
              piece,
            })
          );
          if (this.verbose) {
            this.game.log();
            console.log('Sent piece of', i, piece);
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
