import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WorkspaceDiffFileRequest,
  WorkspaceDiffFileResult,
  WorkspaceGitCheckoutBranchRequest,
  WorkspaceGitCreateBranchRequest,
  WorkspaceGitMutationResult,
  WorkspaceGitStatusRequest,
  WorkspaceGitStatusResult,
  WorkspaceListFilesRequest,
  WorkspaceListFilesResult,
  WorkspaceReadFileRequest,
  WorkspaceReadFileResult,
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

const parseNumstatOutput = (output: string): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    const [addedRaw, deletedRaw] = line.split('\t');

    const added = Number.parseInt(addedRaw ?? '', 10);
    const deleted = Number.parseInt(deletedRaw ?? '', 10);

    if (Number.isFinite(added)) {
      additions += added;
    }

    if (Number.isFinite(deleted)) {
      deletions += deleted;
    }
  }

  return { additions, deletions };
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

  public async diffFile(
    request: WorkspaceDiffFileRequest,
  ): Promise<WorkspaceDiffFileResult> {
    const workspacePath = path.resolve(request.workspacePath);
    const absolutePath = normalizePseudoWorkspacePath(workspacePath, request.filePath);

    ensureInsideWorkspace(workspacePath, absolutePath);

    const relativePath = path.relative(workspacePath, absolutePath);

    try {
      const { stdout } = await execFileAsync('git', [
        '-C',
        workspacePath,
        'diff',
        '--',
        relativePath,
      ]);

      return {
        patch: stdout,
        hasDiff: stdout.trim().length > 0,
      };
    } catch {
      return {
        patch: '',
        hasDiff: false,
      };
    }
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

    const { additions, deletions } = parseNumstatOutput(numstatOutput);

    return {
      available: true,
      currentBranch: currentBranch || null,
      branches,
      localBranches,
      remoteBranches,
      uncommittedFiles: getStatusLineCount(statusOutput),
      additions,
      deletions,
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
