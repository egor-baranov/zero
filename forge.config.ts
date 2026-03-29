import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const appleSigningIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const appleId = process.env.APPLE_ID?.trim();
const appleAppSpecificPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim();
const appleTeamId = process.env.APPLE_TEAM_ID?.trim();

const shouldIgnorePackagedFile = (file: string): boolean => {
  if (!file) {
    return false;
  }

  // Include Vite bundles, package metadata, and production dependencies.
  // ACP adapters (including scoped packages) and native modules must be present at runtime.
  if (
    file.startsWith('/.vite') ||
    file === '/package.json' ||
    file.startsWith('/node_modules')
  ) {
    return false;
  }

  return true;
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // Keep runtime-executed binaries outside app.asar.
      unpackDir: '{**/node_modules/@zed-industries,**/node_modules/node-pty}',
    },
    usageDescription: {
      Microphone: 'Zero uses your microphone for composer voice input.',
    },
    osxSign: appleSigningIdentity
      ? {
          identity: appleSigningIdentity,
          hardenedRuntime: true,
          entitlements: 'assets/entitlements.mac.plist',
          'entitlements-inherit': 'assets/entitlements.mac.inherit.plist',
          'signature-flags': 'library',
        }
      : undefined,
    osxNotarize:
      appleId && appleAppSpecificPassword && appleTeamId
        ? {
            appleId,
            appleIdPassword: appleAppSpecificPassword,
            teamId: appleTeamId,
          }
        : undefined,
    icon: 'assets/icons/zero-icon',
    // Keep Vite's slim package output while including native runtime deps.
    ignore: shouldIgnorePackagedFile,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    // Keep ZIP for electron-updater metadata and add DMG for user-facing installer UX.
    new MakerDMG({}, ['darwin']),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
