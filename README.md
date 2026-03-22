# Zero

Zero is a desktop AI coding workspace built with Electron + React + TypeScript.
It combines chat-first workflows with ACP-based agent orchestration, workspace tools, and a modern desktop shell.

Website: [zeroade.dev](https://zeroade.dev)

![Zero app screenshot](./docs/landing-screenshot.png)

## What You Get

- Multi-agent ACP support (Codex, Claude Code, and custom/registry agents)
- In-app agent auth and connection handling
- Shared per-thread history when switching agents
- New-thread landing with quick suggestions
- Voice input in composer (click to toggle, `Ctrl+M` hold-to-talk)
- File tree + review panel with Monaco editor
- Integrated terminal panel and update flow

## Requirements

- Node.js 20+
- npm 10+
- macOS recommended for native titlebar/window parity

## Run Locally

```bash
npm install
npm run start
```

## Useful Commands

```bash
npm run lint
npm run package
npm run make
npm run make:mac:arm64
```

## Auto Update Setup

By default, update checks use `package.json -> repository.url`.

If you want to override it at runtime, set:

```bash
export ZEROADE_UPDATE_REPOSITORY_URL="https://github.com/egor-baranov/zero"
```

For packaged `main` builds, the app uses a fixed GitHub Pages feed by default:

```bash
https://egor-baranov.github.io/zero/updates/main/main-mac.yml
```

You can override that too:

```bash
export ZEROADE_MAIN_UPDATE_BASE_URL="https://egor-baranov.github.io/zero/updates/main"
```

## GitHub macOS Build + Release

This repo includes a GitHub Actions workflow at:

`/.github/workflows/release-macos-arm64.yml`

What it does:

- Builds macOS Apple Silicon (`arm64`) with Electron Forge
- On push to `main`, publishes a GitHub prerelease build with a version like
  `1.0.1-main.123`
- On tag push (`v*`), publishes a stable GitHub release
- Generates:
  - `Zero-darwin-arm64.dmg` for user installs
  - `Zero-darwin-arm64.zip` + `latest-mac.yml` for `electron-updater`
  - `main-mac.yml` so packaged `main` builds can keep following later `main` builds
- Uploads the macOS assets to the GitHub Release

Release flow:

```bash
git tag v1.0.1
git push origin v1.0.1
```

The release assets from that tag can be linked directly from your website, and the packaged app can auto-update from GitHub Releases.

Channel behavior:

- Packaged builds from `main` use their prerelease version (for example `-main.123`)
  to follow newer `main` builds automatically via GitHub Pages.
- Tagged releases stay on the stable channel and continue to use `latest-mac.yml`.

Constant `main` URLs:

- Latest main macOS Apple Silicon installer:
  `https://egor-baranov.github.io/zero/updates/main/Zero-darwin-arm64.dmg`
- Latest main updater ZIP:
  `https://egor-baranov.github.io/zero/updates/main/Zero-darwin-arm64.zip`
- Latest main updater metadata:
  `https://egor-baranov.github.io/zero/updates/main/main-mac.yml`

Canonical stable URLs:

- Latest macOS Apple Silicon installer:
  `https://github.com/egor-baranov/zero/releases/latest/download/Zero-darwin-arm64.dmg`
- Latest updater ZIP:
  `https://github.com/egor-baranov/zero/releases/latest/download/Zero-darwin-arm64.zip`
- Latest updater metadata:
  `https://github.com/egor-baranov/zero/releases/latest/download/latest-mac.yml`
- Latest release page:
  `https://github.com/egor-baranov/zero/releases/latest`

Website guidance:

- Public website download buttons should point to the `dmg`.
- The `zip` should stay as the update channel artifact for `electron-updater`.

## Tech Stack

- Electron Forge + Vite
- React 19 + TypeScript
- Tailwind CSS + Radix UI
- ACP SDK (`@agentclientprotocol/sdk`)
- Monaco Editor

## Project Layout

```text
src/
  main/        # Electron main process, IPC, ACP services
  preload/     # secure typed bridge
  renderer/    # UI, features, state stores
  shared/      # shared contracts/types
```
