import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Agor',
    executableName: 'Agor',
    icon: './resources/icon.png',
    appBundleId: 'io.preset.agor',
    appCategoryType: 'public.app-category.developer-tools',
    asar: false, // Disable ASAR to simplify packaging with pnpm
    extraResource: [
      // Will bundle daemon and UI here once built
    ],
    // Skip pruning to avoid pnpm symlink issues
    prune: false,
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      format: 'ULFO',
      icon: './resources/icon.icns',
    }),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [],
};

export default config;
