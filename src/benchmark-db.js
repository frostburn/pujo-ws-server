import {config} from 'dotenv';
import crypto from 'node:crypto';
// import {PlayedMove, Replay} from 'pujo-puyo-core';
import {Client} from './database.js';

config();

/*
function saveReplay(database: Database, replay: Replay, userIds: number[]) {
  const data: any = {...replay, ...replay.metadata};

  delete data.colorSelection;
  data.Color0 = replay.colorSelection[0];
  data.Color1 = replay.colorSelection[1];
  data.Color2 = replay.colorSelection[2];
  data.Color3 = replay.colorSelection[3];

  delete data.result;
  if (replay.result.winner === undefined) {
    data.winner = null;
  } else {
    data.winner = userIds[replay.result.winner];
  }
  data.reason = replay.result.reason;

  delete data.names;
  data.Left = userIds[0];
  data.Right = userIds[1];
  // TODO: elos

  delete data.metadata;
  delete data.priorWins;
  data.LeftPriorWins = replay.metadata.priorWins[0];
  data.RightPriorWins = replay.metadata.priorWins[1];

  delete data.clients;
  if (replay.metadata.clients !== undefined) {
    data.LeftClient = replay.metadata.clients[0];
    data.RightClient = replay.metadata.clients[1];
  }

  delete data.moves;

  const replayId = database.insert('Replays', data);

  const query = database.prepare(
    'INSERT INTO Moves (Replay, player, time, x1, y1, orientation) VALUES (?, ?, ?, ?, ?, ?);'
  );
  const insertMoves = database.transaction((moves: PlayedMove[]) => {
    for (const move of moves) {
      query.run(
        replayId,
        move.player,
        move.time,
        move.x1,
        move.y1,
        move.orientation
      );
    }
  });
  insertMoves(replay.moves);
}

function loadReplay(database: Database, replayId: number) {
  const data: any = database
    .query(
      'SELECT *, right.username AS rname, right.elo AS relo FROM Replays JOIN Users AS left ON Left=left.Id JOIN Users AS right ON Right=right.Id WHERE Replays.Id = ?;'
    )
    .get(replayId);

  delete data.Id;

  data.colorSelection = [data.Color0, data.Color1, data.Color2, data.Color3];
  delete data.Color0;
  delete data.Color1;
  delete data.Color2;
  delete data.Color3;

  console.log(data);
}
*/

(async () => {
  const client = new Client();

  await client.insert('Users', {
    username: 'alice',
    // authUUID: crypto.randomUUID(),
    elo: 1000,
  });

  /*
  const bob = await client.insert('Users', {
    username: 'bob',
    // authUUID: crypto.randomUUID(),
    elo: 1000,
  });

  console.log('Beauwbeh', bob);
  */

  await client.end();

  console.log('I hate async code...');
})();

/*
  const users = await client.select('Users');

  console.log('What?', users);

  const LUMI_VS_FLEX2: Replay = {
    gameSeed: 3864657304,
    screenSeed: 2580717322,
    colorSelection: [3, 1, 0, 2],
    metadata: {
      event:
        'First human vs. machine game to be captured in algebraic notation for Puyo',
      site: 'http://localhost:5173/',
      names: ['Lumi Pakkanen', 'FlexDroplet 2'],
      round: 1,
      priorWins: [1, 0],
      msSince1970: new Date('2023-10-07').valueOf(),
    },
    result: {
      winner: 0,
      reason: 'lockout',
    },
    moves: [
      {player: 0, time: 0, x1: 0, y1: 15, x2: 1, y2: 15, orientation: 3},
      {player: 1, time: 0, x1: 5, y1: 15, x2: 4, y2: 15, orientation: 1},
      {player: 0, time: 18, x1: 5, y1: 14, x2: 5, y2: 15, orientation: 2},
      {player: 1, time: 18, x1: 0, y1: 14, x2: 0, y2: 15, orientation: 2},
      {player: 0, time: 36, x1: 0, y1: 14, x2: 1, y2: 14, orientation: 3},
      {player: 1, time: 36, x1: 3, y1: 15, x2: 2, y2: 15, orientation: 1},
      {player: 0, time: 54, x1: 4, y1: 15, x2: 4, y2: 14, orientation: 0},
      {player: 1, time: 54, x1: 1, y1: 15, x2: 1, y2: 14, orientation: 0},
      {player: 0, time: 72, x1: 0, y1: 12, x2: 0, y2: 13, orientation: 2},
      {player: 1, time: 72, x1: 2, y1: 14, x2: 2, y2: 13, orientation: 0},
      {player: 0, time: 90, x1: 0, y1: 10, x2: 0, y2: 11, orientation: 2},
      {player: 1, time: 90, x1: 1, y1: 13, x2: 0, y2: 13, orientation: 1},
      {player: 0, time: 108, x1: 2, y1: 14, x2: 2, y2: 15, orientation: 2},
      {player: 0, time: 126, x1: 2, y1: 13, x2: 1, y2: 13, orientation: 1},
      {player: 0, time: 144, x1: 3, y1: 14, x2: 3, y2: 15, orientation: 2},
      {player: 0, time: 162, x1: 4, y1: 13, x2: 3, y2: 13, orientation: 1},
      {player: 1, time: 169, x1: 3, y1: 15, x2: 2, y2: 15, orientation: 1},
      {player: 1, time: 187, x1: 3, y1: 14, x2: 4, y2: 14, orientation: 3},
      {player: 0, time: 209, x1: 1, y1: 11, x2: 1, y2: 10, orientation: 0},
      {player: 0, time: 227, x1: 1, y1: 8, x2: 0, y2: 8, orientation: 1},
      {player: 0, time: 246, x1: 2, y1: 12, x2: 2, y2: 11, orientation: 0},
      {player: 0, time: 264, x1: 3, y1: 11, x2: 4, y2: 11, orientation: 3},
      {player: 1, time: 266, x1: 2, y1: 14, x2: 2, y2: 15, orientation: 2},
      {player: 1, time: 284, x1: 3, y1: 14, x2: 3, y2: 15, orientation: 2},
      {player: 1, time: 302, x1: 4, y1: 15, x2: 4, y2: 14, orientation: 0},
      {player: 0, time: 310, x1: 2, y1: 7, x2: 1, y2: 7, orientation: 1},
      {player: 1, time: 320, x1: 2, y1: 13, x2: 2, y2: 12, orientation: 0},
      {player: 0, time: 330, x1: 2, y1: 8, x2: 3, y2: 8, orientation: 3},
      {player: 1, time: 338, x1: 1, y1: 15, x2: 1, y2: 14, orientation: 0},
      {player: 0, time: 350, x1: 0, y1: 6, x2: 1, y2: 6, orientation: 3},
      {player: 1, time: 356, x1: 2, y1: 10, x2: 2, y2: 11, orientation: 2},
      {player: 0, time: 368, x1: 3, y1: 9, x2: 3, y2: 8, orientation: 0},
      {player: 1, time: 374, x1: 1, y1: 9, x2: 2, y2: 9, orientation: 3},
      {player: 0, time: 386, x1: 4, y1: 9, x2: 4, y2: 8, orientation: 0},
      {player: 1, time: 396, x1: 1, y1: 12, x2: 1, y2: 11, orientation: 0},
      {player: 0, time: 404, x1: 3, y1: 7, x2: 3, y2: 6, orientation: 0},
      {player: 1, time: 414, x1: 0, y1: 10, x2: 1, y2: 10, orientation: 3},
      {player: 0, time: 422, x1: 5, y1: 11, x2: 5, y2: 10, orientation: 0},
      {player: 0, time: 440, x1: 5, y1: 9, x2: 5, y2: 8, orientation: 0},
      {player: 0, time: 458, x1: 5, y1: 6, x2: 5, y2: 7, orientation: 2},
      {player: 0, time: 476, x1: 2, y1: 5, x2: 3, y2: 5, orientation: 3},
      {player: 0, time: 496, x1: 3, y1: 4, x2: 3, y2: 3, orientation: 0},
      {player: 0, time: 514, x1: 3, y1: 2, x2: 3, y2: 1, orientation: 0},
      {player: 0, time: 532, x1: 4, y1: 6, x2: 4, y2: 7, orientation: 2},
      {player: 1, time: 579, x1: 2, y1: 15, x2: 2, y2: 14, orientation: 0},
      {player: 1, time: 597, x1: 4, y1: 15, x2: 3, y2: 15, orientation: 1},
      {player: 1, time: 615, x1: 4, y1: 14, x2: 3, y2: 14, orientation: 1},
      {player: 1, time: 633, x1: 3, y1: 13, x2: 3, y2: 12, orientation: 0},
      {player: 1, time: 651, x1: 3, y1: 11, x2: 2, y2: 11, orientation: 1},
      {player: 1, time: 671, x1: 5, y1: 15, x2: 5, y2: 14, orientation: 0},
      {player: 1, time: 791, x1: 4, y1: 14, x2: 4, y2: 15, orientation: 2},
      {player: 1, time: 809, x1: 2, y1: 15, x2: 3, y2: 15, orientation: 3},
      {player: 1, time: 827, x1: 2, y1: 13, x2: 2, y2: 14, orientation: 2},
      {player: 1, time: 845, x1: 4, y1: 13, x2: 5, y2: 13, orientation: 3},
      {player: 1, time: 865, x1: 3, y1: 12, x2: 4, y2: 12, orientation: 3},
      {player: 0, time: 875, x1: 3, y1: 13, x2: 3, y2: 12, orientation: 0},
      {player: 0, time: 893, x1: 3, y1: 11, x2: 3, y2: 10, orientation: 0},
      {player: 0, time: 911, x1: 4, y1: 9, x2: 4, y2: 10, orientation: 2},
      {player: 0, time: 929, x1: 3, y1: 8, x2: 4, y2: 8, orientation: 3},
      {player: 0, time: 948, x1: 5, y1: 8, x2: 5, y2: 9, orientation: 2},
      {player: 1, time: 955, x1: 0, y1: 10, x2: 0, y2: 9, orientation: 0},
      {player: 0, time: 966, x1: 2, y1: 13, x2: 2, y2: 12, orientation: 0},
      {player: 1, time: 999, x1: 3, y1: 2, x2: 4, y2: 2, orientation: 3},
      {player: 0, time: 1027, x1: 3, y1: 11, x2: 3, y2: 10, orientation: 0},
    ],
  };

  for (let i = 0; 1 < 1; ++i) {
    saveReplay(db, LUMI_VS_FLEX2, [1, 2]);
  }

  // console.log(db.select('Replays'));
  // console.log(db.select('Moves'));

  loadReplay(db, 1);
  */
