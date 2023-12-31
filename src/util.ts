import {ApplicationInfo, HEIGHT, WIDTH} from 'pujo-puyo-core';
import {packages} from '../package-lock.json';
import {name as appName, version} from '../package.json';
import {
  Challenge,
  ClientMessage,
  GameRequest,
  GameType,
  OrientedPausingMove,
  OrientedRealtimeMove,
  PassingMove,
  PausingMove,
  RealtimeMove,
  ServerMessage,
} from './api';

export const MAX_CONSECUTIVE_REROLLS = 20;

const commitHash = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'])
  .stdout.toString()
  .trim();

const core = packages['node_modules/pujo-puyo-core'];

export const CLIENT_INFO: ApplicationInfo = {
  version,
  resolved: commitHash,
  name: appName,
  core: {
    version: core.version,
    resolved: core.resolved,
  },
};

function sanitizeX(x: number | string) {
  if (typeof x !== 'number') {
    x = parseInt(x, 10);
  }
  if (isNaN(x)) {
    x = 0;
  }
  return Math.max(0, Math.min(WIDTH - 1, x));
}

function sanitizeY(y: number | string) {
  if (typeof y !== 'number') {
    y = parseInt(y, 10);
  }
  if (isNaN(y)) {
    y = 1;
  }
  return Math.max(1, Math.min(HEIGHT - 1, y));
}

export function sanitizePausingMove(
  content: PausingMove
): PassingMove | OrientedPausingMove {
  if (content.pass) {
    return {
      type: 'pausing move',
      pass: true,
      msRemaining: parseFloat(content.msRemaining as unknown as string),
    };
  }
  const result: OrientedPausingMove = {
    type: 'pausing move',
    x1: sanitizeX(content.x1),
    y1: sanitizeY(content.y1),
    orientation: parseInt(content.orientation as unknown as string, 10) & 3,
    hardDrop: !!content.hardDrop,
    pass: false,
    msRemaining: parseFloat(content.msRemaining as unknown as string),
  };
  if (content.orientation === undefined) {
    if (content.y2 === content.y1 - 1) {
      result.orientation = 0;
    } else if (content.y2 === content.y1 + 1) {
      result.orientation = 2;
    } else if (content.x2 === content.x1 - 1) {
      result.orientation = 1;
    } else if (content.x2 === content.x1 + 1) {
      result.orientation = 3;
    } else {
      throw new Error('Unable to sanitize move coordinates');
    }
  }
  return result;
}

export function sanitizeRealtimeMove(
  time: number,
  content: RealtimeMove
): Required<OrientedRealtimeMove> {
  const result: Required<OrientedRealtimeMove> = {
    type: 'realtime move',
    time: content.time || time,
    x1: sanitizeX(content.x1),
    y1: sanitizeY(content.y1),
    orientation: parseInt(content.orientation as unknown as string, 10) & 3,
    hardDrop: !!content.hardDrop,
  };
  if (content.orientation === undefined) {
    if (content.y2 === content.y1 - 1) {
      result.orientation = 0;
    } else if (content.y2 === content.y1 + 1) {
      result.orientation = 2;
    } else if (content.x2 === content.x1 - 1) {
      result.orientation = 1;
    } else if (content.x2 === content.x1 + 1) {
      result.orientation = 3;
    } else {
      throw new Error('Unable to sanitize move coordinates');
    }
  }
  return result;
}

export function clampString(str: string, maxLength = 255) {
  return [...str].slice(0, maxLength).join('');
}

export function sanitizeClientInfo(content: ApplicationInfo): ApplicationInfo {
  const result: ApplicationInfo = {
    name: clampString(content.name),
    version: clampString(content.version),
  };
  if (content.resolved !== undefined) {
    result.resolved = clampString(content.resolved);
  }
  if (content.core !== undefined) {
    result.core = {
      version: clampString(content.core.version),
    };
    if (content.core.resolved !== undefined) {
      result.core.resolved = clampString(content.core.resolved);
    }
  }
  return result;
}

export function sanitizeChallenge(content: GameRequest): Challenge {
  return {
    uuid: crypto.randomUUID(),
    gameType: content.gameType === 'pausing' ? 'pausing' : 'realtime',
    autoMatch: !!content.autoMatch,
    ranked: !!content.ranked,
    botsAllowed: !!content.botsAllowed,
    name: content.name === undefined ? undefined : clampString(content.name),
    password:
      content.password === undefined
        ? undefined
        : clampString(content.password),
  };
}

export class ClientSocket extends WebSocket {
  pongTimeout: Timer | null;

  constructor(url: string | URL) {
    super(url);
    this.pongTimeout = null;

    this.onopen = () => {
      setInterval(this.heartbeat.bind(this), 10000);
    };
  }

  cardiacArrest() {
    this.close();
    setTimeout(process.exit, 1000);
  }

  heartbeat() {
    this.send('ping');
    this.pongTimeout = setTimeout(this.cardiacArrest.bind(this), 2000);
  }

  sendMessage(message: ClientMessage) {
    return super.send(JSON.stringify(message));
  }

  requestGame(gameType: GameType) {
    this.sendMessage({
      type: 'game request',
      gameType,
      autoMatch: true,
      botsAllowed: true,
      ranked: true,
    });
  }

  addMessageListener(listener: (message: ServerMessage) => void) {
    super.addEventListener('message', event => {
      if (event.data === 'pong') {
        if (this.pongTimeout !== null) {
          clearTimeout(this.pongTimeout);
        }
      } else {
        let data: ServerMessage;
        if (event.data instanceof Buffer) {
          data = JSON.parse(event.data.toString());
        } else {
          data = JSON.parse(event.data);
        }
        listener(data);
      }
    });
  }
}
