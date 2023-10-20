import {config} from 'dotenv';
import {Client} from './database.js';

config();

// Prettier, why are you like this?
(async () => {
  const client = new Client();
  await client.connect();

  /*
  const res = await client.query('SELECT $1::text as message', [
    'Hello world!',
  ]);
  console.log(res.rows[0].message); // Hello world!
  */

  await client.query('DROP TABLE IF EXISTS Moves;');
  await client.query('DROP TABLE IF EXISTS Replays;');
  await client.query('DROP TABLE IF EXISTS Users;');
  await client.query('DROP TYPE IF EXISTS REASON;');

  // The convention is that PascalCased columns need post-processing while camelCased can be used as-is.

  await client.createTable('Users', [
    'Id SERIAL PRIMARY KEY',
    'username VARCHAR(255) NOT NULL',
    // 'authUUID UUID NOT NULL UNIQUE',
    'elo REAL NOT NULL',
  ]);

  await client.createEnum('REASON', [
    'ongoing',
    'resignation',
    'timeout',
    'disconnect',
    'lockout',
    'double lockout',
    'max time exceeded',
    'server maintenance',
  ]);

  // Reflects the Replay type.
  await client.createTable('Replays', [
    // DB field
    'Id SERIAL PRIMARY KEY',
    // Main fields
    'gameSeed DECIMAL(10) NOT NULL',
    'screenSeed DECIMAL(10) NOT NULL',
    // Color selection
    'Color0 SMALLINT NOT NULL',
    'Color1 SMALLINT NOT NULL',
    'Color2 SMALLINT NOT NULL',
    'Color3 SMALLINT NOT NULL',
    // (Moves in a separate table)
    // ReplayResult fields
    'Winner INTEGER NULL REFERENCES Users',
    'reason REASON NOT NULL',
    // Metadata fields
    // Names and ELOs as foreign keys
    'LeftPlayer INTEGER NOT NULL REFERENCES Users',
    'RightPlayer INTEGER NOT NULL REFERENCES Users',
    'LeftPriorWins INT NOT NULL',
    'RightPriorWins INT NOT NULL',
    'event VARCHAR(255) NOT NULL',
    'site VARCHAR(255) NOT NULL',
    'round INT NOT NULL',
    'msSince1970 DECIMAL NOT NULL',
    'endTime DECIMAL',
    'annotator VARCHAR(255)',
    'timeControl VARCHAR(255)',
    'termination VARCHAR(255)',
    'initialPosition TEXT',
    'server JSON',
    'LeftClient JSON',
    'RightClient JSON',
  ]);

  // Reflects PlayedMove associated with a Replay.
  await client.createTable('Moves', [
    'Replay INTEGER NOT NULL REFERENCES Replays',
    'player SMALLINT NOT NULL',
    'time INT NOT NULL',
    'x1 SMALLINT NOT NULL',
    'y1 SMALLINT NOT NULL',
    'orientation SMALLINT NOT NULL',
  ]);

  await client.end();
})();
