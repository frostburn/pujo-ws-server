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

import argParse from 'minimist';
import {CLIENT_INFO} from './src/util';

const args = argParse(process.argv.slice(2));

args.server = args.server || 'ws://localhost:3003';
args.bot = args.bot || 'flex2';

const BOTS = {
  null: {
    name: 'Null (bot)',
    strategy: nullStrategy,
  },
  random: {
    name: 'Random (bot)',
    strategy: randomStrategy,
  },
  flex1: {
    name: 'FlexDroplet1 (bot)',
    strategy: flexDropletStrategy1,
  },
  flex2: {
    name: 'FlexDroplet2 (bot)',
    strategy: flexDropletStrategy2,
  },
  flex3: {
    name: 'FlexDroplet3 (bot)',
    strategy: flexDropletStrategy3,
  },
};

const bot = BOTS[args.bot].strategy;
const name = BOTS[args.bot].name;

console.log(`Runnig ${name}. Connecting to ${args.server}`);

const socket = new WebSocket(args.server);

let identity: number | null = null;

let mirrorGame: MultiplayerGame | null = null;

let wins = 0;
let draws = 0;
let losses = 0;

let timer: FischerTimer | null = null;

socket.addEventListener('message', event => {
  const data = JSON.parse(event.data);
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
      data.screenSeed
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
      console.log(`Wins / Draws / Losses: ${wins} / ${draws} / ${losses}`);

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
    if (data.result === 'win') {
      wins++;
    } else if (data.result === 'draw') {
      draws++;
    } else {
      losses++;
    }
    console.log(`Game Over: ${data.result}, ${data.reason}`);
    socket.send(
      JSON.stringify({type: 'game request', name, clientInfo: CLIENT_INFO})
    );
  }
});

socket.addEventListener('open', () => {
  console.log('Connection established.');
  socket.send(
    JSON.stringify({type: 'game request', name, clientInfo: CLIENT_INFO})
  );
});

socket.addEventListener('close', event => {
  console.log('Closing client.', event.code, event.reason);
});
