import {
  MOVES,
  MultiplayerGame,
  PASS,
  TimeWarpingMirror,
  flexDropletStrategy1,
  flexDropletStrategy2,
  flexDropletStrategy3,
  randomStrategy,
} from 'pujo-puyo-core';
import {config} from 'dotenv';
import argParse from 'minimist';
import {CLIENT_INFO} from './util';
import {ClientMessage, RealtimeMove, ServerMessage} from './api';

config();

const args = argParse(process.argv.slice(2));

args.server = args.server || 'ws://localhost:3003';
args.bot = args.bot || 'flex2';

const BOTS: Record<
  string,
  {
    username: string;
    strategy: typeof randomStrategy;
    authUuid: string;
    softAuthUuid: string;
  }
> = {
  random: {
    username: 'Random (bot)',
    strategy: randomStrategy,
    authUuid: process.env.BOT_UUID_RANDOM || crypto.randomUUID(),
    softAuthUuid: process.env.BOT_UUID_SOFT_RANDOM || crypto.randomUUID(),
  },
  flex1: {
    username: 'FlexDroplet1 (bot)',
    strategy: flexDropletStrategy1,
    authUuid: process.env.BOT_UUID_FLEX1 || crypto.randomUUID(),
    softAuthUuid: process.env.BOT_UUID_SOFT_FLEX1 || crypto.randomUUID(),
  },
  flex2: {
    username: 'FlexDroplet2 (bot)',
    strategy: flexDropletStrategy2,
    authUuid: process.env.BOT_UUID_FLEX2 || crypto.randomUUID(),
    softAuthUuid: process.env.BOT_UUID_SOFT_FLEX2 || crypto.randomUUID(),
  },
  flex3: {
    username: 'FlexDroplet3 (bot)',
    strategy: flexDropletStrategy3,
    authUuid: process.env.BOT_UUID_FLEX3 || crypto.randomUUID(),
    softAuthUuid: process.env.BOT_UUID_SOFT_FLEX3 || crypto.randomUUID(),
  },
};

const bot = BOTS[args.bot].strategy;
const username = (args.soft ? 'Soft ' : '') + BOTS[args.bot].username;
const authUuid = args.soft
  ? BOTS[args.bot].softAuthUuid
  : BOTS[args.bot].authUuid;

console.log(`Runnig ${username}. Connecting to ${args.server}`);

class ClientSocket extends WebSocket {
  sendMessage(message: ClientMessage) {
    return super.send(JSON.stringify(message));
  }
}

const socket = new ClientSocket(args.server);

let passing = false;

let identity: number | null = null;

let mirrorGame: TimeWarpingMirror | null = null;

let wins = 0;
let draws = 0;
let losses = 0;

let elo = 1000;

let lastMove: RealtimeMove | null = null;

socket.addEventListener('message', event => {
  let data: ServerMessage;
  if (event.data instanceof Buffer) {
    data = JSON.parse(event.data.toString());
  } else {
    data = JSON.parse(event.data);
  }
  if (args.verbose) {
    console.log('Message received', data);
  }
  if (data.type === 'game params') {
    const origin = new MultiplayerGame(
      null,
      data.colorSelection,
      data.screenSeed,
      data.targetPoints,
      data.marginFrames
    );
    mirrorGame = new TimeWarpingMirror(origin, data.initialBags);
    identity = data.identity;
    socket.sendMessage({type: 'ready'});
  }
  if (data.type === 'piece') {
    mirrorGame!.addPiece(data);

    if (data.player === identity) {
      const startTime = performance.now();
      const multiplayerGame = mirrorGame!.warp(data.time);
      if (!multiplayerGame) {
        console.log('Mirror in an inconsistent state. Refusing to play.');
        socket.sendMessage({type: 'result', reason: 'resignation'});
        return;
      }
      const game = multiplayerGame.toSimpleGame(identity!);
      const strategy = bot(game);
      game.log();
      console.log('Identity:', identity);
      console.log('Heuristic score:', strategy.score);
      console.log(
        `Wins / Draws / Losses: ${wins} / ${draws} / ${losses}, (${elo})`
      );
      if (strategy.move === PASS) {
        passing = true;
      } else {
        const move = MOVES[strategy.move];
        lastMove = {
          type: 'realtime move',
          time: data.time,
          hardDrop: !args.soft,
          ...move,
        };
        const took = performance.now() - startTime;
        if (took > 250) {
          console.log(
            'Thinking took',
            took,
            'ms. Not risking disqualification.'
          );
          lastMove.time = undefined;
        }
        socket.sendMessage(lastMove);
      }
    }
  }
  if (data.type === 'realtime move') {
    mirrorGame!.addMove(data);
    if (passing && data.player !== identity) {
      const multiplayerGame = mirrorGame!.warp(data.time);
      if (!multiplayerGame) {
        console.log('Mirror in an inconsistent state. Refusing to play.');
        socket.sendMessage({type: 'result', reason: 'resignation'});
        return;
      }
      const game = multiplayerGame.toSimpleGame(identity!);
      const strategy = bot(game);
      if (strategy.move === PASS) {
        strategy.move = Math.floor(Math.random() * MOVES.length);
      }
      passing = false;
      const move = MOVES[strategy.move];
      lastMove = {
        type: 'realtime move',
        time: undefined, // Make sure not to double lag and get disqualified
        hardDrop: !args.soft,
        ...move,
      };
      socket.sendMessage(lastMove);
    }
  }
  if (data.type === 'retcon') {
    mirrorGame!.deleteMoves(data.rejectedMoves);
    for (const move of data.rejectedMoves) {
      if (
        lastMove &&
        lastMove.time !== undefined &&
        move.time === lastMove.time &&
        move.player === identity
      ) {
        // Make a single retry.
        lastMove.time = undefined;
        console.log(
          'Fixed time move refused. Retrying without lag compensation...'
        );
        socket.sendMessage(lastMove);
      }
    }
  }
  if (data.type === 'game result') {
    let result = 'Draw';
    if (data.winner === identity) {
      result = 'Win';
      wins++;
    } else if (data.winner === undefined) {
      draws++;
    } else {
      result = 'Loss';
      losses++;
    }
    console.log(`Game Over: ${result}, ${data.reason}`);
    socket.sendMessage({
      type: 'game request',
      gameType: 'realtime',
    });
    // Update Elo rating
    socket.sendMessage({type: 'user'});
  }
  if (data.type === 'user') {
    console.log(`Setting Elo rating to ${data.eloRealtime}`);
    elo = data.eloRealtime;
  }
});

socket.addEventListener('open', () => {
  console.log('Connection established.');
  // Identify the bot and update Elo rating
  socket.sendMessage({
    type: 'user',
    username,
    authUuid,
    clientInfo: CLIENT_INFO,
  });
  socket.sendMessage({
    type: 'game request',
    gameType: 'realtime',
  });
});

socket.addEventListener('close', event => {
  console.log('Closing client.', event.code, event.reason);
});
