import * as React from 'react';

export interface ReviewFileState {
  id: string;
  kind: 'file' | 'diff';
  absolutePath: string;
  relativePath: string;
  content: string;
  originalContent: string | null;
  modifiedContent: string | null;
  patch: string | null;
}

interface UseWorkspaceReviewResult {
  isFileTreeOpen: boolean;
  isReviewPanelOpen: boolean;
  isReviewPanelVisible: boolean;
  isLoadingTree: boolean;
  isLoadingFile: boolean;
  files: string[];
  reviewFiles: ReviewFileState[];
  activeReviewFile: ReviewFileState | null;
  activeReviewFilePath: string | null;
  openFileTree: () => Promise<void>;
  closeFileTree: () => void;
  closeReviewPanel: () => void;
  toggleReviewPanelVisibility: () => void;
  openFile: (path: string) => Promise<void>;
  openDiff: (path: string) => Promise<void>;
  setActiveReviewFile: (path: string) => void;
  closeReviewFile: (path: string) => void;
  reorderReviewFiles: (sourcePath: string, targetPath: string) => void;
  revealReviewFile: () => Promise<void>;
  refreshReviewFile: () => Promise<void>;
}

const mapPathToWorkspace = (workspacePath: string, filePath: string): string => {
  if (filePath.startsWith('/workspace/')) {
    return filePath.replace('/workspace/', '');
  }

  return filePath;
};

const getReviewTabId = (kind: ReviewFileState['kind'], relativePath: string): string =>
  `${kind}:${relativePath}`;

const upsertReviewFile = (
  previous: ReviewFileState[],
  next: ReviewFileState,
): ReviewFileState[] => {
  const index = previous.findIndex((file) => file.id === next.id);

  if (index < 0) {
    return [...previous, next];
  }

  const updated = [...previous];
  updated[index] = next;
  return updated;
};

export const useWorkspaceReview = (
  workspacePath: string,
): UseWorkspaceReviewResult => {
  const [isFileTreeOpen, setIsFileTreeOpen] = React.useState(false);
  const [isLoadingTree, setIsLoadingTree] = React.useState(false);
  const [isLoadingFile, setIsLoadingFile] = React.useState(false);
  const [files, setFiles] = React.useState<string[]>([]);
  const [reviewFiles, setReviewFiles] = React.useState<ReviewFileState[]>([]);
  const [isReviewPanelVisible, setIsReviewPanelVisible] = React.useState(true);
  const [activeReviewFilePath, setActiveReviewFilePath] = React.useState<string | null>(null);

  const activeReviewFile = React.useMemo(() => {
    if (!activeReviewFilePath) {
      return reviewFiles.at(-1) ?? null;
    }

    return (
      reviewFiles.find((file) => file.id === activeReviewFilePath) ??
      reviewFiles.at(-1) ??
      null
    );
  }, [activeReviewFilePath, reviewFiles]);

  const isReviewPanelOpen = reviewFiles.length > 0 && isReviewPanelVisible;

  React.useEffect(() => {
    setFiles([]);
    setReviewFiles([]);
    setIsReviewPanelVisible(true);
    setActiveReviewFilePath(null);
  }, [workspacePath]);

  React.useEffect(() => {
    if (!isFileTreeOpen) {
      return;
    }

    void (async () => {
      if (!workspacePath || workspacePath === '/') {
        setFiles([]);
        return;
      }

      setIsLoadingTree(true);

      try {
        const result = await window.desktop.workspaceListFiles({ workspacePath });
        setFiles(result.files);
      } catch {
        setFiles([]);
      } finally {
        setIsLoadingTree(false);
      }
    })();
  }, [isFileTreeOpen, workspacePath]);

  const loadFileTree = React.useCallback(async (): Promise<void> => {
    if (!workspacePath || workspacePath === '/') {
      setFiles([]);
      return;
    }

    setIsLoadingTree(true);

    try {
      const result = await window.desktop.workspaceListFiles({ workspacePath });
      setFiles(result.files);
    } catch {
      setFiles([]);
    } finally {
      setIsLoadingTree(false);
    }
  }, [workspacePath]);

  const openFileTree = React.useCallback(async (): Promise<void> => {
    setIsFileTreeOpen(true);

    if (files.length === 0) {
      await loadFileTree();
    }
  }, [files.length, loadFileTree]);

  const closeFileTree = React.useCallback(() => {
    setIsFileTreeOpen(false);
  }, []);

  const resolveReviewData = React.useCallback(
    async (filePath: string): Promise<ReviewFileState | null> => {
      if (!workspacePath || workspacePath === '/') {
        return null;
      }

      const resolvedPath = mapPathToWorkspace(workspacePath, filePath);

      const readResult = await window.desktop.workspaceReadFile({
        workspacePath,
        filePath: resolvedPath,
      });

      return {
        id: getReviewTabId('file', readResult.relativePath),
        kind: 'file',
        absolutePath: readResult.absolutePath,
        relativePath: readResult.relativePath,
        content: readResult.content,
        originalContent: null,
        modifiedContent: null,
        patch: null,
      };
    },
    [workspacePath],
  );

  const resolveDiffReviewData = React.useCallback(
    async (filePath: string): Promise<ReviewFileState | null> => {
      if (!workspacePath || workspacePath === '/') {
        return null;
      }

      const resolvedPath = mapPathToWorkspace(workspacePath, filePath);
      const diffResult = await window.desktop.workspaceDiffFile({
        workspacePath,
        filePath: resolvedPath,
      });

      return {
        id: getReviewTabId('diff', diffResult.relativePath),
        kind: 'diff',
        absolutePath: diffResult.absolutePath,
        relativePath: diffResult.relativePath,
        content: diffResult.modifiedContent,
        originalContent: diffResult.originalContent,
        modifiedContent: diffResult.modifiedContent,
        patch: diffResult.patch,
      };
    },
    [workspacePath],
  );

  const openFile = React.useCallback(
    async (filePath: string): Promise<void> => {
      setIsLoadingFile(true);

      try {
        const next = await resolveReviewData(filePath);

        if (next) {
          setIsReviewPanelVisible(true);
          setReviewFiles((previous) => upsertReviewFile(previous, next));
          setActiveReviewFilePath(next.id);
        }
      } finally {
        setIsLoadingFile(false);
      }
    },
    [resolveReviewData],
  );

  const openDiff = React.useCallback(
    async (filePath: string): Promise<void> => {
      setIsLoadingFile(true);

      try {
        const next = await resolveDiffReviewData(filePath);

        if (next) {
          setIsReviewPanelVisible(true);
          setReviewFiles((previous) => upsertReviewFile(previous, next));
          setActiveReviewFilePath(next.id);
        }
      } finally {
        setIsLoadingFile(false);
      }
    },
    [resolveDiffReviewData],
  );

  const closeReviewFile = React.useCallback((path: string) => {
    setReviewFiles((previous) => {
      const closingIndex = previous.findIndex((file) => file.id === path);
      if (closingIndex < 0) {
        return previous;
      }

      const next = previous.filter((file) => file.id !== path);

      setActiveReviewFilePath((current) => {
        if (current !== path) {
          return current;
        }

        const fallback = next[closingIndex] ?? next[closingIndex - 1] ?? null;
        return fallback?.id ?? null;
      });

      return next;
    });
  }, []);

  const closeReviewPanel = React.useCallback(() => {
    setReviewFiles([]);
    setIsReviewPanelVisible(true);
    setActiveReviewFilePath(null);
  }, []);

  const toggleReviewPanelVisibility = React.useCallback(() => {
    setIsReviewPanelVisible((previous) => !previous);
  }, []);

  const reorderReviewFiles = React.useCallback((sourcePath: string, targetPath: string) => {
    if (sourcePath === targetPath) {
      return;
    }

    setReviewFiles((previous) => {
      const sourceIndex = previous.findIndex((file) => file.id === sourcePath);
      const targetIndex = previous.findIndex((file) => file.id === targetPath);

      if (sourceIndex < 0 || targetIndex < 0) {
        return previous;
      }

      const next = [...previous];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  const setActiveReviewFile = React.useCallback((path: string) => {
    setActiveReviewFilePath(path);
  }, []);

  const revealReviewFile = React.useCallback(async (): Promise<void> => {
    if (!activeReviewFile) {
      return;
    }

    await window.desktop.workspaceRevealFile({
      absolutePath: activeReviewFile.absolutePath,
    });
  }, [activeReviewFile]);

  const refreshReviewFile = React.useCallback(async (): Promise<void> => {
    if (!activeReviewFile) {
      return;
    }

    setIsLoadingFile(true);

    try {
      const next =
        activeReviewFile.kind === 'diff'
          ? await resolveDiffReviewData(activeReviewFile.relativePath)
          : await resolveReviewData(activeReviewFile.relativePath);
      if (next) {
        setReviewFiles((previous) => upsertReviewFile(previous, next));
        setActiveReviewFilePath(next.id);
      }
    } finally {
      setIsLoadingFile(false);
    }
  }, [activeReviewFile, resolveDiffReviewData, resolveReviewData]);

  return {
    isFileTreeOpen,
    isReviewPanelOpen,
    isReviewPanelVisible,
    isLoadingTree,
    isLoadingFile,
    files,
    reviewFiles,
    activeReviewFile,
    activeReviewFilePath,
    openFileTree,
    closeFileTree,
    closeReviewPanel,
    toggleReviewPanelVisibility,
    openFile,
    openDiff,
    setActiveReviewFile,
    closeReviewFile,
    reorderReviewFiles,
    revealReviewFile,
    refreshReviewFile,
  };
};
