import sql from './db.js';

(async () => {
  await sql`DROP TABLE IF EXISTS replays;`;
  await sql`DROP TABLE IF EXISTS users;`;
  await sql`DROP TYPE IF EXISTS REASON;`;
  await sql`DROP TYPE IF EXISTS GAME_TYPE;`;

  await sql`CREATE TYPE REASON AS ENUM (
    'ongoing',
    'resignation',
    'timeout',
    'lagging',
    'advancing',
    'disconnect',
    'lockout',
    'double lockout',
    'impasse',
    'max time exceeded',
    'server maintenance'
  );`;

  await sql`CREATE TYPE GAME_TYPE AS ENUM ('realtime', 'pausing');`;

  await sql`CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    auth_uuid UUID NOT NULL UNIQUE,
    elo_realtime REAL NOT NULL,
    elo_pausing REAL NOT NULL
  );`;

  // Reflects the Replay type.
  await sql`CREATE TABLE replays (
    id SERIAL PRIMARY KEY,
    private BOOLEAN,
    -- Main fields
    game_seeds BIGINT[] NOT NULL,
    screen_seeds BIGINT[] NOT NULL,
    color_selections SMALLINT[][] NOT NULL,
    initial_bags SMALLINT[][] NOT NULL,
    target_points SMALLINT[] NOT NULL,
    margin_frames REAL NOT NULL,
    mercy_frames REAL NOT NULL,
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
    type GAME_TYPE NOT NULL,
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
