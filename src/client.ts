import {
  FischerTimer,
  MOVES,
  MultiplayerGame,
  PASS,
  flexDropletStrategy1,
  flexDropletStrategy2,
  flexDropletStrategy3,
  nullStrategy,
  randomStrategy,
} from 'pujo-puyo-core';
import {config} from 'dotenv';
import argParse from 'minimist';
import {CLIENT_INFO, ClientSocket} from './util';
import {ServerMessage} from './api';

config();

const args = argParse(process.argv.slice(2));

args.server = args.server || 'ws://localhost:3003';
args.bot = args.bot || 'flex2';

const BOTS: Record<
  string,
  {
    username: string;
    strategy: typeof nullStrategy | typeof randomStrategy;
    authUuid: string;
    softAuthUuid: string;
  }
> = {
  null: {
    username: 'Null (bot)',
    strategy: nullStrategy,
    authUuid: process.env.BOT_UUID_NULL || crypto.randomUUID(),
    softAuthUuid: process.env.BOT_UUID_SOFT_NULL || crypto.randomUUID(),
  },
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

const socket = new ClientSocket(args.server);

let identity: number | null = null;

let mirrorGame: MultiplayerGame | null = null;

let wins = 0;
let draws = 0;
let losses = 0;

let timer: FischerTimer | null = null;

let elo = 1000;

socket.addMessageListener((data: ServerMessage) => {
  if (args.verbose) {
    console.log('Message received', data);
  }
  if (data.type === 'game params') {
    mirrorGame = new MultiplayerGame(
      null,
      data.screenSeed,
      data.colorSelections,
      data.targetPoints,
      data.marginFrames
    );
    for (let i = 0; i < data.initialBags.length; ++i) {
      mirrorGame.games[i].bag = data.initialBags[i];
    }
    identity = data.identity;
    if (data.metadata.timeControl) {
      timer = FischerTimer.fromString(data.metadata.timeControl);
    } else {
      timer = null;
    }
    socket.sendMessage({type: 'ready'});
  }
  if (data.type === 'piece') {
    const player = data.player;
    data.piece.forEach(color => mirrorGame!.games[player].bag.push(color));
    if (args.verbose) {
      console.log('Bag of', player, mirrorGame!.games[player].bag);
    }

    if (player === identity) {
      if (!timer) {
        throw new Error('Move requested, but timer not initialized');
      }
      timer.begin();
      const game = mirrorGame!.toSimpleGame(identity!);
      if (bot === nullStrategy) {
        prompt('Press enter to play the next move...');
      }
      const strategy = bot(game);
      game.log();
      console.log('Identity:', identity);
      console.log('Heuristic score:', strategy.score);
      console.log(
        `Wins / Draws / Losses: ${wins} / ${draws} / ${losses}, (${elo})`
      );
      if (timer.end()) {
        console.log('Timeout');
        socket.sendMessage({
          type: 'result',
          reason: 'timeout',
        });
      } else {
        console.log('Time:', timer.display());
        const msRemaining = timer.remaining;
        if (strategy.move === PASS) {
          socket.sendMessage({
            type: 'pausing move',
            pass: true,
            msRemaining,
          });
        } else {
          const move = MOVES[strategy.move];
          socket.sendMessage({
            type: 'pausing move',
            pass: false,
            hardDrop: true,
            msRemaining,
            ...move,
          });
        }
      }
    }
  }
  if (data.type === 'pausing move') {
    if (!data.pass) {
      const playedMove = mirrorGame!.play(
        data.player,
        data.x1,
        data.y1,
        data.orientation
      );
      if (playedMove.time !== data.time) {
        if (args.verbose) {
          mirrorGame!.log();
        }
        socket.close();
        throw new Error(`Game desync: ${playedMove.time} != ${data.time}`);
      }
    }
    while (
      mirrorGame!.games.every(game => game.busy) ||
      (data.pass && mirrorGame!.games.some(game => game.busy))
    ) {
      const tickResults = mirrorGame!.tick();
      if (args.verbose) {
        const fx: string[] = [];
        if (tickResults[identity!].didClear) {
          fx.push('clear');
        }
        if (tickResults[identity!].didJiggle) {
          fx.push('jiggle');
        }
        if (tickResults[identity!].coloredLanded) {
          fx.push('colored landed');
        }
        if (tickResults[identity!].garbageLanded) {
          fx.push('garbage landed');
        }
        if (fx.length) {
          console.log(fx.join(' '));
        }
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
    socket.requestGame('pausing');
    // Update Elo rating
    socket.sendMessage({type: 'self'});
  }
  if (data.type === 'self') {
    console.log(`Setting Elo rating to ${data.eloPausing}`);
    elo = data.eloPausing;
  }
});

socket.addEventListener('open', () => {
  console.log('Connection established.');
  // Identify the bot and update Elo rating
  socket.sendMessage({
    type: 'self',
    username,
    authUuid,
    isBot: true,
    clientInfo: CLIENT_INFO,
  });
  socket.requestGame('pausing');
});

socket.addEventListener('close', event => {
  console.log('Closing client.', event.code, event.reason);
});
