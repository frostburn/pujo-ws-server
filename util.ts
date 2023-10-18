import {ApplicationInfo} from 'pujo-puyo-core';
import {packages} from './package-lock.json';
import {name as appName, version} from './package.json';

const commitHash = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'])
  .stdout
  .toString()
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
