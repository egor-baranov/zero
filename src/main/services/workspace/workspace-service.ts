import { shell } from 'electron';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WorkspaceCopyEntryRequest,
  WorkspaceCopyEntryResult,
  WorkspaceDeleteEntryRequest,
  WorkspaceDeleteEntryResult,
  WorkspaceGitCommitRequest,
  WorkspaceDiffFileRequest,
  WorkspaceDiffFileResult,
  WorkspaceGitFileStat,
  WorkspaceGitCheckoutBranchRequest,
  WorkspaceGitCreateBranchRequest,
  WorkspaceGitMutationResult,
  WorkspaceMoveEntryRequest,
  WorkspaceMoveEntryResult,
  WorkspaceGitPushRequest,
  WorkspaceGitStatusRequest,
  WorkspaceGitStatusResult,
  WorkspaceListFilesRequest,
  WorkspaceListFilesResult,
  WorkspaceReadFileRequest,
  WorkspaceReadFileResult,
  WorkspaceWriteFileRequest,
  WorkspaceWriteFileResult,
  WorkspaceRevealFileRequest,
  WorkspaceRevealFileResult,
} from '@shared/types/workspace';

const execFileAsync = promisify(execFile);
const MAX_FILE_COUNT = 400;
const MAX_FILE_SIZE_BYTES = 1_000_000;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.vite', 'out']);

const toAbsolutePath = (workspacePath: string, filePath: string): string => {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.resolve(workspacePath, filePath);
};

const normalizePseudoWorkspacePath = (
  workspacePath: string,
  filePath: string,
): string => {
  if (filePath.startsWith('/workspace/')) {
    return path.resolve(workspacePath, filePath.replace('/workspace/', ''));
  }

  return toAbsolutePath(workspacePath, filePath);
};

const toWorkspaceRelativePath = (
  workspacePath: string,
  filePath: string,
): string => {
  const absolutePath = normalizePseudoWorkspacePath(workspacePath, filePath);
  ensureInsideWorkspace(workspacePath, absolutePath);
  return path.relative(workspacePath, absolutePath).split(path.sep).join('/');
};

const ensureInsideWorkspace = (
  workspacePath: string,
  absolutePath: string,
): void => {
  const normalizedWorkspace = path.resolve(workspacePath);
  const normalizedFile = path.resolve(absolutePath);

  if (
    normalizedFile !== normalizedWorkspace &&
    !normalizedFile.startsWith(`${normalizedWorkspace}${path.sep}`)
  ) {
    throw new Error('Path is outside of workspace');
  }
};

const ensureDestinationAvailable = async (absolutePath: string): Promise<void> => {
  try {
    await fs.lstat(absolutePath);
    throw new Error('Destination already exists');
  } catch (error) {
    const failure = error as NodeJS.ErrnoException | undefined;
    if (failure?.code === 'ENOENT') {
      return;
    }

    throw error;
  }
};

const ensureParentDirectoryExists = async (absolutePath: string): Promise<void> => {
  const parentDirectory = path.dirname(absolutePath);
  const parentStat = await fs.stat(parentDirectory);
  if (!parentStat.isDirectory()) {
    throw new Error('Destination parent is not a directory');
  }
};

const isSameOrDescendantPath = (parentPath: string, candidatePath: string): boolean => {
  const normalizedParent = path.resolve(parentPath);
  const normalizedCandidate = path.resolve(candidatePath);

  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
  );
};

const copyEntryRecursive = async (
  sourcePath: string,
  destinationPath: string,
): Promise<void> => {
  const sourceStat = await fs.lstat(sourcePath);

  if (sourceStat.isDirectory()) {
    await fs.cp(sourcePath, destinationPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return;
  }

  await fs.copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL);
};

const deleteEntryRecursive = async (targetPath: string): Promise<void> => {
  await fs.rm(targetPath, {
    recursive: true,
    force: false,
  });
};

const moveEntryRecursive = async (
  sourcePath: string,
  destinationPath: string,
): Promise<void> => {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException | undefined;
    if (failure?.code !== 'EXDEV') {
      throw error;
    }

    await copyEntryRecursive(sourcePath, destinationPath);
    await deleteEntryRecursive(sourcePath);
  }
};

const resolveWorkspaceEntryPath = (
  workspacePath: string,
  filePath: string,
): { absolutePath: string; relativePath: string } => {
  const absolutePath = normalizePseudoWorkspacePath(workspacePath, filePath);
  ensureInsideWorkspace(workspacePath, absolutePath);

  return {
    absolutePath,
    relativePath: path.relative(workspacePath, absolutePath).split(path.sep).join('/'),
  };
};

const collectFiles = async (
  root: string,
  current: string,
  files: string[],
): Promise<void> => {
  if (files.length >= MAX_FILE_COUNT) {
    return;
  }

  const entries = await fs.readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    if (files.length >= MAX_FILE_COUNT) {
      return;
    }

    if (entry.name.startsWith('.') && entry.name !== '.env') {
      if (entry.name !== '.github') {
        continue;
      }
    }

    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const absoluteEntry = path.join(current, entry.name);

    if (entry.isDirectory()) {
      await collectFiles(root, absoluteEntry, files);
      continue;
    }

    const relative = path.relative(root, absoluteEntry);

    if (relative.length > 0) {
      files.push(relative);
    }
  }
};

type ExecFileFailure = Error & {
  stderr?: string;
  stdout?: string;
};

const runGit = async (workspacePath: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('git', ['-C', workspacePath, ...args], {
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });

  return stdout;
};

const readFileIfExists = async (absolutePath: string): Promise<string> => {
  try {
    return await fs.readFile(absolutePath, 'utf8');
  } catch (error) {
    const failure = error as NodeJS.ErrnoException | undefined;
    if (failure?.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
};

const readGitFileFromHead = async (
  workspacePath: string,
  relativePath: string,
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workspacePath, 'show', `HEAD:${relativePath}`],
      {
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
      },
    );

    return stdout;
  } catch {
    return '';
  }
};

const readWorkingTreePatch = async (
  workspacePath: string,
  relativePath: string,
): Promise<string> => {
  const diffCommands: string[][] = [
    ['diff', '--no-ext-diff', 'HEAD', '--', relativePath],
    ['diff', '--no-ext-diff', '--cached', '--', relativePath],
    ['diff', '--no-ext-diff', '--', relativePath],
  ];

  for (const args of diffCommands) {
    try {
      const stdout = await runGit(workspacePath, args);
      if (stdout.trim().length > 0) {
        return stdout;
      }
    } catch {
      // Try the next diff form.
    }
  }

  return '';
};

const toExecErrorMessage = (error: unknown, fallback: string): string => {
  const failure = error as ExecFileFailure | undefined;

  if (failure?.stderr?.trim()) {
    return failure.stderr.trim();
  }

  if (failure?.message?.trim()) {
    return failure.message.trim();
  }

  return fallback;
};

const parseNumstatOutput = (
  output: string,
): { additions: number; deletions: number; fileStats: WorkspaceGitFileStat[] } => {
  let additions = 0;
  let deletions = 0;
  const fileStatMap = new Map<string, WorkspaceGitFileStat>();

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t').trim();

    const added = Number.parseInt(addedRaw ?? '', 10);
    const deleted = Number.parseInt(deletedRaw ?? '', 10);
    const normalizedAdditions = Number.isFinite(added) ? added : 0;
    const normalizedDeletions = Number.isFinite(deleted) ? deleted : 0;

    additions += normalizedAdditions;
    deletions += normalizedDeletions;

    if (!filePath) {
      continue;
    }

    const existing = fileStatMap.get(filePath);
    if (existing) {
      existing.additions += normalizedAdditions;
      existing.deletions += normalizedDeletions;
      continue;
    }

    fileStatMap.set(filePath, {
      path: filePath,
      additions: normalizedAdditions,
      deletions: normalizedDeletions,
    });
  }

  return {
    additions,
    deletions,
    fileStats: Array.from(fileStatMap.values()).sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
  };
};

const toNormalizedTextLines = (content: string): string[] => {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (normalized.length === 0) {
    return [];
  }

  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) {
    lines.pop();
  }

  return lines;
};

const buildAddedFilePatch = (relativePath: string, content: string): string => {
  const lines = toNormalizedTextLines(content);
  const patchHeader = [
    `diff --git a/${relativePath} b/${relativePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ];

  if (lines.length === 0) {
    return patchHeader.join('\n');
  }

  return [...patchHeader, ...lines.map((line) => `+${line}`)].join('\n');
};

const parseUntrackedPaths = (statusOutput: string): string[] =>
  statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter((line) => line.length > 0);

const readUntrackedFileStats = async (
  workspacePath: string,
  statusOutput: string,
): Promise<WorkspaceGitFileStat[]> => {
  const untrackedPaths = parseUntrackedPaths(statusOutput);
  const fileStats = await Promise.all(
    untrackedPaths.map(async (relativePath) => {
      const absolutePath = path.resolve(workspacePath, relativePath);
      const content = await fs.readFile(absolutePath, 'utf8').catch(() => '');
      return {
        path: relativePath,
        additions: toNormalizedTextLines(content).length,
        deletions: 0,
      };
    }),
  );

  return fileStats.sort((left, right) => left.path.localeCompare(right.path));
};

const mergeGitFileStats = (
  primary: WorkspaceGitFileStat[],
  fallback: WorkspaceGitFileStat[],
): WorkspaceGitFileStat[] => {
  const merged = new Map<string, WorkspaceGitFileStat>();

  for (const entry of primary) {
    merged.set(entry.path, { ...entry });
  }

  for (const entry of fallback) {
    const existing = merged.get(entry.path);
    if (existing) {
      existing.additions += entry.additions;
      existing.deletions += entry.deletions;
      continue;
    }

    merged.set(entry.path, { ...entry });
  }

  return Array.from(merged.values()).sort((left, right) => left.path.localeCompare(right.path));
};

const getStatusLineCount = (statusOutput: string): number =>
  statusOutput.split('\n').filter((line) => line.trim().length > 0).length;

const hasGitRepository = async (workspacePath: string): Promise<boolean> => {
  try {
    const result = await runGit(workspacePath, ['rev-parse', '--is-inside-work-tree']);
    return result.trim() === 'true';
  } catch {
    return false;
  }
};

const normalizeBranchName = (value: string): string => value.trim();
const normalizeCommitMessage = (value: string): string => value.trim();

export class WorkspaceService {
  public async listFiles(
    request: WorkspaceListFilesRequest,
  ): Promise<WorkspaceListFilesResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const files: string[] = [];

    await collectFiles(workspacePath, workspacePath, files);

    return {
      files: files.sort((a, b) => a.localeCompare(b)),
    };
  }

  public async readFile(
    request: WorkspaceReadFileRequest,
  ): Promise<WorkspaceReadFileResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const absolutePath = normalizePseudoWorkspacePath(workspacePath, request.filePath);

    ensureInsideWorkspace(workspacePath, absolutePath);

    const fileStat = await fs.stat(absolutePath);

    if (!fileStat.isFile()) {
      throw new Error('Path is not a file');
    }

    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      throw new Error('File is too large for inline review');
    }

    const content = await fs.readFile(absolutePath, 'utf8');

    return {
      absolutePath,
      relativePath: path.relative(workspacePath, absolutePath),
      content,
    };
  }

  public async writeFile(
    request: WorkspaceWriteFileRequest,
  ): Promise<WorkspaceWriteFileResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const absolutePath = normalizePseudoWorkspacePath(workspacePath, request.filePath);

    ensureInsideWorkspace(workspacePath, absolutePath);
    await ensureParentDirectoryExists(absolutePath);

    try {
      const fileStat = await fs.stat(absolutePath);
      if (!fileStat.isFile()) {
        throw new Error('Path is not a file');
      }
    } catch (error) {
      const failure = error as NodeJS.ErrnoException | undefined;
      if (failure?.code !== 'ENOENT') {
        throw error;
      }
    }

    await fs.writeFile(absolutePath, request.content, 'utf8');

    return {
      absolutePath,
      relativePath: path.relative(workspacePath, absolutePath),
      bytesWritten: Buffer.byteLength(request.content, 'utf8'),
    };
  }

  public async diffFile(
    request: WorkspaceDiffFileRequest,
  ): Promise<WorkspaceDiffFileResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const absolutePath = normalizePseudoWorkspacePath(workspacePath, request.filePath);

    ensureInsideWorkspace(workspacePath, absolutePath);

    const relativePath = path.relative(workspacePath, absolutePath);
    const modifiedContent = await readFileIfExists(absolutePath);
    const originalContent = await readGitFileFromHead(workspacePath, relativePath);

    const patch = await readWorkingTreePatch(workspacePath, relativePath);
    if (patch.trim().length > 0) {
      return {
        absolutePath,
        relativePath,
        originalContent,
        modifiedContent,
        patch,
        hasDiff: true,
      };
    }

    try {
      const statusOutput = await runGit(workspacePath, ['status', '--porcelain', '--', relativePath]);
      const isUntracked = parseUntrackedPaths(statusOutput).some((entry) => entry === relativePath);
      if (!isUntracked) {
        return {
          absolutePath,
          relativePath,
          originalContent,
          modifiedContent,
          patch: '',
          hasDiff: false,
        };
      }

      const untrackedPatch = buildAddedFilePatch(relativePath, modifiedContent);
      return {
        absolutePath,
        relativePath,
        originalContent: '',
        modifiedContent,
        patch: untrackedPatch,
        hasDiff: untrackedPatch.trim().length > 0,
      };
    } catch {
      return {
        absolutePath,
        relativePath,
        originalContent,
        modifiedContent,
        patch: '',
        hasDiff: false,
      };
    }
  }

  public async copyEntry(
    request: WorkspaceCopyEntryRequest,
  ): Promise<WorkspaceCopyEntryResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const source = resolveWorkspaceEntryPath(workspacePath, request.sourcePath);
    const destination = resolveWorkspaceEntryPath(workspacePath, request.destinationPath);

    if (source.absolutePath === destination.absolutePath) {
      throw new Error('Source and destination are the same');
    }

    const sourceStat = await fs.lstat(source.absolutePath);
    if (sourceStat.isDirectory() && isSameOrDescendantPath(source.absolutePath, destination.absolutePath)) {
      throw new Error('Cannot copy a folder into itself');
    }

    await ensureParentDirectoryExists(destination.absolutePath);
    await ensureDestinationAvailable(destination.absolutePath);
    await copyEntryRecursive(source.absolutePath, destination.absolutePath);

    return {
      absolutePath: destination.absolutePath,
      relativePath: destination.relativePath,
    };
  }

  public async moveEntry(
    request: WorkspaceMoveEntryRequest,
  ): Promise<WorkspaceMoveEntryResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const source = resolveWorkspaceEntryPath(workspacePath, request.sourcePath);
    const destination = resolveWorkspaceEntryPath(workspacePath, request.destinationPath);

    if (source.absolutePath === destination.absolutePath) {
      throw new Error('Source and destination are the same');
    }

    const sourceStat = await fs.lstat(source.absolutePath);
    if (sourceStat.isDirectory() && isSameOrDescendantPath(source.absolutePath, destination.absolutePath)) {
      throw new Error('Cannot move a folder into itself');
    }

    await ensureParentDirectoryExists(destination.absolutePath);
    await ensureDestinationAvailable(destination.absolutePath);
    await moveEntryRecursive(source.absolutePath, destination.absolutePath);

    return {
      absolutePath: destination.absolutePath,
      relativePath: destination.relativePath,
    };
  }

  public async deleteEntry(
    request: WorkspaceDeleteEntryRequest,
  ): Promise<WorkspaceDeleteEntryResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const target = resolveWorkspaceEntryPath(workspacePath, request.targetPath);

    if (target.relativePath.length === 0) {
      throw new Error('Cannot delete the workspace root');
    }

    await fs.lstat(target.absolutePath);
    await deleteEntryRecursive(target.absolutePath);

    return {
      deleted: true,
    };
  }

  private async readGitStatus(workspacePath: string): Promise<WorkspaceGitStatusResult> {
    const repositoryAvailable = await hasGitRepository(workspacePath);
    if (!repositoryAvailable) {
      return {
        available: false,
        currentBranch: null,
        branches: [],
        localBranches: [],
        remoteBranches: [],
        uncommittedFiles: 0,
        additions: 0,
        deletions: 0,
        fileStats: [],
      };
    }

    const [currentBranchOutput, localBranchesOutput, remoteBranchesOutput, statusOutput] =
      await Promise.all([
      runGit(workspacePath, ['branch', '--show-current']).catch(() => ''),
      runGit(workspacePath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).catch(
        () => '',
      ),
      runGit(workspacePath, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']).catch(
        () => '',
      ),
      runGit(workspacePath, ['status', '--porcelain']).catch(() => ''),
    ]);

    let numstatOutput = '';
    try {
      numstatOutput = await runGit(workspacePath, ['diff', '--numstat', 'HEAD']);
    } catch {
      const [stagedNumstat, unstagedNumstat] = await Promise.all([
        runGit(workspacePath, ['diff', '--numstat', '--cached']).catch(() => ''),
        runGit(workspacePath, ['diff', '--numstat']).catch(() => ''),
      ]);
      numstatOutput = `${stagedNumstat}\n${unstagedNumstat}`;
    }

    let currentBranch = currentBranchOutput.trim();
    if (!currentBranch) {
      const detachedHead = (await runGit(workspacePath, ['rev-parse', '--short', 'HEAD']).catch(
        () => '',
      )).trim();
      currentBranch = detachedHead ? `detached@${detachedHead}` : '';
    }

    const localBranches = localBranchesOutput
      .split('\n')
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0)
      .sort((left, right) => left.localeCompare(right));
    const remoteBranches = remoteBranchesOutput
      .split('\n')
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0 && !branch.endsWith('/HEAD'))
      .sort((left, right) => left.localeCompare(right));

    if (currentBranch && !localBranches.some((branch) => branch === currentBranch)) {
      localBranches.unshift(currentBranch);
    }

    const branches = [...localBranches, ...remoteBranches];

    const trackedStats = parseNumstatOutput(numstatOutput);
    const untrackedFileStats = await readUntrackedFileStats(workspacePath, statusOutput).catch(
      () => [],
    );
    const fileStats = mergeGitFileStats(trackedStats.fileStats, untrackedFileStats);
    const additions =
      trackedStats.additions +
      untrackedFileStats.reduce((sum, file) => sum + file.additions, 0);
    const deletions =
      trackedStats.deletions +
      untrackedFileStats.reduce((sum, file) => sum + file.deletions, 0);

    return {
      available: true,
      currentBranch: currentBranch || null,
      branches,
      localBranches,
      remoteBranches,
      uncommittedFiles: getStatusLineCount(statusOutput),
      additions,
      deletions,
      fileStats,
    };
  }

  public async gitStatus(
    request: WorkspaceGitStatusRequest,
  ): Promise<WorkspaceGitStatusResult> {
    const workspacePath = path.resolve(request.workspacePath);
    return this.readGitStatus(workspacePath);
  }

  public async checkoutBranch(
    request: WorkspaceGitCheckoutBranchRequest,
  ): Promise<WorkspaceGitMutationResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const branchName = normalizeBranchName(request.branchName);

    if (!branchName) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Branch name is required.',
      };
    }

    const repositoryAvailable = await hasGitRepository(workspacePath);
    if (!repositoryAvailable) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Current project is not a git repository.',
      };
    }

    try {
      try {
        await runGit(workspacePath, ['switch', branchName]);
      } catch {
        await runGit(workspacePath, ['checkout', branchName]);
      }

      const status = await this.readGitStatus(workspacePath);
      return {
        ok: true,
        currentBranch: status.currentBranch,
        error: null,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        currentBranch: null,
        error: toExecErrorMessage(error, `Failed to checkout "${branchName}".`),
      };
    }
  }

  public async createBranch(
    request: WorkspaceGitCreateBranchRequest,
  ): Promise<WorkspaceGitMutationResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const branchName = normalizeBranchName(request.branchName);

    if (!branchName) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Branch name is required.',
      };
    }

    const repositoryAvailable = await hasGitRepository(workspacePath);
    if (!repositoryAvailable) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Current project is not a git repository.',
      };
    }

    try {
      await runGit(workspacePath, ['check-ref-format', '--branch', branchName]);
    } catch (error: unknown) {
      return {
        ok: false,
        currentBranch: null,
        error: toExecErrorMessage(error, 'Invalid branch name.'),
      };
    }

    try {
      try {
        await runGit(workspacePath, ['switch', '-c', branchName]);
      } catch {
        await runGit(workspacePath, ['checkout', '-b', branchName]);
      }

      const status = await this.readGitStatus(workspacePath);
      return {
        ok: true,
        currentBranch: status.currentBranch,
        error: null,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        currentBranch: null,
        error: toExecErrorMessage(error, `Failed to create branch "${branchName}".`),
      };
    }
  }

  public async commit(
    request: WorkspaceGitCommitRequest,
  ): Promise<WorkspaceGitMutationResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const message = normalizeCommitMessage(request.message);
    const filePaths = Array.from(
      new Set(
        request.filePaths
          .map((filePath) => filePath.trim())
          .filter((filePath) => filePath.length > 0)
          .map((filePath) => toWorkspaceRelativePath(workspacePath, filePath)),
      ),
    );

    if (!message) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Commit message is required.',
      };
    }

    if (filePaths.length === 0) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Select at least one file to commit.',
      };
    }

    const repositoryAvailable = await hasGitRepository(workspacePath);
    if (!repositoryAvailable) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Current project is not a git repository.',
      };
    }

    try {
      await runGit(workspacePath, ['add', '--', ...filePaths]);
      await runGit(workspacePath, ['commit', '-m', message, '--', ...filePaths]);

      const status = await this.readGitStatus(workspacePath);
      return {
        ok: true,
        currentBranch: status.currentBranch,
        error: null,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        currentBranch: null,
        error: toExecErrorMessage(error, 'Failed to commit selected changes.'),
      };
    }
  }

  public async push(
    request: WorkspaceGitPushRequest,
  ): Promise<WorkspaceGitMutationResult> {
    const workspacePath = path.resolve(request.workspacePath);

    const repositoryAvailable = await hasGitRepository(workspacePath);
    if (!repositoryAvailable) {
      return {
        ok: false,
        currentBranch: null,
        error: 'Current project is not a git repository.',
      };
    }

    try {
      await runGit(workspacePath, ['push']);

      const status = await this.readGitStatus(workspacePath);
      return {
        ok: true,
        currentBranch: status.currentBranch,
        error: null,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        currentBranch: null,
        error: toExecErrorMessage(error, 'Failed to push current branch.'),
      };
    }
  }

  public async revealFile(
    request: WorkspaceRevealFileRequest,
  ): Promise<WorkspaceRevealFileResult> {
    const targetPath = path.resolve(request.absolutePath);

    shell.showItemInFolder(targetPath);

    return {
      opened: true,
    };
  }
}
