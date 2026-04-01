import type { AcpPromptAttachment } from '@shared/types/acp';

const ATTACHMENT_BOUNDARY_BEFORE_EXPRESSION = /[\s([{\n]/;
const ATTACHMENT_BOUNDARY_AFTER_EXPRESSION = /[\s.,!?;:)\]}\n]/;

export interface AttachmentQueryMatch {
  start: number;
  end: number;
  query: string;
}

export interface AttachmentMentionMatch {
  start: number;
  end: number;
  attachment: AcpPromptAttachment;
  label: string;
}

export interface WorkspaceFileSearchResult {
  relativePath: string;
  fileName: string;
  directoryPath: string;
  score: number;
}

export const getFileName = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.at(-1) ?? filePath;
};

export const normalizePath = (value: string): string =>
  value.replaceAll('\\', '/').replace(/\/+$/, '');

export const joinWorkspaceFilePath = (
  workspacePath: string,
  relativePath: string,
  platform: NodeJS.Platform,
): string => {
  const separator = platform === 'win32' ? '\\' : '/';
  const normalizedWorkspacePath = workspacePath.replace(/[\\/]+$/, '');
  const normalizedSegments = relativePath.split('/').filter(Boolean);

  if (!normalizedWorkspacePath) {
    return normalizedSegments.join(separator);
  }

  if (normalizedSegments.length === 0) {
    return normalizedWorkspacePath;
  }

  return `${normalizedWorkspacePath}${separator}${normalizedSegments.join(separator)}`;
};

export const toAttachmentMentionLabel = (attachment: AcpPromptAttachment): string => {
  if (attachment.displayPath?.trim()) {
    return attachment.displayPath.trim();
  }

  if (attachment.relativePath?.trim()) {
    return attachment.relativePath.trim();
  }

  return getFileName(attachment.absolutePath);
};

export const toAttachmentMentionToken = (attachment: AcpPromptAttachment): string =>
  `@${toAttachmentMentionLabel(attachment)}`;

const isBoundaryBefore = (value: string, index: number): boolean =>
  index <= 0 || ATTACHMENT_BOUNDARY_BEFORE_EXPRESSION.test(value.charAt(index - 1));

const isBoundaryAfter = (value: string, index: number): boolean =>
  index >= value.length || ATTACHMENT_BOUNDARY_AFTER_EXPRESSION.test(value.charAt(index));

const compareAttachmentLabelLength = (
  left: AttachmentMentionMatch,
  right: AttachmentMentionMatch,
): number => right.label.length - left.label.length;

const toAttachmentCandidates = (
  attachments: AcpPromptAttachment[],
): Array<{ attachment: AcpPromptAttachment; label: string; loweredLabel: string }> => {
  const byLabel = new Map<string, { attachment: AcpPromptAttachment; label: string; loweredLabel: string }>();

  for (const attachment of attachments) {
    const label = toAttachmentMentionLabel(attachment);
    const loweredLabel = label.toLowerCase();
    if (!label || byLabel.has(loweredLabel)) {
      continue;
    }

    byLabel.set(loweredLabel, {
      attachment,
      label,
      loweredLabel,
    });
  }

  return Array.from(byLabel.values()).sort((left, right) =>
    right.label.length - left.label.length,
  );
};

export const collectAttachmentMentionMatches = (
  value: string,
  attachments: AcpPromptAttachment[],
): AttachmentMentionMatch[] => {
  if (!value || attachments.length === 0) {
    return [];
  }

  const matches: AttachmentMentionMatch[] = [];
  const candidates = toAttachmentCandidates(attachments);
  let cursor = 0;

  while (cursor < value.length) {
    if (value.charAt(cursor) !== '@' || !isBoundaryBefore(value, cursor)) {
      cursor += 1;
      continue;
    }

    let matchedCandidate:
      | { attachment: AcpPromptAttachment; label: string; loweredLabel: string }
      | null = null;

    for (const candidate of candidates) {
      const end = cursor + candidate.label.length + 1;
      const nextSlice = value.slice(cursor + 1, end).toLowerCase();
      if (nextSlice !== candidate.loweredLabel || !isBoundaryAfter(value, end)) {
        continue;
      }

      matchedCandidate = candidate;
      break;
    }

    if (!matchedCandidate) {
      cursor += 1;
      continue;
    }

    const end = cursor + matchedCandidate.label.length + 1;
    matches.push({
      start: cursor,
      end,
      attachment: matchedCandidate.attachment,
      label: matchedCandidate.label,
    });
    cursor = end;
  }

  return matches.sort(compareAttachmentLabelLength).sort((left, right) => left.start - right.start);
};

export const collectMentionedAttachmentPaths = (
  value: string,
  attachments: AcpPromptAttachment[],
): Set<string> =>
  new Set(
    collectAttachmentMentionMatches(value, attachments).map(
      (match) => match.attachment.absolutePath,
    ),
  );

export const hasAttachmentMention = (
  value: string,
  attachment: AcpPromptAttachment,
): boolean => collectMentionedAttachmentPaths(value, [attachment]).size > 0;

export const getActiveAttachmentQuery = (
  value: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): AttachmentQueryMatch | null => {
  if (selectionStart !== selectionEnd || selectionStart < 0 || selectionStart > value.length) {
    return null;
  }

  let tokenStart = selectionStart;
  while (tokenStart > 0) {
    const previousCharacter = value.charAt(tokenStart - 1);
    if (/\s/.test(previousCharacter)) {
      break;
    }
    tokenStart -= 1;
  }

  if (value.charAt(tokenStart) !== '@' || !isBoundaryBefore(value, tokenStart)) {
    return null;
  }

  const token = value.slice(tokenStart, selectionStart);
  if (token.length === 0 || token.slice(1).includes('@')) {
    return null;
  }

  return {
    start: tokenStart,
    end: selectionStart,
    query: token.slice(1),
  };
};

export const insertAttachmentMentions = ({
  text,
  selectionStart,
  selectionEnd,
  attachments,
  replaceStart = selectionStart,
  replaceEnd = selectionEnd,
}: {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  attachments: AcpPromptAttachment[];
  replaceStart?: number;
  replaceEnd?: number;
}): {
  text: string;
  selectionStart: number;
  selectionEnd: number;
} => {
  const tokens = attachments
    .map((attachment) => toAttachmentMentionToken(attachment))
    .filter((token) => token.length > 1);
  if (tokens.length === 0) {
    return {
      text,
      selectionStart,
      selectionEnd,
    };
  }

  const prefix = text.slice(0, replaceStart);
  const suffix = text.slice(replaceEnd);
  const needsLeadingSpace =
    prefix.length > 0 && !ATTACHMENT_BOUNDARY_BEFORE_EXPRESSION.test(prefix.charAt(prefix.length - 1));
  const needsTrailingSpace =
    suffix.length === 0 || !ATTACHMENT_BOUNDARY_AFTER_EXPRESSION.test(suffix.charAt(0));
  const insertedText = `${needsLeadingSpace ? ' ' : ''}${tokens.join(' ')}${needsTrailingSpace ? ' ' : ''}`;
  const nextText = `${prefix}${insertedText}${suffix}`;
  const nextCursor = prefix.length + insertedText.length;

  return {
    text: nextText,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
};

const scoreWorkspaceFile = (relativePath: string, query: string): number => {
  const loweredPath = relativePath.toLowerCase();
  const loweredQuery = query.trim().toLowerCase();
  const fileName = getFileName(relativePath).toLowerCase();

  if (!loweredQuery) {
    return 100 - Math.min(80, relativePath.length);
  }

  let score = 0;

  if (fileName === loweredQuery) {
    score += 1_400;
  }
  if (loweredPath === loweredQuery) {
    score += 1_250;
  }

  if (fileName.startsWith(loweredQuery)) {
    score += 1_050;
  }
  if (loweredPath.startsWith(loweredQuery)) {
    score += 900;
  }

  const fileNameIndex = fileName.indexOf(loweredQuery);
  if (fileNameIndex >= 0) {
    score += 760 - Math.min(240, fileNameIndex * 14);
  }

  const pathSegmentIndex = loweredPath.indexOf(`/${loweredQuery}`);
  if (pathSegmentIndex >= 0) {
    score += 640 - Math.min(220, pathSegmentIndex * 6);
  }

  const pathIndex = loweredPath.indexOf(loweredQuery);
  if (pathIndex >= 0) {
    score += 540 - Math.min(240, pathIndex * 4);
  }

  const querySegments = loweredQuery.split(/[\\/.\s_-]+/).filter(Boolean);
  if (querySegments.length > 1) {
    let cursor = 0;
    let sequentialMatches = 0;

    for (const segment of querySegments) {
      const segmentIndex = loweredPath.indexOf(segment, cursor);
      if (segmentIndex < 0) {
        sequentialMatches = 0;
        break;
      }

      sequentialMatches += 1;
      cursor = segmentIndex + segment.length;
    }

    if (sequentialMatches === querySegments.length) {
      score += 380;
    }
  }

  return score;
};

export const searchWorkspaceFiles = (
  files: string[],
  query: string,
  limit = 8,
): WorkspaceFileSearchResult[] => {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const normalizedQuery = query.trim();

  return files
    .map((relativePath) => {
      const normalizedPath = relativePath.replaceAll('\\', '/');
      const fileName = getFileName(normalizedPath);
      const directoryPath = normalizedPath.includes('/')
        ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/'))
        : '';

      return {
        relativePath: normalizedPath,
        fileName,
        directoryPath,
        score: scoreWorkspaceFile(normalizedPath, normalizedQuery),
      };
    })
    .filter((entry) => normalizedQuery.length === 0 || entry.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      if (left.fileName !== right.fileName) {
        return left.fileName.localeCompare(right.fileName, undefined, {
          sensitivity: 'base',
          numeric: true,
        });
      }

      return left.relativePath.localeCompare(right.relativePath, undefined, {
        sensitivity: 'base',
        numeric: true,
      });
    })
    .slice(0, normalizedLimit);
};
