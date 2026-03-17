export interface WorkspaceListFilesRequest {
  workspacePath: string;
}

export interface WorkspaceListFilesResult {
  files: string[];
}

export interface WorkspaceReadFileRequest {
  workspacePath: string;
  filePath: string;
}

export interface WorkspaceReadFileResult {
  absolutePath: string;
  relativePath: string;
  content: string;
}

export interface WorkspaceDiffFileRequest {
  workspacePath: string;
  filePath: string;
}

export interface WorkspaceDiffFileResult {
  patch: string;
  hasDiff: boolean;
}

export interface WorkspaceRevealFileRequest {
  absolutePath: string;
}

export interface WorkspaceRevealFileResult {
  opened: boolean;
}

export interface WorkspaceGitStatusRequest {
  workspacePath: string;
}

export interface WorkspaceGitStatusResult {
  available: boolean;
  currentBranch: string | null;
  branches: string[];
  localBranches: string[];
  remoteBranches: string[];
  uncommittedFiles: number;
  additions: number;
  deletions: number;
}

export interface WorkspaceGitCheckoutBranchRequest {
  workspacePath: string;
  branchName: string;
}

export interface WorkspaceGitCreateBranchRequest {
  workspacePath: string;
  branchName: string;
}

export interface WorkspaceGitMutationResult {
  ok: boolean;
  currentBranch: string | null;
  error: string | null;
}
