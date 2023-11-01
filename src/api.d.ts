import {
  type Replay,
  type ApplicationInfo,
  type RevealedPiece,
  ReplayMetadata,
  ReplayResult,
  SimpleGame,
  PlayedMove,
} from 'pujo-puyo-core';

// Generic types

type GameType = Replay['metadata']['type'];

type Challenge = {
  uuid: string;
  gameType: GameType;
  autoMatch: boolean;
  ranked: boolean;
  botsAllowed: boolean;
  name?: string;
  password?: string;
};

type ReplayFragment = {
  id: number;
  userIds: number[];
  winner: Replay['result']['winner'];
  reason: Replay['result']['reason'];
  names: Replay['metadata']['names'];
  elos: Replay['metadata']['elos'];
  event: Replay['metadata']['event'];
  site: Replay['metadata']['site'];
  msSince1970: Replay['metadata']['msSince1970'];
  endTime: Replay['metadata']['endTime'];
  type: Replay['metadata']['type'];
  timecontrol: Replay['metadata']['timeControl'];
};

// Incoming (server's perspective)

type PausingMoveBase = {
  type: 'pausing move';
  x1: number;
  y1: number;
  hardDrop: boolean;
  pass: false;
  msRemaining: number;
};

interface OrientedPausingMove extends PausingMoveBase {
  orientation: number;
}

interface CoordinatedPausingMove extends PausingMoveBase {
  orientation: undefined;
  x2: number;
  y2: number;
}

type PassingMove = {
  type: 'pausing move';
  pass: true;
  msRemaining: number;
};

type PausingMove = OrientedPausingMove | CoordinatedPausingMove | PassingMove;

interface RealtimeMoveBase {
  type: 'realtime move';
  x1: number;
  y1: number;
  hardDrop: boolean;
  time?: number;
}

interface OrientedRealtimeMove extends RealtimeMoveBase {
  orientation: number;
}

interface CoordinatedRealtimeMove extends RealtimeMoveBase {
  orientation: undefined;
  x2: number;
  y2: number;
}

type RealtimeMove = OrientedRealtimeMove | CoordinatedRealtimeMove;

interface GameRequest extends Omit<Challenge, 'uuid'> {
  type: 'game request';
}

type ChallengeListRequest = {
  type: 'challenge list';
};

type AcceptChallenge = {
  type: 'accept challenge';
  uuid?: string;
  password?: string;
};

type ClientRelay = {
  socketId?: number;
};

interface UserMessage extends ClientRelay {
  type: 'user';
  username?: string;
  isBot?: boolean;
  clientInfo?: ApplicationInfo;
  authUuid?: string;
}

type SimpleStateRequest = {
  type: 'simple state request';
};

type ResultMessage = {
  type: 'result';
  reason: 'resignation' | 'timeout';
};

type ReadyMessage = {
  type: 'ready';
};

type CancelGameRequest = {
  type: 'cancel game request';
};

interface ListReplays extends ClientRelay {
  type: 'list replays';
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'ASC' | 'DESC';
  userId?: number;
}

interface GetReplay extends ClientRelay {
  type: 'get replay';
  id: number;
}

type ClientMessage =
  | GameRequest
  | ChallengeListRequest
  | AcceptChallenge
  | CancelGameRequest
  | UserMessage
  | SimpleStateRequest
  | ResultMessage
  | ReadyMessage
  | PausingMove
  | RealtimeMove
  | ListReplays
  | GetReplay;

// Outgoing (server's perspective)

interface ServerPausingNormalMove extends PlayedMove {
  type: 'pausing move';
  pass: false;
  msRemaining: number;
}

interface ServerPassingMove extends PassingMove {
  player: number;
}

type ServerPausingMove = ServerPausingNormalMove | ServerPassingMove;

interface ServerRealtimeMove extends PlayedMove {
  type: 'realtime move';
}

type GameParams = {
  type: 'game params';
  colorSelections: Replay['colorSelections'];
  screenSeed: Replay['screenSeed'];
  targetPoints: Replay['targetPoints'];
  marginFrames: Replay['marginFrames'];
  mercyFrames: Replay['mercyFrames'];
  initialBags: number[][];
  identity: number;
  metadata: ReplayMetadata;
};

interface PieceMessage extends RevealedPiece {
  type: 'piece';
}

type Retcon = {
  type: 'retcon';
  time: number;
  rejectedMoves: PlayedMove[];
};

type GameResult = {
  type: 'game result';
  winner: ReplayResult['winner'];
  reason: ReplayResult['reason'];
  msSince1970: ReplayMetadata['endTime'];
  gameSeed: Replay['gameSeed'];
};

type SimpleState = {
  type: 'simple state';
  state: SimpleGame;
};

type TimerMessage = {
  type: 'timer';
  player: number;
  msRemaining: number;
};

type ServerUserMessage = {
  type: 'user';
  username: string;
  eloRealtime: number;
  eloPausing: number;
};

type GoMessage = {
  type: 'go';
};

type ChallengeList = {
  type: 'challenge list';
  challenges: Challenge[];
};

type ChallengeNotFound = {
  type: 'challenge not found';
  uuid?: string;
  password?: string;
};

type ServerReplays = {
  type: 'replays';
  replays: ReplayFragment[];
};

type ServerReplay = {
  type: 'replay';
  replay?: Replay;
};

type ServerMessage =
  | GameParams
  | PieceMessage
  | Retcon
  | GameResult
  | SimpleState
  | TimerMessage
  | ServerPausingMove
  | ServerRealtimeMove
  | ServerUserMessage
  | ChallengeNotFound
  | ChallengeList
  | GoMessage
  | ServerReplays
  | ServerReplay;

// Database interaction

type DatabaseHello = {
  type: 'database:hello';
  authorization: string;
};

type DatabaseRelay = {
  socketId: number;
  authorization: string;
};

interface DatabaseUser extends DatabaseRelay {
  type: 'database:user';
  payload: ServerUserMessage;
}

interface DatabaseReplays extends DatabaseRelay {
  type: 'database:replays';
  payload: ServerReplays;
}

interface DatabaseReplay extends DatabaseRelay {
  type: 'database:replay';
  payload: ServerReplay;
}

type DatabaseMessage =
  | DatabaseHello
  | DatabaseUser
  | DatabaseReplays
  | DatabaseReplay;

type EloUpdate = {
  type: 'elo update';
  gameType: GameType;
  winner: ReplayResult['winner'];
  authUuids: string[];
};

type ReplayInsert = {
  type: 'replay';
  replay: Replay;
  private: boolean;
  authUuids: string[];
};

type DatabaseQuery =
  | EloUpdate
  | ReplayInsert
  | UserMessage
  | ListReplays
  | GetReplay;
