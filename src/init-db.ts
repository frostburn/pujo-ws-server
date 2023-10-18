import {Database} from './database';

const db = new Database('db.sqlite');

// The convention is that PascalCased columns need post-processing while camelCased can be used as-is.

db.createTable('Users', [
  'Id INTEGER PRIMARY KEY AUTOINCREMENT',
  'username VARCHAR(255) NOT NULL',
  'authUUID CHAR(36) NOT NULL',
  'elo DOUBLE NOT NULL',
]);

// Reflects the Replay type.
db.createTable('Replays', [
  // DB field
  'Id INTEGER PRIMARY KEY AUTOINCREMENT',
  // Main fields
  'gameSeed DECIMAL(10) NOT NULL',
  'screenSeed DECIMAL(10) NOT NULL',
  // Color selection
  'Color0 TINYINT NOT NULL',
  'Color1 TINYINT NOT NULL',
  'Color2 TINYINT NOT NULL',
  'Color3 TINYINT NOT NULL',
  // (Moves in a separate table)
  // ReplayResult fields
  'Winner INTEGER NULL',
  "reason VARCHAR(32) CHECK( Reason IN ('ongoing', 'resignation', 'timeout', 'disconnect', 'lockout', 'double lockout', 'max time exceeded', 'server maintenance') ) NOT NULL",
  // Metadata fields
  // Names and ELOs as foreign keys
  'Left INTEGER NOT NULL',
  'Right INTEGER NOT NULL',
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
  'FOREIGN KEY (Winner) REFERENCES Users(Id)',
  'FOREIGN KEY (Left) REFERENCES Users(Id)',
  'FOREIGN KEY (Right) REFERENCES Users(Id)',
]);

// Reflects PlayedMove associated with a Replay.
db.createTable('Moves', [
  'Replay INTEGER NOT NULL',
  'player TINYINT NOT NULL',
  'time INT NOT NULL',
  'x1 TINYINT NOT NULL',
  'y1 TINYINT NOT NULL',
  'orientation TINYINT NOT NULL',
  'FOREIGN KEY (Replay) REFERENCES Replays(Id)',
]);

db.close();
