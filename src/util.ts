import {ApplicationInfo, HEIGHT, WIDTH} from 'pujo-puyo-core';
import {packages} from '../package-lock.json';
import {name as appName, version} from '../package.json';
import {MoveMessage, ServerMoveMessage, ServerNormalMove} from './api';

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

export function sanitizeMove(
  player: number,
  time: number,
  content: MoveMessage
): ServerMoveMessage {
  if (content.pass) {
    return {
      type: 'move',
      player,
      pass: true,
      msRemaining: parseFloat(content.msRemaining as unknown as string),
    };
  }
  const result: ServerNormalMove = {
    type: 'move',
    player,
    time,
    x1: Math.max(
      0,
      Math.min(WIDTH - 1, parseInt(content.x1 as unknown as string, 10))
    ),
    y1: Math.max(
      1,
      Math.min(HEIGHT - 1, parseInt(content.y1 as unknown as string, 10))
    ),
    x2: NaN,
    y2: NaN,
    orientation: parseInt(content.orientation as unknown as string, 10) & 3,
    hardDrop: !!content.hardDrop,
    pass: false,
    msRemaining: parseFloat(content.msRemaining as unknown as string),
  };
  if (content.orientation === undefined) {
    result.x2 = content.x2;
    result.y2 = content.y2;
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
  } else {
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
