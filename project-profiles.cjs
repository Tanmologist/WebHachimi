'use strict';

const path = require('path');

const LEGACY_V2_PROJECT_ROUTE = '/api/v2/project';
const WEBHACHIMI_EDITOR_ENTRY = 'apps/webhachimi/editor.html';
const HACHIMI_GAME_ENTRY = 'games/hachimi-nanbei-lvdong/index.html';
const HACHIMI_GAME_EDITOR_ENTRY = 'games/hachimi-nanbei-lvdong/editor.html';

function createProjectProfiles(rootDir) {
  const dataDir = path.join(rootDir, 'data');
  const localDataDir = path.join(dataDir, 'local');
  const hachimiGameDir = path.join(rootDir, 'games', 'hachimi-nanbei-lvdong');

  return [
    {
      id: 'webhachimi',
      routes: ['/api/webhachimi/project'],
      projectFile: path.join(localDataDir, 'webhachimi-project.json'),
      assetsDir: path.join(localDataDir, 'webhachimi-resources'),
      assetUrlPrefix: '/api/webhachimi/assets',
    },
    {
      id: 'hachimi-nanbei-lvdong',
      routes: ['/api/games/hachimi-nanbei-lvdong/project', LEGACY_V2_PROJECT_ROUTE],
      projectSeedFile: path.join(hachimiGameDir, 'project.json'),
      projectFile: path.join(hachimiGameDir, 'local', 'project.json'),
      assetsDir: path.join(hachimiGameDir, 'resources'),
      assetUrlPrefix: '/games/hachimi-nanbei-lvdong/resources',
    },
  ];
}

function projectProfilesByRoute(profiles) {
  return new Map(profiles.flatMap((profile) => profile.routes.map((route) => [route, profile])));
}

module.exports = {
  LEGACY_V2_PROJECT_ROUTE,
  WEBHACHIMI_EDITOR_ENTRY,
  HACHIMI_GAME_ENTRY,
  HACHIMI_GAME_EDITOR_ENTRY,
  createProjectProfiles,
  projectProfilesByRoute,
};
