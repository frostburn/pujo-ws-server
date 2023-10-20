import sql from './db.js';

(async () => {
  await sql`DROP TABLE IF EXISTS replays;`;
  await sql`DROP TABLE IF EXISTS users;`;
  await sql`DROP TYPE IF EXISTS REASON;`;

  await sql`CREATE TYPE REASON AS ENUM (
    'ongoing',
    'resignation',
    'timeout',
    'disconnect',
    'lockout',
    'double lockout',
    'max time exceeded',
    'server maintenance'
  );`;

  await sql`CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    auth_uuid UUID NOT NULL UNIQUE,
    elo REAL NOT NULL
  );`;

  // Reflects the Replay type.
  await sql`CREATE TABLE replays (
    id SERIAL PRIMARY KEY,
    -- Main fields
    game_seed BIGINT NOT NULL,
    screen_seed BIGINT NOT NULL,
    color_selection SMALLINT[] NOT NULL,
    -- Moves are stored as horrible byte balls to save space
    moves INT[] NOT NULL,
    -- ReplayResult fields
    winner SMALLINT NULL,
    reason REASON NOT NULL,
    -- Metadata fields
    names VARCHAR(255)[] NOT NULL,
    elos REAL[] NOT NULL,
    prior_wins INT[] NOT NULL,
    event VARCHAR(255) NOT NULL,
    site VARCHAR(255) NOT NULL,
    round INT NOT NULL,
    ms_since1970 BIGINT NOT NULL,
    end_time BIGINT,
    annotator VARCHAR(255),
    time_control VARCHAR(255),
    termination VARCHAR(255),
    initial_position TEXT,
    server JSON,
    clients JSON[],
    -- Foreign keys for querying by player
    left_player INTEGER NOT NULL REFERENCES users,
    right_player INTEGER NOT NULL REFERENCES users
  );`;

  await sql.end();
})();