// Le package partagé (schémas Zod, droits, types) vit hors de apps/mobile : on l'expose à Metro.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [...(config.watchFolders ?? []), path.join(root, 'packages/shared')];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  '@resto/shared': path.join(root, 'packages/shared/src/index.ts'),
  // zod doit être résolu depuis l'app (une seule copie), pas depuis packages/shared
  zod: path.join(__dirname, 'node_modules/zod'),
};
module.exports = config;
