import sql from './db.js';

// Moves encoded as horrible byte balls to save space.
const ORIENTATION_BITS = 2; // 0, 1, 2 or 3
const Y1_BITS = 4; // 0 to 15
const X1_BITS = 3; // 0 to 5 with room to spare
const PLAYER_BITS = 3; // Up to 8 players for future compatibility
// Remaining bits implicitly allocated to 'time'
// const TIME_BITS = 31 - ORIENTATION_BITS - Y1_BITS - X1_BITS - PLAYER_BITS;

const PARAMS_FIELDS = [
  'bagSeeds',
  'garbageSeeds',
  'colorSelections',
  'initialBags',
];

const RULES_FIELDS = [
  'clearThreshold',
  'jiggleFrames',
  'sparkFrames',
  'marginFrames',
  'mercyFrames',
  'targetPoints',
];

const METADATA_FIELDS = [
  'names',
  'elos',
  'priorWins',
  'event',
  'site',
  'round',
  'msSince1970',
  'gameType',
  'endTime',
  'annotator',
  'timeControl',
  'termination',
  'initialPosition',
  'server',
  'clients',
];

function encodeMove(move) {
  let result = move.time;
  result <<= PLAYER_BITS;
  result |= move.player;
  result <<= X1_BITS;
  result |= move.x1;
  result <<= Y1_BITS;
  result |= move.y1;
  result <<= ORIENTATION_BITS;
  result |= move.orientation;
  return result;
}

function decodeMove(byteBall) {
  const result = {};
  result.orientation = byteBall & ((1 << ORIENTATION_BITS) - 1);
  byteBall >>>= ORIENTATION_BITS;
  result.y1 = byteBall & ((1 << Y1_BITS) - 1);
  byteBall >>>= Y1_BITS;
  result.x1 = byteBall & ((1 << X1_BITS) - 1);
  byteBall >>>= X1_BITS;
  result.player = byteBall & ((1 << PLAYER_BITS) - 1);
  result.time = byteBall >>> PLAYER_BITS;

  if (result.orientation === 0) {
    result.x2 = result.x1;
    result.y2 = result.y1 - 1;
  } else if (result.orientation === 1) {
    result.x2 = result.x1 - 1;
    result.y2 = result.y1;
  } else if (result.orientation === 2) {
    result.x2 = result.x1;
    result.y2 = result.y1 + 1;
  } else if (result.orientation === 3) {
    result.x2 = result.x1 + 1;
    result.y2 = result.y1;
  }

  return result;
}

export async function saveReplay(replay, private_, userIds) {
  const data = {
    ...replay,
    ...replay.params,
    ...replay.params.rules,
    ...replay.metadata,
  };
  data.private = private_;

  delete data.result;
  delete data.rules;
  delete data.params;
  delete data.metadata;

  data.winner = replay.result.winner;
  data.reason = replay.result.reason;

  data.leftPlayer = userIds[0];
  data.rightPlayer = userIds[1];

  data.moves = replay.moves.map(encodeMove);

  const rows = await sql`INSERT INTO replays ${sql(data)} RETURNING id;`;
  const replayId = rows[0].id;

  return replayId;
}

export async function loadReplay(replayId) {
  const rows =
    await sql`SELECT * FROM replays WHERE id = ${replayId} AND NOT private;`;

  if (!rows.length) {
    return undefined;
  }

  const data = rows[0];

  delete data.id;
  delete data.private;
  delete data.leftPlayer;
  delete data.rightPlayer;

  for (const key of Object.keys(data)) {
    if (data[key] === null) {
      data[key] = undefined;
    }
  }

  data.bagSeeds = data.bagSeeds.map(s => parseInt(s, 10));
  data.garbageSeeds = data.garbageSeeds.map(s => parseInt(s, 10));
  data.moves = data.moves.map(decodeMove);

  data.result = {
    winner: data.winner,
    reason: data.reason,
  };
  delete data.winner;
  delete data.reason;

  data.params = {};

  for (const field of PARAMS_FIELDS) {
    data.params[field] = data[field];
    delete data[field];
  }

  data.params.rules = {};

  for (const field of RULES_FIELDS) {
    data.params.rules[field] = data[field];
    delete data[field];
  }

  data.metadata = {};

  for (const field of METADATA_FIELDS) {
    data.metadata[field] = data[field];
    delete data[field];
  }

  data.metadata.msSince1970 = parseInt(data.metadata.msSince1970, 10);
  if (data.metadata.endTime !== undefined) {
    data.metadata.endTime = parseInt(data.metadata.endTime, 10);
  }

  return data;
}
