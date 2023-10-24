import {
  FischerTimer,
  MOVES,
  MultiplayerGame,
  PASS,
  SimpleGame,
  flexDropletStrategy1,
  flexDropletStrategy2,
  flexDropletStrategy3,
  nullStrategy,
  randomStrategy,
} from 'pujo-puyo-core';
import {config} from 'dotenv';
import argParse from 'minimist';
import {CLIENT_INFO} from './util';

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
  }
> = {
  null: {
    username: 'Null (bot)',
    strategy: nullStrategy,
    authUuid: process.env.BOT_UUID_NULL || crypto.randomUUID(),
  },
  random: {
    username: 'Random (bot)',
    strategy: randomStrategy,
    authUuid: process.env.BOT_UUID_RANDOM || crypto.randomUUID(),
  },
  flex1: {
    username: 'FlexDroplet1 (bot)',
    strategy: flexDropletStrategy1,
    authUuid: process.env.BOT_UUID_FLEX1 || crypto.randomUUID(),
  },
  flex2: {
    username: 'FlexDroplet2 (bot)',
    strategy: flexDropletStrategy2,
    authUuid: process.env.BOT_UUID_FLEX2 || crypto.randomUUID(),
  },
  flex3: {
    username: 'FlexDroplet3 (bot)',
    strategy: flexDropletStrategy3,
    authUuid: process.env.BOT_UUID_FLEX3 || crypto.randomUUID(),
  },
};

const bot = BOTS[args.bot].strategy;
const username = BOTS[args.bot].username;
const authUuid = BOTS[args.bot].authUuid;

console.log(`Runnig ${username}. Connecting to ${args.server}`);

const socket = new WebSocket(args.server);

let identity: number | null = null;

let mirrorGame: MultiplayerGame | null = null;

let wins = 0;
let draws = 0;
let losses = 0;

let timer: FischerTimer | null = null;

let elo = 1000;

socket.addEventListener('message', event => {
  let data: any;
  if (event.data instanceof Buffer) {
    data = JSON.parse(event.data.toString());
  } else {
    data = JSON.parse(event.data);
  }
  if (args.verbose) {
    console.log('Message received', data);
  }
  if (data.type === 'simple state') {
    console.warn('Unexpected simple state response');
    const game = SimpleGame.fromJSON(data.state);
    if (bot === nullStrategy) {
      prompt('Press enter to play the next move...');
    }
    const strategy = bot(game);
    game.log();
    console.log('Heuristic score:', strategy.score);
    console.log(`Wins / Draws / Losses: ${wins} / ${draws} / ${losses}`);

    const response = JSON.parse(JSON.stringify(MOVES[strategy.move]));
    response.type = 'move';
    response.hardDrop = true;
    socket.send(JSON.stringify(response));
  }

  if (data.type === 'game params') {
    mirrorGame = new MultiplayerGame(
      null,
      data.colorSelection,
      data.screenSeed,
      data.targetPoints,
      data.marginFrames
    );
    identity = data.identity;
    timer = FischerTimer.fromString(data.metadata.timeControl);
  }
  if (data.type === 'bag') {
    mirrorGame!.games[data.player].bag = data.bag;

    if (data.player === identity) {
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

      let response;
      if (strategy.move === PASS) {
        response = {pass: true};
      } else {
        response = JSON.parse(JSON.stringify(MOVES[strategy.move]));
      }
      response.type = 'move';
      response.hardDrop = true;
      if (timer.end()) {
        console.log('Timeout');
        socket.send(
          JSON.stringify({
            type: 'result',
            reason: 'timeout',
          })
        );
      } else {
        console.log('Time:', timer.display());
        response.msRemaining = timer.remaining;
        socket.send(JSON.stringify(response));
      }
    }
  }
  if (data.type === 'move') {
    if (!data.pass) {
      mirrorGame!.play(
        data.player,
        data.x1,
        data.y1,
        data.orientation,
        data.hardDrop
      );
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
    socket.send(
      JSON.stringify({
        type: 'game request',
      })
    );
    // Update Elo rating
    socket.send(
      JSON.stringify({
        type: 'user',
      })
    );
  }
  if (data.type === 'user') {
    console.log(`Setting Elo rating to ${data.eloPausing}`);
    elo = data.eloPausing;
  }
});

socket.addEventListener('open', () => {
  console.log('Connection established.');
  // Identify the bot and update Elo rating
  socket.send(
    JSON.stringify({
      type: 'user',
      username,
      authUuid,
      clientInfo: CLIENT_INFO,
    })
  );
  socket.send(
    JSON.stringify({
      type: 'game request',
    })
  );
});

socket.addEventListener('close', event => {
  console.log('Closing client.', event.code, event.reason);
});
