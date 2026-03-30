import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const targetRoot = path.join(
  repoRoot,
  '.bundled-tools',
  'lsp',
  `${process.platform}-${process.arch}`,
);

const env = process.env;
const executableExtensions =
  process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

const resolveFirstExisting = (candidates) => {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const resolveExecutableOnPath = (command, options = {}) => {
  const pathEntries = (env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean);

  for (const entry of pathEntries) {
    for (const extension of executableExtensions) {
      const candidate = path.join(entry, `${command}${extension}`);
      if (existsSync(candidate)) {
        if (Array.isArray(options.rejectRealpathBasenames)) {
          const resolvedBasename = path.basename(realpathSync(candidate));
          if (options.rejectRealpathBasenames.includes(resolvedBasename)) {
            continue;
          }
        }

        return candidate;
      }
    }
  }

  return null;
};

const buildGoplsIfPossible = () => {
  const goBinary = resolveExecutableOnPath('go');
  if (!goBinary) {
    return null;
  }

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'zero-gopls-'));
  execFileSync(goBinary, ['install', 'golang.org/x/tools/gopls@latest'], {
    env: {
      ...env,
      GOBIN: tempRoot,
    },
    stdio: 'inherit',
  });

  const output = path.join(tempRoot, process.platform === 'win32' ? 'gopls.exe' : 'gopls');
  return existsSync(output) ? output : null;
};

const javaSource = resolveFirstExisting([
  env.ZERO_BUNDLED_JAVA_JDK,
  env.ZERO_BUNDLED_JAVA_HOME
    ? path.resolve(env.ZERO_BUNDLED_JAVA_HOME, '..', '..')
    : null,
  '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk',
  '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk',
]);

const kotlinSource = resolveFirstExisting([
  env.ZERO_BUNDLED_KOTLIN_LSP_HOME,
  '/opt/homebrew/opt/kotlin-language-server/libexec',
]);

const jdtlsSource = resolveFirstExisting([
  env.ZERO_BUNDLED_JDTLS_HOME,
  '/opt/homebrew/opt/jdtls/libexec',
]);

const rustAnalyzerSource = resolveFirstExisting([
  env.ZERO_BUNDLED_RUST_ANALYZER,
  '/opt/homebrew/bin/rust-analyzer',
  resolveExecutableOnPath('rust-analyzer', {
    rejectRealpathBasenames: ['rustup'],
  }),
]);

const goplsSource =
  resolveFirstExisting([
    env.ZERO_BUNDLED_GOPLS,
    resolveExecutableOnPath('gopls'),
  ]) ?? buildGoplsIfPossible();

const bundleSpecs = [
  {
    id: 'java',
    source: javaSource,
    target: path.join(targetRoot, 'java', 'openjdk.jdk'),
    required: true,
  },
  {
    id: 'kotlin-language-server',
    source: kotlinSource,
    target: path.join(targetRoot, 'kotlin-language-server'),
    required: true,
  },
  {
    id: 'jdtls',
    source: jdtlsSource,
    target: path.join(targetRoot, 'jdtls'),
    required: true,
  },
  {
    id: 'rust-analyzer',
    source: rustAnalyzerSource,
    target: path.join(
      targetRoot,
      'rust-analyzer',
      'bin',
      process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer',
    ),
    required: true,
  },
  {
    id: 'gopls',
    source: goplsSource,
    target: path.join(
      targetRoot,
      'gopls',
      'bin',
      process.platform === 'win32' ? 'gopls.exe' : 'gopls',
    ),
    required: true,
  },
];

const missingRequired = bundleSpecs
  .filter((spec) => spec.required && !spec.source)
  .map((spec) => spec.id);

if (missingRequired.length > 0) {
  const sourceHelp = [
    'Set the relevant env vars before packaging:',
    '  ZERO_BUNDLED_JAVA_JDK=/path/to/openjdk.jdk',
    '  ZERO_BUNDLED_KOTLIN_LSP_HOME=/path/to/kotlin-language-server/libexec',
    '  ZERO_BUNDLED_JDTLS_HOME=/path/to/jdtls/libexec',
    '  ZERO_BUNDLED_RUST_ANALYZER=/path/to/rust-analyzer',
    '  ZERO_BUNDLED_GOPLS=/path/to/gopls',
  ].join('\n');
  throw new Error(
    `Missing bundled LSP sources for: ${missingRequired.join(', ')}.\n${sourceHelp}`,
  );
}

rmSync(targetRoot, { force: true, recursive: true });
mkdirSync(targetRoot, { recursive: true });

for (const spec of bundleSpecs) {
  mkdirSync(path.dirname(spec.target), { recursive: true });
  cpSync(spec.source, spec.target, {
    dereference: true,
    recursive: true,
  });
}

const executableTargets = [
  path.join(targetRoot, 'kotlin-language-server', 'bin', 'kotlin-language-server'),
  path.join(targetRoot, 'jdtls', 'bin', 'jdtls'),
  path.join(
    targetRoot,
    'rust-analyzer',
    'bin',
    process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer',
  ),
  path.join(targetRoot, 'gopls', 'bin', process.platform === 'win32' ? 'gopls.exe' : 'gopls'),
];

for (const executable of executableTargets) {
  if (existsSync(executable)) {
    chmodSync(executable, 0o755);
  }
}

const manifest = {
  platform: process.platform,
  arch: process.arch,
  stagedAt: new Date().toISOString(),
  host: os.hostname(),
  sources: {
    java: javaSource,
    kotlin: kotlinSource,
    jdtls: jdtlsSource,
    rustAnalyzer: rustAnalyzerSource,
    gopls: goplsSource,
  },
};

writeFileSync(
  path.join(targetRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`Staged bundled LSP resources into ${targetRoot}`);
