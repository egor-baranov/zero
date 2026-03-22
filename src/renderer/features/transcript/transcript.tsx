import * as React from 'react';
import {
  ArrowDown,
  Check,
  ChevronDown,
  FileText,
  Folder,
  FolderPlus,
  Lightbulb,
  ListChecks,
  MessageSquare,
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { coldarkCold, coldarkDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { AcpPermissionRequestEvent, AcpPromptAttachment } from '@shared/types/acp';
import type { TimelineItem } from '@renderer/store/use-acp';
import type { WorkspaceGitFileStat } from '@shared/types/workspace';
import { cn } from '@renderer/lib/cn';
import { toLanguagePresentation } from '@renderer/lib/code-language-icons';
import { InlineMonacoDiffEditor } from '@renderer/features/transcript/inline-monaco-diff-editor';
import zeroLogo from '@renderer/assets/zero-logo.png';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@renderer/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';

interface TranscriptProjectOption {
  id: string;
  name: string;
  path: string;
}

interface TranscriptProps {
  threadId: string;
  workspaceName: string;
  workspacePath: string;
  projects: TranscriptProjectOption[];
  selectedProjectId: string;
  timeline: TimelineItem[];
  isNewThread: boolean;
  isThinking: boolean;
  pendingPermission: AcpPermissionRequestEvent | null;
  onSelectProject: (workspaceId: string) => void;
  onAddProject: () => void;
  onResolvePermission: (requestId: string, optionId: string) => void;
  onOpenFile: (path: string) => void;
  onOpenLink: (url: string) => void;
  onSelectSuggestion: (value: string) => void;
}

type AssistantSegment =
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'code';
      language?: string;
      code: string;
    };

type MarkdownBlock =
  | {
      kind: 'heading';
      level: number;
      text: string;
    }
  | {
      kind: 'paragraph';
      text: string;
    }
  | {
      kind: 'ordered-list';
      items: string[];
    }
  | {
      kind: 'unordered-list';
      items: string[];
    };

interface ToolCallPresentation {
  shellLabel: string;
  commandLine: string | null;
  outputText: string | null;
  statusLabel: string;
  isSuccess: boolean;
}

type AssistantTimelineItem = Extract<TimelineItem, { kind: 'assistant-message' }>;

interface ChangedFileEntry {
  path: string;
  label: string;
  additions: number | null;
  deletions: number | null;
  toolKinds: string[];
  previewPatch: string | null;
}

interface InlineDiffPreviewState {
  isLoading: boolean;
  patch: string | null;
  error: string | null;
}

type TranscriptRenderBlock =
  | {
      kind: 'timeline-item';
      item: TimelineItem;
    }
  | {
      kind: 'assistant-turn';
      key: string;
      items: TimelineItem[];
      activities: TimelineItem[];
      finalMessage: AssistantTimelineItem | null;
      durationMs: number | null;
      changedFiles: ChangedFileEntry[];
      isComplete: boolean;
    };

interface RegistryAgentIconEntry {
  name: string;
  iconUrl: string;
}

const KNOWN_CODE_LANGUAGES = [
  'python',
  'py',
  'javascript',
  'js',
  'typescript',
  'ts',
  'bash',
  'sh',
  'json',
  'yaml',
  'yml',
  'html',
  'css',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
];

const SCROLL_TO_BOTTOM_THRESHOLD = 56;
const ACP_REGISTRY_URL =
  'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif',
]);

const toAttachmentLabel = (attachment: AcpPromptAttachment): string => {
  if (attachment.displayPath?.trim()) {
    return attachment.displayPath.trim();
  }

  if (attachment.relativePath?.trim()) {
    return attachment.relativePath.trim();
  }

  const normalizedPath = attachment.absolutePath.replaceAll('\\', '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  return segments.at(-1) ?? attachment.absolutePath;
};

const toAttachmentFileUrl = (absolutePath: string): string => {
  if (absolutePath.startsWith('file://')) {
    return absolutePath;
  }

  const normalizedPath = absolutePath.replaceAll('\\', '/');
  const prefixedPath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  return encodeURI(`file://${prefixedPath}`).replace(/#/g, '%23');
};

const isImageAttachment = (attachment: AcpPromptAttachment): boolean => {
  const mimeType = attachment.mimeType?.toLowerCase().trim() ?? '';
  if (mimeType.startsWith('image/')) {
    return true;
  }

  const label = toAttachmentLabel(attachment).toLowerCase();
  const extension = label.split('.').at(-1) ?? '';
  return IMAGE_ATTACHMENT_EXTENSIONS.has(extension);
};

const normalizeCodeLanguage = (language: string | undefined): string | undefined => {
  if (!language) {
    return undefined;
  }

  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'py') {
    return 'python';
  }
  if (normalized === 'js') {
    return 'javascript';
  }
  if (normalized === 'ts') {
    return 'typescript';
  }

  return normalized;
};

const syntaxHighlighterCustomStyle: React.CSSProperties = {
  margin: 0,
  padding: '0 12px 16px',
  background: 'transparent',
  fontSize: '12px',
  lineHeight: '1.65',
};

const syntaxHighlighterCodeTagStyle: React.CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
};

const linkExpression = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const boldExpression = /^\*\*([\s\S]+)\*\*$/;
const inlineCodeExpression = /^`([^`\n]+)`$/;
const inlineMarkdownTokenExpression =
  /(\*\*[\s\S]+?\*\*|`[^`\n]+`|\[[^\]]+\]\([^)\s]+\))/g;
const markdownHeadingExpression = /^(#{1,6})\s+(.*)$/;
const markdownOrderedListExpression = /^\d+\.\s+(.*)$/;
const markdownUnorderedListExpression = /^[-*+]\s+(.*)$/;

const renderInlineMarkdown = (
  text: string,
  keyPrefix: string,
  onOpenLink: (url: string) => void,
): Array<string | JSX.Element> => {
  const result: Array<string | JSX.Element> = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(inlineMarkdownTokenExpression)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      result.push(text.slice(cursor, start));
    }

    const linkMatch = token.match(linkExpression);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      result.push(
        <a
          key={`${keyPrefix}-link-${tokenIndex}`}
          href={href}
          className="underline decoration-stone-400 underline-offset-2 transition-colors hover:text-stone-900"
          onClick={(event) => {
            event.preventDefault();
            onOpenLink(href);
          }}
        >
          {label}
        </a>,
      );
      cursor = start + token.length;
      tokenIndex += 1;
      continue;
    }

    const boldMatch = token.match(boldExpression);
    if (boldMatch) {
      result.push(
        <strong key={`${keyPrefix}-bold-${tokenIndex}`} className="font-semibold text-stone-900">
          {boldMatch[1]}
        </strong>,
      );
      cursor = start + token.length;
      tokenIndex += 1;
      continue;
    }

    const inlineCodeMatch = token.match(inlineCodeExpression);
    if (inlineCodeMatch) {
      result.push(
        <code
          key={`${keyPrefix}-code-${tokenIndex}`}
          className="rounded bg-stone-200/75 px-1 py-0.5 font-mono text-[0.9em] text-stone-800"
        >
          {inlineCodeMatch[1]}
        </code>,
      );
      cursor = start + token.length;
      tokenIndex += 1;
      continue;
    }

    result.push(token);
    cursor = start + token.length;
    tokenIndex += 1;
  }

  if (cursor < text.length) {
    result.push(text.slice(cursor));
  }

  return result;
};

const parseMarkdownBlocks = (value: string): MarkdownBlock[] => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      index += 1;
      continue;
    }

    const headingMatch = trimmedLine.match(markdownHeadingExpression);
    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    const orderedItems: string[] = [];
    while (index < lines.length) {
      const orderedMatch = lines[index].trim().match(markdownOrderedListExpression);
      if (!orderedMatch) {
        break;
      }

      orderedItems.push(orderedMatch[1].trim());
      index += 1;
    }
    if (orderedItems.length > 0) {
      blocks.push({
        kind: 'ordered-list',
        items: orderedItems,
      });
      continue;
    }

    const unorderedItems: string[] = [];
    while (index < lines.length) {
      const unorderedMatch = lines[index].trim().match(markdownUnorderedListExpression);
      if (!unorderedMatch) {
        break;
      }

      unorderedItems.push(unorderedMatch[1].trim());
      index += 1;
    }
    if (unorderedItems.length > 0) {
      blocks.push({
        kind: 'unordered-list',
        items: unorderedItems,
      });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const nextLine = lines[index];
      const nextTrimmedLine = nextLine.trim();
      if (!nextTrimmedLine) {
        break;
      }

      if (
        markdownHeadingExpression.test(nextTrimmedLine) ||
        markdownOrderedListExpression.test(nextTrimmedLine) ||
        markdownUnorderedListExpression.test(nextTrimmedLine)
      ) {
        break;
      }

      paragraphLines.push(nextLine.trimEnd());
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        kind: 'paragraph',
        text: paragraphLines.join('\n'),
      });
      continue;
    }

    index += 1;
  }

  if (blocks.length === 0 && value.trim().length > 0) {
    return [
      {
        kind: 'paragraph',
        text: value.trim(),
      },
    ];
  }

  return blocks;
};

const parseRawPayload = (value: string | undefined): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const findCommandLine = (
  inputPayload: Record<string, unknown> | null,
  outputPayload: Record<string, unknown> | null,
): string | null => {
  const candidates = [outputPayload, inputPayload];

  for (const payload of candidates) {
    if (!payload) {
      continue;
    }

    const parsedCmd = payload.parsed_cmd;
    if (Array.isArray(parsedCmd) && parsedCmd.length > 0) {
      const first = parsedCmd[0];
      if (typeof first === 'object' && first !== null && 'cmd' in first && typeof first.cmd === 'string') {
        return first.cmd;
      }
    }

    const command = payload.command;
    if (typeof command === 'string' && command.trim().length > 0) {
      return command;
    }

    if (Array.isArray(command)) {
      const parts = command.filter((entry): entry is string => typeof entry === 'string');
      if (parts.length === 3 && parts[1] === '-lc') {
        return parts[2];
      }
      if (parts.length > 0) {
        return parts.join(' ');
      }
    }
  }

  return null;
};

const findOutputText = (
  outputPayload: Record<string, unknown> | null,
  rawOutput: string | undefined,
): string | null => {
  if (!outputPayload) {
    return rawOutput?.trim() ? rawOutput : null;
  }

  const formatted = outputPayload.formatted_output;
  if (typeof formatted === 'string' && formatted.trim().length > 0) {
    return formatted;
  }

  const aggregated = outputPayload.aggregated_output;
  if (typeof aggregated === 'string' && aggregated.trim().length > 0) {
    return aggregated;
  }

  const stdout = typeof outputPayload.stdout === 'string' ? outputPayload.stdout : '';
  const stderr = typeof outputPayload.stderr === 'string' ? outputPayload.stderr : '';
  const combined = [stdout, stderr].filter((entry) => entry.trim().length > 0).join('\n');
  if (combined.trim().length > 0) {
    return combined;
  }

  return rawOutput?.trim() ? rawOutput : null;
};

const toStatusPresentation = (
  toolCall: TimelineItem & { kind: 'tool-call' },
  outputPayload: Record<string, unknown> | null,
): { statusLabel: string; isSuccess: boolean } => {
  if (toolCall.status === 'in_progress') {
    return { statusLabel: 'Running', isSuccess: false };
  }

  if (toolCall.status === 'completed') {
    const exitCode = typeof outputPayload?.exit_code === 'number' ? outputPayload.exit_code : null;
    if (exitCode === 0) {
      return { statusLabel: 'Success', isSuccess: true };
    }
    if (typeof exitCode === 'number') {
      return { statusLabel: `Failed (${exitCode})`, isSuccess: false };
    }

    const success = outputPayload?.success;
    if (success === true) {
      return { statusLabel: 'Success', isSuccess: true };
    }
    if (success === false) {
      return { statusLabel: 'Failed', isSuccess: false };
    }

    return { statusLabel: 'Completed', isSuccess: true };
  }

  if (toolCall.status === 'cancelled') {
    return { statusLabel: 'Cancelled', isSuccess: false };
  }

  if (toolCall.status === 'failed') {
    return { statusLabel: 'Failed', isSuccess: false };
  }

  return { statusLabel: String(toolCall.status), isSuccess: false };
};

const buildToolCallPresentation = (
  item: TimelineItem & { kind: 'tool-call' },
): ToolCallPresentation => {
  const inputPayload = parseRawPayload(item.rawInput);
  const outputPayload = parseRawPayload(item.rawOutput);
  const commandLine = findCommandLine(inputPayload, outputPayload);
  const outputText = findOutputText(outputPayload, item.rawOutput);
  const statusPresentation = toStatusPresentation(item, outputPayload);

  return {
    shellLabel: 'bash',
    commandLine,
    outputText,
    statusLabel: statusPresentation.statusLabel,
    isSuccess: statusPresentation.isSuccess,
  };
};

const MarkdownText = ({
  text,
  className,
  keyPrefix,
  onOpenLink,
}: {
  text: string;
  className?: string;
  keyPrefix: string;
  onOpenLink: (url: string) => void;
}): JSX.Element => {
  const blocks = React.useMemo(() => parseMarkdownBlocks(text), [text]);

  const renderHeading = (level: number, value: string, key: string): JSX.Element => {
    const headingContent = renderInlineMarkdown(value, key, onOpenLink);
    if (level === 1) {
      return (
        <h1 key={key} className="text-[1.3em] font-semibold leading-8 text-stone-900">
          {headingContent}
        </h1>
      );
    }
    if (level === 2) {
      return (
        <h2 key={key} className="text-[1.18em] font-semibold leading-8 text-stone-900">
          {headingContent}
        </h2>
      );
    }
    if (level === 3) {
      return (
        <h3 key={key} className="text-[1.08em] font-semibold leading-7 text-stone-900">
          {headingContent}
        </h3>
      );
    }
    if (level === 4) {
      return (
        <h4 key={key} className="text-[1em] font-semibold leading-7 text-stone-900">
          {headingContent}
        </h4>
      );
    }
    if (level === 5) {
      return (
        <h5 key={key} className="text-[0.95em] font-semibold leading-6 text-stone-900">
          {headingContent}
        </h5>
      );
    }

    return (
      <h6 key={key} className="text-[0.9em] font-semibold leading-6 text-stone-900">
        {headingContent}
      </h6>
    );
  };

  return (
    <div className={cn('space-y-2', className)}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return renderHeading(block.level, block.text, `${keyPrefix}-heading-${index}`);
        }

        if (block.kind === 'ordered-list') {
          return (
            <ol key={`${keyPrefix}-ordered-${index}`} className="list-decimal space-y-1 pl-6">
              {block.items.map((item, itemIndex) => (
                <li key={`${keyPrefix}-ordered-item-${index}-${itemIndex}`} className="leading-7">
                  {renderInlineMarkdown(item, `${keyPrefix}-ordered-inline-${index}-${itemIndex}`, onOpenLink)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.kind === 'unordered-list') {
          return (
            <ul key={`${keyPrefix}-unordered-${index}`} className="list-disc space-y-1 pl-6">
              {block.items.map((item, itemIndex) => (
                <li key={`${keyPrefix}-unordered-item-${index}-${itemIndex}`} className="leading-7">
                  {renderInlineMarkdown(item, `${keyPrefix}-unordered-inline-${index}-${itemIndex}`, onOpenLink)}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`${keyPrefix}-paragraph-${index}`} className="whitespace-pre-wrap">
            {renderInlineMarkdown(block.text, `${keyPrefix}-paragraph-inline-${index}`, onOpenLink)}
          </p>
        );
      })}
    </div>
  );
};

const parseFenceHeader = (
  rawHeader: string,
): { language?: string; headerRemainder: string } => {
  let language: string | undefined;
  let headerRemainder = '';

  if (rawHeader.length === 0) {
    return { language, headerRemainder };
  }

  const loweredHeader = rawHeader.toLowerCase();
  const matchedKnownLanguage = KNOWN_CODE_LANGUAGES.find((entry) =>
    loweredHeader.startsWith(entry),
  );

  if (matchedKnownLanguage) {
    language = matchedKnownLanguage;
    headerRemainder = rawHeader.slice(matchedKnownLanguage.length).trimStart();
    return { language, headerRemainder };
  }

  if (rawHeader.length > 24 || rawHeader.includes(' ')) {
    headerRemainder = rawHeader;
    return { language, headerRemainder };
  }

  language = rawHeader;
  return { language, headerRemainder };
};

const parseAssistantSegments = (content: string): AssistantSegment[] => {
  const segments: AssistantSegment[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const fenceStart = content.indexOf('```', cursor);
    if (fenceStart === -1) {
      segments.push({
        kind: 'text',
        text: content.slice(cursor),
      });
      break;
    }

    if (fenceStart > cursor) {
      segments.push({
        kind: 'text',
        text: content.slice(cursor, fenceStart),
      });
    }

    const headerStart = fenceStart + 3;
    const headerEnd = content.indexOf('\n', headerStart);
    if (headerEnd === -1) {
      const { language, headerRemainder } = parseFenceHeader(
        content.slice(headerStart).trim(),
      );
      segments.push({
        kind: 'code',
        language: normalizeCodeLanguage(language),
        code: headerRemainder ? `${headerRemainder}\n` : '',
      });
      cursor = content.length;
      break;
    }

    const rawHeader = content.slice(headerStart, headerEnd).trim();
    const { language, headerRemainder } = parseFenceHeader(rawHeader);

    const fenceEnd = content.indexOf('```', headerEnd + 1);
    const codeBody =
      fenceEnd === -1
        ? content.slice(headerEnd + 1)
        : content.slice(headerEnd + 1, fenceEnd);
    const normalizedLanguage = normalizeCodeLanguage(language);
    const code = headerRemainder
      ? `${headerRemainder}\n${codeBody}`
      : codeBody;

    segments.push({
      kind: 'code',
      language: normalizedLanguage,
      code,
    });

    if (fenceEnd === -1) {
      cursor = content.length;
      break;
    }

    cursor = fenceEnd + 3;
  }

  if (segments.length === 0) {
    return [{ kind: 'text', text: content }];
  }

  return segments;
};

const normalizeAssistantTextSegment = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const AGENT_CHANGED_MESSAGE_PREFIX = 'agent changed to ';

const isAgentChangedNotice = (value: string): boolean =>
  value.trim().toLowerCase().startsWith(AGENT_CHANGED_MESSAGE_PREFIX);

const parseAgentChangedLabel = (value: string): string | null => {
  const trimmed = value.trim().replace(/[.]+$/, '');
  const lowered = trimmed.toLowerCase();
  if (!lowered.startsWith(AGENT_CHANGED_MESSAGE_PREFIX)) {
    return null;
  }

  const label = trimmed.slice(AGENT_CHANGED_MESSAGE_PREFIX.length).trim();
  return label.length > 0 ? label : null;
};

const isFinalAssistantMessage = (item: TimelineItem): item is AssistantTimelineItem =>
  item.kind === 'assistant-message' &&
  item.noticeKind !== 'agent-change' &&
  !isAgentChangedNotice(item.text);

const normalizeLocationLabel = (path: string): string => {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/workspace/')) {
    return normalized.slice('/workspace/'.length);
  }

  return normalized;
};

const toNormalizedPathKey = (value: string): string =>
  value.replaceAll('\\', '/').replace(/^\/+/, '');

const normalizeFileSystemPath = (value: string): string =>
  value.replaceAll('\\', '/').replace(/\/+$/, '');

const isAbsoluteFileSystemPath = (value: string): boolean => {
  const normalized = normalizeFileSystemPath(value);
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
};

const isPathWithinRoot = (value: string, root: string): boolean => {
  const normalizedValue = normalizeFileSystemPath(value);
  const normalizedRoot = normalizeFileSystemPath(root);
  if (!normalizedRoot) {
    return false;
  }

  return (
    normalizedValue === normalizedRoot ||
    normalizedValue.startsWith(`${normalizedRoot}/`)
  );
};

const getContainingDirectoryPath = (value: string): string => {
  const normalized = normalizeFileSystemPath(value);
  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return normalized;
  }

  return normalized.slice(0, lastSlashIndex);
};

const resolveWorkspacePathCandidatesForFile = (
  filePath: string,
  workspacePath: string,
  projectPaths: string[],
): string[] => {
  const seen = new Set<string>();
  const pushCandidate = (value: string, candidates: string[]): void => {
    const normalizedValue = normalizeFileSystemPath(value);
    if (!normalizedValue || seen.has(normalizedValue)) {
      return;
    }

    seen.add(normalizedValue);
    candidates.push(normalizedValue);
  };

  const candidates: string[] = [];
  const normalizedRoots = [workspacePath, ...projectPaths]
    .map((entry) => normalizeFileSystemPath(entry))
    .filter((entry) => entry.length > 0)
    .sort((left, right) => right.length - left.length);

  if (!isAbsoluteFileSystemPath(filePath)) {
    for (const entry of normalizedRoots) {
      pushCandidate(entry, candidates);
    }
    return candidates;
  }

  for (const entry of normalizedRoots) {
    if (isPathWithinRoot(filePath, entry)) {
      pushCandidate(entry, candidates);
    }
  }

  pushCandidate(getContainingDirectoryPath(filePath), candidates);

  return candidates;
};

const countTextLines = (value: string): number => {
  const normalized = value.replace(/\r\n?/g, '\n');
  if (normalized.length === 0) {
    return 0;
  }

  return normalized.endsWith('\n')
    ? normalized.split('\n').length - 1
    : normalized.split('\n').length;
};

const toTextLines = (value: string): string[] => {
  const normalized = value.replace(/\r\n?/g, '\n');
  if (normalized.length === 0) {
    return [];
  }

  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) {
    lines.pop();
  }

  return lines;
};

const buildSyntheticAddedFilePatch = (fileLabel: string, content: string): string => {
  const lines = toTextLines(content);
  const header = [
    `diff --git a/${fileLabel} b/${fileLabel}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${fileLabel}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ];

  if (lines.length === 0) {
    return header.join('\n');
  }

  return [...header, ...lines.map((line) => `+${line}`)].join('\n');
};

const buildSyntheticReplacementPatch = (
  fileLabel: string,
  previousValue: string,
  nextValue: string,
): string => {
  const previousLines = toTextLines(previousValue);
  const nextLines = toTextLines(nextValue);
  const header = [
    `diff --git a/${fileLabel} b/${fileLabel}`,
    `--- a/${fileLabel}`,
    `+++ b/${fileLabel}`,
    `@@ -1,${previousLines.length} +1,${nextLines.length} @@`,
  ];

  return [
    ...header,
    ...previousLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`),
  ].join('\n');
};

const CHANGE_STATS_PATH_KEYS = [
  'path',
  'filePath',
  'file_path',
  'absolutePath',
  'absolute_path',
  'targetPath',
  'target_path',
];
const CHANGE_STATS_PATCH_KEYS = ['patch', 'diff'];
const CHANGE_STATS_CONTENT_KEYS = [
  'content',
  'text',
  'value',
  'new_string',
  'newString',
  'new_text',
  'newText',
  'new_content',
  'newContent',
  'replacement',
  'replacement_text',
  'body',
];
const CHANGE_STATS_STRING_PAIRS: Array<[string, string]> = [
  ['old_string', 'new_string'],
  ['oldString', 'newString'],
  ['old_text', 'new_text'],
  ['oldText', 'newText'],
  ['old_content', 'new_content'],
  ['oldContent', 'newContent'],
  ['before', 'after'],
  ['previous', 'updated'],
];

const isStructuredPayload = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const matchesPayloadLocation = (candidatePath: string, locationPath: string): boolean => {
  const normalizedCandidate = toNormalizedPathKey(normalizeLocationLabel(candidatePath));
  const normalizedLocation = toNormalizedPathKey(normalizeLocationLabel(locationPath));

  return (
    normalizedCandidate === normalizedLocation ||
    normalizedCandidate.endsWith(`/${normalizedLocation}`) ||
    normalizedLocation.endsWith(`/${normalizedCandidate}`)
  );
};

const mergeChangeStats = (
  values: Array<{ additions: number; deletions: number } | null>,
): { additions: number; deletions: number } | null => {
  const concreteValues = values.filter(
    (value): value is { additions: number; deletions: number } => value !== null,
  );
  if (concreteValues.length === 0) {
    return null;
  }

  return concreteValues.reduce(
    (sum, value) => ({
      additions: sum.additions + value.additions,
      deletions: sum.deletions + value.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
};

const isWriteLikeToolKind = (toolKind: string): boolean => {
  const normalizedToolKind = toolKind.trim().toLowerCase();
  return normalizedToolKind.includes('write') || normalizedToolKind.includes('create');
};

const looksLikePatchText = (value: string): boolean =>
  value.includes('*** Begin Patch') ||
  value.includes('diff --git') ||
  value.includes('\n@@') ||
  /\n[+-][^\n]/.test(value);

const deriveChangeStatsFromPayload = (
  value: unknown,
  locationPath: string,
  toolKind: string,
): { additions: number; deletions: number } | null => {
  if (Array.isArray(value)) {
    return mergeChangeStats(
      value.map((entry) => deriveChangeStatsFromPayload(entry, locationPath, toolKind)),
    );
  }

  if (!isStructuredPayload(value)) {
    return null;
  }

  const scopedPathCandidate = CHANGE_STATS_PATH_KEYS.find(
    (key) => typeof value[key] === 'string',
  );
  if (
    scopedPathCandidate &&
    typeof value[scopedPathCandidate] === 'string' &&
    !matchesPayloadLocation(value[scopedPathCandidate] as string, locationPath)
  ) {
    return null;
  }

  for (const [oldKey, newKey] of CHANGE_STATS_STRING_PAIRS) {
    if (typeof value[oldKey] === 'string' && typeof value[newKey] === 'string') {
      return {
        additions: countTextLines(value[newKey] as string),
        deletions: countTextLines(value[oldKey] as string),
      };
    }
  }

  for (const key of CHANGE_STATS_PATCH_KEYS) {
    if (typeof value[key] === 'string' && looksLikePatchText(value[key] as string)) {
      return parsePatchChangeCounts(value[key] as string);
    }
  }

  if (isWriteLikeToolKind(toolKind)) {
    for (const key of CHANGE_STATS_CONTENT_KEYS) {
      if (typeof value[key] === 'string' && (value[key] as string).trim().length > 0) {
        return {
          additions: countTextLines(value[key] as string),
          deletions: 0,
        };
      }
    }
  }

  return mergeChangeStats(
    Object.values(value).map((entry) => deriveChangeStatsFromPayload(entry, locationPath, toolKind)),
  );
};

const deriveChangePreviewFromPayload = (
  value: unknown,
  locationPath: string,
  toolKind: string,
): string | null => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const preview = deriveChangePreviewFromPayload(entry, locationPath, toolKind);
      if (preview) {
        return preview;
      }
    }
    return null;
  }

  if (!isStructuredPayload(value)) {
    return null;
  }

  const scopedPathCandidate = CHANGE_STATS_PATH_KEYS.find(
    (key) => typeof value[key] === 'string',
  );
  if (
    scopedPathCandidate &&
    typeof value[scopedPathCandidate] === 'string' &&
    !matchesPayloadLocation(value[scopedPathCandidate] as string, locationPath)
  ) {
    return null;
  }

  const fileLabel = normalizeLocationLabel(locationPath);

  for (const [oldKey, newKey] of CHANGE_STATS_STRING_PAIRS) {
    if (typeof value[oldKey] === 'string' && typeof value[newKey] === 'string') {
      return buildSyntheticReplacementPatch(
        fileLabel,
        value[oldKey] as string,
        value[newKey] as string,
      );
    }
  }

  for (const key of CHANGE_STATS_PATCH_KEYS) {
    if (typeof value[key] === 'string' && looksLikePatchText(value[key] as string)) {
      return value[key] as string;
    }
  }

  if (isWriteLikeToolKind(toolKind)) {
    for (const key of CHANGE_STATS_CONTENT_KEYS) {
      if (typeof value[key] === 'string' && (value[key] as string).trim().length > 0) {
        return buildSyntheticAddedFilePatch(fileLabel, value[key] as string);
      }
    }
  }

  for (const entry of Object.values(value)) {
    const preview = deriveChangePreviewFromPayload(entry, locationPath, toolKind);
    if (preview) {
      return preview;
    }
  }

  return null;
};

const deriveToolCallChangeStats = (
  item: Extract<TimelineItem, { kind: 'tool-call' }>,
  locationPath: string,
): { additions: number; deletions: number } | null => {
  const inputPayload = parseRawPayload(item.rawInput);
  const outputPayload = parseRawPayload(item.rawOutput);

  return (
    deriveChangeStatsFromPayload(inputPayload, locationPath, item.toolKind) ??
    deriveChangeStatsFromPayload(outputPayload, locationPath, item.toolKind)
  );
};

const deriveToolCallPreviewPatch = (
  item: Extract<TimelineItem, { kind: 'tool-call' }>,
  locationPath: string,
): string | null => {
  const inputPayload = parseRawPayload(item.rawInput);
  const outputPayload = parseRawPayload(item.rawOutput);

  return (
    deriveChangePreviewFromPayload(inputPayload, locationPath, item.toolKind) ??
    deriveChangePreviewFromPayload(outputPayload, locationPath, item.toolKind)
  );
};

const FILE_MUTATION_TOOL_KIND_TOKENS = [
  'edit',
  'write',
  'create',
  'delete',
  'rename',
  'move',
  'patch',
  'replace',
];

const isFileMutationToolCall = (item: TimelineItem): item is Extract<TimelineItem, { kind: 'tool-call' }> => {
  if (item.kind !== 'tool-call' || item.locations.length === 0) {
    return false;
  }

  const normalizedToolKind = item.toolKind.trim().toLowerCase();
  return FILE_MUTATION_TOOL_KIND_TOKENS.some((token) => normalizedToolKind.includes(token));
};

const collectChangedFiles = (
  items: TimelineItem[],
  gitFileStatsByPath: Record<string, WorkspaceGitFileStat>,
): ChangedFileEntry[] => {
  const fileMap = new Map<string, ChangedFileEntry>();

  for (const item of items) {
    if (!isFileMutationToolCall(item)) {
      continue;
    }

    for (const locationPath of item.locations) {
      if (!locationPath) {
        continue;
      }

      const normalizedPathKey = toNormalizedPathKey(normalizeLocationLabel(locationPath));
      const gitFileStat = gitFileStatsByPath[normalizedPathKey];
      const derivedStats = deriveToolCallChangeStats(item, locationPath);
      const derivedPreviewPatch = deriveToolCallPreviewPatch(item, locationPath);
      const existing = fileMap.get(locationPath);

      if (existing) {
        if (!existing.toolKinds.includes(item.toolKind)) {
          existing.toolKinds.push(item.toolKind);
        }
        if (!existing.previewPatch && derivedPreviewPatch) {
          existing.previewPatch = derivedPreviewPatch;
        }

        if (gitFileStat) {
          existing.additions = gitFileStat.additions;
          existing.deletions = gitFileStat.deletions;
          continue;
        }

        if (derivedStats) {
          existing.additions = (existing.additions ?? 0) + derivedStats.additions;
          existing.deletions = (existing.deletions ?? 0) + derivedStats.deletions;
        }
        continue;
      }

      fileMap.set(locationPath, {
        path: locationPath,
        label: normalizeLocationLabel(locationPath),
        additions: gitFileStat?.additions ?? derivedStats?.additions ?? null,
        deletions: gitFileStat?.deletions ?? derivedStats?.deletions ?? null,
        toolKinds: [item.toolKind],
        previewPatch: derivedPreviewPatch,
      });
    }
  }

  return Array.from(fileMap.values());
};

const formatWorkedDuration = (durationMs: number | null): string => {
  const totalSeconds = Math.max(1, Math.round((durationMs ?? 0) / 1000));
  if (totalSeconds < 60) {
    return `Worked for ${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `Worked for ${minutes}m` : `Worked for ${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `Worked for ${hours}h`
    : `Worked for ${hours}h ${remainingMinutes}m`;
};

const formatSignedChangeCount = (value: number, prefix: '+' | '-'): string =>
  `${prefix}${Math.abs(value).toLocaleString()}`;

const buildBestEffortFallbackStats = async (
  file: ChangedFileEntry,
  workspacePathCandidates: string[],
): Promise<{ additions: number; deletions: number }> => {
  if (file.previewPatch) {
    const previewCounts = parsePatchChangeCounts(file.previewPatch);
    if (previewCounts.additions > 0 || previewCounts.deletions > 0) {
      return previewCounts;
    }
  }

  for (const workspacePath of workspacePathCandidates) {
    try {
      const fileResult = await window.desktop.workspaceReadFile({
        workspacePath,
        filePath: file.path,
      });

      return {
        additions: countTextLines(fileResult.content),
        deletions: 0,
      };
    } catch {
      // Try the next workspace root candidate.
    }
  }

  return file.previewPatch ? parsePatchChangeCounts(file.previewPatch) : { additions: 0, deletions: 0 };
};

const looksLikeUnifiedDiffText = (value: string): boolean =>
  value.includes('diff --git') || value.includes('\n@@') || value.startsWith('--- ');

const buildBestEffortFallbackPatch = async (
  file: ChangedFileEntry,
  workspacePathCandidates: string[],
): Promise<string> => {
  if (file.previewPatch && looksLikeUnifiedDiffText(file.previewPatch)) {
    return file.previewPatch;
  }

  for (const workspacePath of workspacePathCandidates) {
    try {
      const fileResult = await window.desktop.workspaceReadFile({
        workspacePath,
        filePath: file.path,
      });

      return buildSyntheticAddedFilePatch(file.label, fileResult.content);
    } catch {
      // Try the next workspace root candidate.
    }
  }

  return file.previewPatch ?? '';
};

const parsePatchChangeCounts = (patch: string): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;

  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }

    if (line.startsWith('+')) {
      additions += 1;
      continue;
    }

    if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
};

const hasZeroChangeCounts = (value: { additions: number | null; deletions: number | null }): boolean =>
  (value.additions ?? 0) === 0 && (value.deletions ?? 0) === 0;

const buildTranscriptBlocks = (
  timeline: TimelineItem[],
  options: {
    clockMs: number;
    isThinking: boolean;
    gitFileStatsByPath: Record<string, WorkspaceGitFileStat>;
  },
): TranscriptRenderBlock[] => {
  const blocks: TranscriptRenderBlock[] = [];
  let currentTurnItems: TimelineItem[] = [];

  const flushCurrentTurn = (isFinalFlush: boolean): void => {
    if (currentTurnItems.length === 0) {
      return;
    }

    const finalIndex = [...currentTurnItems]
      .map((item, index) => ({ item, index }))
      .filter((entry) => isFinalAssistantMessage(entry.item))
      .at(-1)?.index;

    const finalMessage =
      typeof finalIndex === 'number'
        ? (currentTurnItems[finalIndex] as AssistantTimelineItem)
        : null;
    const activities =
      typeof finalIndex === 'number'
        ? currentTurnItems.filter((_, index) => index !== finalIndex)
        : [...currentTurnItems];
    const startedAtMs = currentTurnItems[0]?.createdAtMs ?? null;
    const lastUpdatedAtMs = currentTurnItems.at(-1)?.updatedAtMs ?? null;
    const endAtMs =
      finalMessage?.updatedAtMs ??
      (options.isThinking ? Math.max(options.clockMs, lastUpdatedAtMs ?? options.clockMs) : lastUpdatedAtMs);
    const durationMs =
      startedAtMs && endAtMs && endAtMs >= startedAtMs ? endAtMs - startedAtMs : null;
    const isComplete = finalMessage !== null && (!isFinalFlush || !options.isThinking);

    blocks.push({
      kind: 'assistant-turn',
      key: `${currentTurnItems[0]?.id ?? 'turn'}-${currentTurnItems.at(-1)?.id ?? 'tail'}`,
      items: [...currentTurnItems],
      activities,
      finalMessage,
      durationMs,
      changedFiles: collectChangedFiles(currentTurnItems, options.gitFileStatsByPath),
      isComplete,
    });

    currentTurnItems = [];
  };

  for (const item of timeline) {
    if (item.kind === 'user-message') {
      flushCurrentTurn(false);
      blocks.push({
        kind: 'timeline-item',
        item,
      });
      continue;
    }

    currentTurnItems.push(item);
  }

  flushCurrentTurn(true);

  return blocks;
};

const parseRegistryAgentIcons = (payload: unknown): RegistryAgentIconEntry[] => {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { agents?: unknown[] }).agents)) {
    return [];
  }

  const entries: RegistryAgentIconEntry[] = [];
  for (const item of (payload as { agents: unknown[] }).agents) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const iconUrl = typeof record.icon === 'string' ? record.icon.trim() : '';
    if (!name || !iconUrl) {
      continue;
    }

    entries.push({ name, iconUrl });
  }

  return entries;
};

const AgentChangedNotice = ({
  text,
  iconUrl,
}: {
  text: string;
  iconUrl?: string | null;
}): JSX.Element => {
  const normalizedText = text.trim().replace(/[.]+$/, '');
  const parsedAgentLabel = parseAgentChangedLabel(normalizedText);
  const agentLabel = parsedAgentLabel ?? 'Agent';
  const prefixText = parsedAgentLabel ? 'Agent changed to' : normalizedText;
  const avatarFallback = agentLabel.charAt(0).toUpperCase() || 'A';

  return (
    <div className="flex items-center gap-2 py-1 text-[12px] text-stone-400">
      <span className="h-px flex-1 bg-stone-200/80" />
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span>{prefixText}</span>
        {parsedAgentLabel ? (
          <span className="inline-flex items-center gap-1.5">
            <Avatar className="h-3.5 w-3.5 rounded-[4px] bg-stone-100">
              {iconUrl ? (
                <AvatarImage
                  src={iconUrl}
                  alt={`${agentLabel} icon`}
                  className="zeroade-agent-icon-image"
                />
              ) : null}
              <AvatarFallback className="rounded-[4px] bg-stone-200 text-[8px] font-semibold text-stone-600">
                {avatarFallback}
              </AvatarFallback>
            </Avatar>
            <span>{parsedAgentLabel}</span>
          </span>
        ) : null}
      </span>
      <span className="h-px flex-1 bg-stone-200/80" />
    </div>
  );
};

const AssistantMessage = ({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink: (url: string) => void;
}): JSX.Element => {
  const segments = React.useMemo(() => parseAssistantSegments(text), [text]);
  const [isDarkTheme, setIsDarkTheme] = React.useState(
    document.documentElement.dataset.zeroadeTheme === 'dark',
  );

  React.useEffect(() => {
    const handleThemeChange = (): void => {
      setIsDarkTheme(document.documentElement.dataset.zeroadeTheme === 'dark');
    };

    window.addEventListener('zeroade-ui-preferences-changed', handleThemeChange);
    return () => {
      window.removeEventListener('zeroade-ui-preferences-changed', handleThemeChange);
    };
  }, []);

  return (
    <div className="space-y-3 pt-0.5 text-[15px] leading-7 text-stone-700">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          const normalizedText = normalizeAssistantTextSegment(segment.text);
          if (normalizedText.length === 0) {
            return null;
          }

          return (
            <MarkdownText
              key={`assistant-text-${index}`}
              text={normalizedText}
              keyPrefix={`assistant-inline-${index}`}
              onOpenLink={onOpenLink}
            />
          );
        }

        return (
          <div
            key={`assistant-code-${index}`}
            className="overflow-hidden rounded-xl"
            style={{
              backgroundColor: isDarkTheme ? '#17171c' : 'rgba(244, 244, 245, 0.9)',
            }}
          >
            {segment.language ? (() => {
              const languagePresentation = toLanguagePresentation(segment.language);
              const LanguageIcon = languagePresentation.Icon;

              return (
                <div className="flex items-center gap-1.5 px-3 pb-2 pt-1 text-[13px] font-medium text-stone-600">
                  <LanguageIcon className="h-3.5 w-3.5 text-stone-500" />
                  <span>{languagePresentation.label}</span>
                </div>
              );
            })() : null}
            <div className="overflow-x-auto">
              <SyntaxHighlighter
                language={segment.language ?? 'text'}
                style={isDarkTheme ? coldarkDark : coldarkCold}
                customStyle={syntaxHighlighterCustomStyle}
                codeTagProps={{
                  style: syntaxHighlighterCodeTagStyle,
                }}
                PreTag="div"
              >
                {segment.code}
              </SyntaxHighlighter>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const UserImageAttachmentCard = ({
  attachment,
  onOpenFile,
  onPreview,
}: {
  attachment: AcpPromptAttachment;
  onOpenFile: (path: string) => void;
  onPreview: (payload: {
    src: string;
    label: string;
    absolutePath: string;
  }) => void;
}): JSX.Element => {
  const attachmentLabel = toAttachmentLabel(attachment);
  const fallbackSource = React.useMemo(
    () => toAttachmentFileUrl(attachment.absolutePath),
    [attachment.absolutePath],
  );
  const [previewSource, setPreviewSource] = React.useState(fallbackSource);

  React.useEffect(() => {
    let cancelled = false;
    setPreviewSource(fallbackSource);

    const loadPreview = async (): Promise<void> => {
      try {
        const result = await window.desktop.readAttachmentPreview({
          absolutePath: attachment.absolutePath,
        });

        if (!cancelled && result.dataUrl?.trim()) {
          setPreviewSource(result.dataUrl);
        }
      } catch {
        // Keep file:// fallback source when preview loading fails.
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [attachment.absolutePath, fallbackSource]);

  return (
    <button
      type="button"
      className="no-drag overflow-hidden rounded-xl border border-stone-300/80 bg-white text-left transition-colors hover:bg-stone-50"
      title={attachment.absolutePath}
      onClick={() =>
        onPreview({
          src: previewSource,
          label: attachmentLabel,
          absolutePath: attachment.absolutePath,
        })
      }
      onDoubleClick={() => onOpenFile(attachment.absolutePath)}
    >
      <img
        src={previewSource}
        alt={attachmentLabel}
        loading="lazy"
        className="block max-h-[132px] w-full object-cover"
      />
    </button>
  );
};

const UserImageAttachments = ({
  attachments,
  onOpenFile,
  onPreview,
}: {
  attachments: AcpPromptAttachment[];
  onOpenFile: (path: string) => void;
  onPreview: (payload: {
    src: string;
    label: string;
    absolutePath: string;
  }) => void;
}): JSX.Element => {
  const usesMultiColumnGrid = attachments.length > 1;

  return (
    <div
      className={cn(
        'inline-grid w-fit max-w-full gap-2 self-end justify-items-end',
        usesMultiColumnGrid ? 'sm:grid-cols-2' : 'grid-cols-1',
      )}
    >
      {attachments.map((attachment, index) => (
        <UserImageAttachmentCard
          key={`${attachment.absolutePath}-${index}`}
          attachment={attachment}
          onOpenFile={onOpenFile}
          onPreview={onPreview}
        />
      ))}
    </div>
  );
};

const UserFileAttachments = ({
  attachments,
  onOpenFile,
}: {
  attachments: AcpPromptAttachment[];
  onOpenFile: (path: string) => void;
}): JSX.Element => {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {attachments.map((attachment, index) => {
        const attachmentLabel = toAttachmentLabel(attachment);

        return (
          <button
            key={`${attachment.absolutePath}-${index}`}
            type="button"
            className="no-drag flex min-w-0 max-w-full items-center gap-2 rounded-full border border-stone-300/80 bg-stone-100/70 px-3 py-1.5 text-left text-[12px] text-stone-700 transition-colors hover:bg-stone-100"
            title={attachment.absolutePath}
            onClick={() => onOpenFile(attachment.absolutePath)}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="truncate">{attachmentLabel}</span>
          </button>
        );
      })}
    </div>
  );
};

const TranscriptSectionDivider = ({
  label,
  collapsible = false,
  isExpanded = true,
  onToggle,
}: {
  label: string;
  collapsible?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}): JSX.Element => {
  const content = (
    <>
      <span className="h-px flex-1 bg-stone-200/85" />
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium text-stone-500">
        <span>{label}</span>
        {collapsible ? (
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-150',
              isExpanded ? 'rotate-0' : '-rotate-90',
            )}
          />
        ) : null}
      </span>
      <span className="h-px flex-1 bg-stone-200/85" />
    </>
  );

  if (!collapsible || !onToggle) {
    return <div className="flex items-center">{content}</div>;
  }

  return (
    <button
      type="button"
      className="no-drag flex w-full items-center text-left transition-colors hover:text-stone-700"
      onClick={onToggle}
    >
      {content}
    </button>
  );
};

const TranscriptPlanCard = ({ item }: { item: Extract<TimelineItem, { kind: 'plan' }> }): JSX.Element => {
  return (
    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-3.5">
      <p className="text-[11px] font-medium text-stone-500">Plan update</p>
      <div className="mt-2 space-y-1.5">
        {item.entries.map((entry, index) => (
          <div
            key={`${entry.content}-${index}`}
            className="flex items-start justify-between gap-3 rounded-xl border border-stone-200/65 bg-white/70 px-3 py-2"
          >
            <p className="text-[13px] text-stone-700">{entry.content}</p>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                entry.status === 'completed' && 'bg-emerald-100 text-emerald-700',
                entry.status === 'in_progress' && 'bg-amber-100 text-amber-700',
                entry.status === 'pending' && 'bg-stone-100 text-stone-600',
              )}
            >
              {entry.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TranscriptToolCall = ({
  item,
  isExpanded,
  onToggle,
  onOpenFile,
}: {
  item: Extract<TimelineItem, { kind: 'tool-call' }>;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenFile: (path: string) => void;
}): JSX.Element => {
  const presentation = buildToolCallPresentation(item);
  const hasDetails =
    Boolean(presentation.commandLine) ||
    Boolean(presentation.outputText) ||
    item.locations.length > 0;

  return (
    <div>
      <button
        type="button"
        className="no-drag group flex items-center gap-2 text-left text-[15px] font-medium text-stone-600 transition-colors hover:text-stone-800"
        onClick={onToggle}
      >
        <span>{item.toolKind === 'execute' ? 'Ran command' : item.title}</span>
        {hasDetails ? (
          <ChevronDown
            className={cn(
              'h-4 w-4 text-stone-500 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100',
              isExpanded ? 'rotate-0' : '-rotate-90',
            )}
          />
        ) : null}
      </button>

      {isExpanded && hasDetails ? (
        <div className="mt-2 rounded-2xl bg-stone-200/70 px-4 py-3 text-stone-700">
          <p className="text-[14px] text-stone-600">{presentation.shellLabel}</p>

          {presentation.commandLine ? (
            <pre className="mt-2 overflow-x-auto font-mono text-[13px] leading-7 text-stone-900">
              {`$ ${presentation.commandLine}`}
            </pre>
          ) : null}

          {presentation.outputText ? (
            <pre className="mt-4 overflow-x-auto font-mono text-[13px] leading-7 text-stone-600">
              {presentation.outputText}
            </pre>
          ) : null}

          {item.locations.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.locations.map((locationPath) => (
                <button
                  key={locationPath}
                  type="button"
                  className="no-drag rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-50"
                  onClick={() => onOpenFile(locationPath)}
                >
                  {normalizeLocationLabel(locationPath)}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className={cn(
              'mt-3 flex justify-end text-[13px] font-medium',
              presentation.isSuccess ? 'text-stone-500' : 'text-rose-600',
            )}
          >
            {presentation.isSuccess ? '✓ ' : '✕ '}
            {presentation.statusLabel}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const TranscriptChangedFilesPanel = ({
  files,
  workspacePath,
  projectPaths,
  onOpenFile,
}: {
  files: ChangedFileEntry[];
  workspacePath: string;
  projectPaths: string[];
  onOpenFile: (path: string) => void;
}): JSX.Element => {
  const [diffStatsByPath, setDiffStatsByPath] = React.useState<
    Record<string, { additions: number; deletions: number }>
  >({});
  const [expandedDiffsByPath, setExpandedDiffsByPath] = React.useState<Record<string, boolean>>({});
  const [inlineDiffsByPath, setInlineDiffsByPath] = React.useState<
    Record<string, InlineDiffPreviewState>
  >({});

  React.useEffect(() => {
    let cancelled = false;

    const filesNeedingFallback = files.filter(
      (file) =>
        typeof file.additions !== 'number' ||
        typeof file.deletions !== 'number' ||
        hasZeroChangeCounts(file),
    );

    if (filesNeedingFallback.length === 0) {
      setDiffStatsByPath({});
      return;
    }

    const loadDiffStats = async (): Promise<void> => {
      const entries = await Promise.all(
        filesNeedingFallback.map(async (file) => {
          const workspacePathCandidates = resolveWorkspacePathCandidatesForFile(
            file.path,
            workspacePath,
            projectPaths,
          );

          try {
            for (const workspacePathCandidate of workspacePathCandidates) {
              try {
                const result = await window.desktop.workspaceDiffFile({
                  workspacePath: workspacePathCandidate,
                  filePath: file.path,
                });

                if (result.hasDiff && result.patch.trim()) {
                  return [file.path, parsePatchChangeCounts(result.patch)] as const;
                }
              } catch {
                // Try the next workspace root candidate.
              }
            }

            return [
              file.path,
              await buildBestEffortFallbackStats(file, workspacePathCandidates),
            ] as const;
          } catch {
            return [file.path, { additions: 0, deletions: 0 }] as const;
          }
        }),
      );

      if (!cancelled) {
        setDiffStatsByPath(Object.fromEntries(entries));
      }
    };

    void loadDiffStats();

    return () => {
      cancelled = true;
    };
  }, [files, projectPaths, workspacePath]);

  const resolvedFiles = React.useMemo(
    () =>
      files.map((file) => {
        const fallback = diffStatsByPath[file.path];
        const shouldUseFallback =
          Boolean(fallback) &&
          (
            typeof file.additions !== 'number' ||
            typeof file.deletions !== 'number' ||
            (hasZeroChangeCounts(file) &&
              ((fallback?.additions ?? 0) > 0 || (fallback?.deletions ?? 0) > 0))
          );

        return {
          ...file,
          additions: shouldUseFallback
            ? fallback?.additions ?? null
            : file.additions,
          deletions: shouldUseFallback
            ? fallback?.deletions ?? null
            : file.deletions,
        };
      }),
    [diffStatsByPath, files],
  );

  const loadInlineDiffPreview = React.useCallback(
    async (file: ChangedFileEntry): Promise<void> => {
      let shouldLoad = true;

      setInlineDiffsByPath((previous) => {
        const current = previous[file.path];
        if (current?.isLoading || (current && (current.patch || current.error))) {
          shouldLoad = false;
          return previous;
        }

        return {
          ...previous,
          [file.path]: {
            isLoading: true,
            patch: null,
            error: null,
          },
        };
      });

      if (!shouldLoad) {
        return;
      }

      const workspacePathCandidates = resolveWorkspacePathCandidatesForFile(
        file.path,
        workspacePath,
        projectPaths,
      );

      try {
        let patch = '';
        for (const workspacePathCandidate of workspacePathCandidates) {
          try {
            const result = await window.desktop.workspaceDiffFile({
              workspacePath: workspacePathCandidate,
              filePath: file.path,
            });

            if (result.hasDiff && result.patch.trim()) {
              patch = result.patch;
              break;
            }
          } catch {
            // Try the next workspace root candidate.
          }
        }

        if (!patch) {
          patch = await buildBestEffortFallbackPatch(file, workspacePathCandidates);
        }

        setInlineDiffsByPath((previous) => ({
          ...previous,
          [file.path]: {
            isLoading: false,
            patch: patch || null,
            error: patch ? null : 'No inline diff available.',
          },
        }));
      } catch {
        setInlineDiffsByPath((previous) => ({
          ...previous,
          [file.path]: {
            isLoading: false,
            patch: null,
            error: 'Unable to load diff preview.',
          },
        }));
      }
    },
    [projectPaths, workspacePath],
  );

  const toggleInlineDiffPreview = React.useCallback(
    (file: ChangedFileEntry) => {
      const isExpanded = Boolean(expandedDiffsByPath[file.path]);
      if (!isExpanded) {
        void loadInlineDiffPreview(file);
      }

      setExpandedDiffsByPath((previous) => ({
        ...previous,
        [file.path]: !previous[file.path],
      }));
    },
    [expandedDiffsByPath, loadInlineDiffPreview],
  );

  const totalAdditions = resolvedFiles.reduce(
    (sum, file) => sum + (typeof file.additions === 'number' ? file.additions : 0),
    0,
  );
  const totalDeletions = resolvedFiles.reduce(
    (sum, file) => sum + (typeof file.deletions === 'number' ? file.deletions : 0),
    0,
  );
  const showTotals = resolvedFiles.some(
    (file) => typeof file.additions === 'number' || typeof file.deletions === 'number',
  );
  const showHeaderTotals = files.length > 1 && showTotals;

  return (
    <div className="rounded-2xl bg-stone-100/80">
      <div className="px-4 py-2">
        <div className="flex items-center gap-2 text-[14px] font-medium text-stone-800">
          <span>
            {files.length} file{files.length === 1 ? '' : 's'} changed
          </span>
          {showHeaderTotals ? (
            <>
              <span className="text-emerald-600">
                {formatSignedChangeCount(totalAdditions, '+')}
              </span>
              <span className="-ml-1 text-rose-600">
                {formatSignedChangeCount(totalDeletions, '-')}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div>
        {resolvedFiles.map((file, index) => {
          const isExpanded = Boolean(expandedDiffsByPath[file.path]);
          const diffPreview = inlineDiffsByPath[file.path];
          const isLastFile = index === resolvedFiles.length - 1;

          return (
            <div key={file.path}>
              <div
                className={cn(
                  'group/file-row flex items-center gap-2 pl-4 pr-2 transition-colors',
                  'py-1.5',
                  isLastFile && !isExpanded && 'rounded-b-2xl',
                )}
              >
                <button
                  type="button"
                  className="no-drag flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[13px] text-stone-700"
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey) {
                      onOpenFile(file.path);
                      return;
                    }

                    toggleInlineDiffPreview(file);
                  }}
                  onDoubleClick={() => onOpenFile(file.path)}
                >
                  <FileText className="h-4 w-4 shrink-0 text-stone-500" />
                  <span className="min-w-0 truncate">{file.label}</span>
                  {typeof file.additions === 'number' || typeof file.deletions === 'number' ? (
                    <span className="shrink-0 whitespace-nowrap text-[12px] font-medium">
                      <span className="text-emerald-600">
                        {formatSignedChangeCount(file.additions ?? 0, '+')}
                      </span>
                      <span className="ml-1 text-rose-600">
                        {formatSignedChangeCount(file.deletions ?? 0, '-')}
                      </span>
                    </span>
                  ) : null}
                </button>

                <div
                  className="group/toggle flex h-7 w-8 shrink-0 items-center justify-end"
                >
                  <button
                    type="button"
                    aria-label={isExpanded ? 'Collapse diff preview' : 'Expand diff preview'}
                    className={cn(
                      'no-drag inline-flex items-center justify-center rounded-full bg-transparent text-stone-600 transition-all hover:bg-stone-300/85 focus-visible:bg-stone-300/85',
                      'h-7 w-7',
                      isExpanded
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/file-row:opacity-100',
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleInlineDiffPreview(file);
                    }}
                  >
                    <ChevronDown
                      className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
                    />
                  </button>
                </div>
              </div>

              {isExpanded ? (
                <div className="bg-white/35">
                  {diffPreview?.isLoading ? (
                    <div
                      className={cn(
                        'bg-stone-100/80 px-3 py-2 text-[13px] text-stone-500',
                        isLastFile && 'rounded-b-2xl',
                      )}
                    >
                      Loading diff preview...
                    </div>
                  ) : diffPreview?.patch ? (
                    <div className={cn('overflow-hidden', isLastFile && 'rounded-b-2xl')}>
                      <InlineMonacoDiffEditor filePath={file.path} patch={diffPreview.patch} />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'bg-stone-100/80 px-3 py-2 text-[13px] text-stone-500',
                        isLastFile && 'rounded-b-2xl',
                      )}
                    >
                      {diffPreview?.error ?? 'No inline diff available.'}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const Transcript = ({
  threadId,
  workspaceName,
  workspacePath,
  projects,
  selectedProjectId,
  timeline,
  isNewThread,
  isThinking,
  pendingPermission,
  onSelectProject,
  onAddProject,
  onResolvePermission,
  onOpenFile,
  onOpenLink,
  onSelectSuggestion,
}: TranscriptProps): JSX.Element => {
  const [expandedToolCalls, setExpandedToolCalls] = React.useState<Record<string, boolean>>({});
  const [expandedWorkedSections, setExpandedWorkedSections] = React.useState<
    Record<string, boolean>
  >({});
  const [showScrollToBottom, setShowScrollToBottom] = React.useState(false);
  const [agentIconByName, setAgentIconByName] = React.useState<Record<string, string>>({});
  const [imagePreview, setImagePreview] = React.useState<{
    src: string;
    label: string;
    absolutePath: string;
  } | null>(null);
  const [clockMs, setClockMs] = React.useState(() => Date.now());
  const [gitFileStatsByPath, setGitFileStatsByPath] = React.useState<
    Record<string, WorkspaceGitFileStat>
  >({});
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const lastThreadIdRef = React.useRef(threadId);
  const lastTimelineTailRef = React.useRef<{
    id: string;
    kind: TimelineItem['kind'];
  } | null>(null);

  const updateScrollToBottomVisibility = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      setShowScrollToBottom(false);
      return;
    }

    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
    const distanceFromBottom = maxScrollTop - container.scrollTop;
    const hasOverflow = maxScrollTop > 0;
    const shouldShow = hasOverflow && distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD;

    setShowScrollToBottom((previous) => (previous === shouldShow ? previous : shouldShow));
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const loadAgentIcons = async (): Promise<void> => {
      try {
        const response = await fetch(ACP_REGISTRY_URL);
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as unknown;
        const entries = parseRegistryAgentIcons(payload);
        if (entries.length === 0 || cancelled) {
          return;
        }

        setAgentIconByName((previous) => {
          const next = { ...previous };
          for (const entry of entries) {
            next[entry.name.toLowerCase()] = entry.iconUrl;
          }
          return next;
        });
      } catch {
        // Keep existing icon map when registry lookup fails.
      }
    };

    void loadAgentIcons();

    return () => {
      cancelled = true;
    };
  }, []);

  const scrollToBottom = React.useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    setShowScrollToBottom(false);
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  const toggleToolCallDetails = React.useCallback((toolCallId: string) => {
    setExpandedToolCalls((previous) => ({
      ...previous,
      [toolCallId]: !previous[toolCallId],
    }));
  }, []);

  const toggleWorkedSection = React.useCallback((sectionKey: string) => {
    setExpandedWorkedSections((previous) => ({
      ...previous,
      [sectionKey]: !(previous[sectionKey] ?? true),
    }));
  }, []);

  React.useEffect(() => {
    if (!isThinking) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setClockMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isThinking]);

  React.useEffect(() => {
    let cancelled = false;

    const loadGitFileStats = async (): Promise<void> => {
      if (!workspacePath.trim()) {
        setGitFileStatsByPath({});
        return;
      }

      try {
        const result = await window.desktop.workspaceGitStatus({
          workspacePath,
        });

        if (cancelled || !result.available) {
          if (!cancelled) {
            setGitFileStatsByPath({});
          }
          return;
        }

        const nextEntries = Object.fromEntries(
          result.fileStats.map((entry) => [toNormalizedPathKey(entry.path), entry]),
        );
        if (!cancelled) {
          setGitFileStatsByPath(nextEntries);
        }
      } catch {
        if (!cancelled) {
          setGitFileStatsByPath({});
        }
      }
    };

    void loadGitFileStats();

    return () => {
      cancelled = true;
    };
  }, [workspacePath, timeline.at(-1)?.id, timeline.at(-1)?.updatedAtMs]);

  React.useEffect(() => {
    const tail = timeline[timeline.length - 1];
    const normalizedTail = tail
      ? {
          id: tail.id,
          kind: tail.kind,
        }
      : null;

    if (lastThreadIdRef.current !== threadId) {
      lastThreadIdRef.current = threadId;
      lastTimelineTailRef.current = normalizedTail;
      return;
    }

    const previousTail = lastTimelineTailRef.current;
    lastTimelineTailRef.current = normalizedTail;

    if (!normalizedTail || normalizedTail.kind !== 'user-message') {
      return;
    }

    const hasNewTail =
      !previousTail ||
      previousTail.kind !== normalizedTail.kind ||
      previousTail.id !== normalizedTail.id;

    if (!hasNewTail) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, [threadId, timeline]);

  React.useEffect(() => {
    if (typeof window.IntersectionObserver === 'function') {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const onScroll = (): void => {
      updateScrollToBottomVisibility();
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    updateScrollToBottomVisibility();

    return () => {
      container.removeEventListener('scroll', onScroll);
    };
  }, [updateScrollToBottomVisibility]);

  React.useEffect(() => {
    const container = scrollContainerRef.current;
    const sentinel = bottomSentinelRef.current;
    if (
      !container ||
      !sentinel ||
      typeof window.IntersectionObserver !== 'function'
    ) {
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
        const hasOverflow = maxScrollTop > 0;
        const shouldShow = hasOverflow && !entry.isIntersecting;

        setShowScrollToBottom((previous) => (previous === shouldShow ? previous : shouldShow));
      },
      {
        root: container,
        rootMargin: `0px 0px ${SCROLL_TO_BOTTOM_THRESHOLD}px 0px`,
        threshold: 0,
      },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [threadId, timeline.length]);

  React.useEffect(() => {
    if (typeof window.IntersectionObserver === 'function') {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      updateScrollToBottomVisibility();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [threadId, timeline, updateScrollToBottomVisibility]);

  const selectedProjectName =
    projects.find((project) => project.id === selectedProjectId)?.name ?? workspaceName;
  const projectPaths = React.useMemo(
    () => projects.map((project) => project.path),
    [projects],
  );

  const transcriptBlocks = React.useMemo(
    () => buildTranscriptBlocks(timeline, { clockMs, isThinking, gitFileStatsByPath }),
    [clockMs, gitFileStatsByPath, isThinking, timeline],
  );

  const renderAgentTimelineItem = React.useCallback(
    (item: Exclude<TimelineItem, { kind: 'user-message' }>): JSX.Element | null => {
      if (item.kind === 'assistant-message') {
        if (item.noticeKind === 'agent-change' || isAgentChangedNotice(item.text)) {
          const parsedAgentLabel = parseAgentChangedLabel(item.text);
          const resolvedIconUrl =
            item.iconUrl ??
            (parsedAgentLabel ? (agentIconByName[parsedAgentLabel.toLowerCase()] ?? null) : null);
          return <AgentChangedNotice text={item.text} iconUrl={resolvedIconUrl} />;
        }

        return <AssistantMessage text={item.text} onOpenLink={onOpenLink} />;
      }

      if (item.kind === 'plan') {
        return <TranscriptPlanCard item={item} />;
      }

      return (
        <TranscriptToolCall
          item={item}
          isExpanded={expandedToolCalls[item.toolCallId] === true}
          onToggle={() => toggleToolCallDetails(item.toolCallId)}
          onOpenFile={onOpenFile}
        />
      );
    },
    [agentIconByName, expandedToolCalls, onOpenFile, onOpenLink, toggleToolCallDetails],
  );

  const hasSelectedThread = threadId.trim().length > 0;

  if (isNewThread || !hasSelectedThread) {
    return (
      <NewThreadLanding
        workspaceName={selectedProjectName}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={onSelectProject}
        onAddProject={onAddProject}
        onSelectSuggestion={onSelectSuggestion}
      />
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollContainerRef} className="min-h-0 h-full overflow-y-auto scrollbar-none">
        <div className="space-y-6 pb-6 pt-3">
          {timeline.length === 0 ? (
            <EmptyState />
          ) : (
            transcriptBlocks.map((block) => {
              if (block.kind === 'timeline-item') {
                const item = block.item;

                if (item.kind === 'user-message') {
                  const attachments = item.attachments ?? [];
                  const imageAttachments = attachments.filter((attachment) =>
                    isImageAttachment(attachment),
                  );
                  const fileAttachments = attachments.filter(
                    (attachment) => !isImageAttachment(attachment),
                  );
                  const hasText = item.text.trim().length > 0;

                  return (
                    <div key={item.id} className="flex justify-end">
                      <div className="flex max-w-[78%] flex-col items-end gap-2">
                        {imageAttachments.length > 0 ? (
                          <UserImageAttachments
                            attachments={imageAttachments}
                            onOpenFile={onOpenFile}
                            onPreview={setImagePreview}
                          />
                        ) : null}

                        {hasText ? (
                          <div className="rounded-[14px] bg-stone-200/70 px-3 py-1 text-[14px] leading-6 text-stone-700">
                            <MarkdownText
                              text={item.text}
                              keyPrefix={`user-inline-${item.id}`}
                              onOpenLink={onOpenLink}
                            />
                          </div>
                        ) : null}

                        {fileAttachments.length > 0 ? (
                          <UserFileAttachments
                            attachments={fileAttachments}
                            onOpenFile={onOpenFile}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={item.id}>
                    {renderAgentTimelineItem(item as Exclude<TimelineItem, { kind: 'user-message' }>)}
                  </div>
                );
              }

              if (!block.isComplete || !block.finalMessage) {
                return (
                  <div key={block.key} className="space-y-5">
                    {block.items.map((activity) => (
                      <div key={activity.id}>
                        {renderAgentTimelineItem(
                          activity as Exclude<TimelineItem, { kind: 'user-message' }>,
                        )}
                      </div>
                    ))}
                  </div>
                );
              }

              const hasWorkedSection = block.activities.length > 0;
              const isWorkedExpanded = expandedWorkedSections[block.key] ?? false;

              return (
                <div key={block.key} className="space-y-5">
                  {hasWorkedSection ? (
                    <div className="space-y-5">
                      <TranscriptSectionDivider
                        label={formatWorkedDuration(block.durationMs)}
                        collapsible
                        isExpanded={isWorkedExpanded}
                        onToggle={() => toggleWorkedSection(block.key)}
                      />

                      {isWorkedExpanded ? (
                        <div className="space-y-5">
                          {block.activities.map((activity) => (
                            <div key={activity.id}>
                              {renderAgentTimelineItem(
                                activity as Exclude<TimelineItem, { kind: 'user-message' }>,
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {block.finalMessage ? (
                    <div className="space-y-5">
                      {hasWorkedSection && isWorkedExpanded ? (
                        <TranscriptSectionDivider label="Final message" />
                      ) : null}
                      <AssistantMessage
                        text={block.finalMessage.text}
                        onOpenLink={onOpenLink}
                      />
                    </div>
                  ) : null}

                  {block.finalMessage && block.changedFiles.length > 0 ? (
                    <TranscriptChangedFilesPanel
                      files={block.changedFiles}
                      workspacePath={workspacePath}
                      projectPaths={projectPaths}
                      onOpenFile={onOpenFile}
                    />
                  ) : null}
                </div>
              );
            })
          )}

          {pendingPermission ? (
            <div className="rounded-[26px] bg-stone-100/80 p-3.5">
              <h3 className="text-[15px] font-semibold text-stone-900">
                {pendingPermission.toolCall.title ?? 'Tool approval needed'}
              </h3>
              <p className="mt-1 text-[13px] text-stone-600">
                The agent requested permission to run a tool call for this session.
              </p>

              <div className="mt-3 space-y-1.5">
                {pendingPermission.options.map((option) => (
                  <button
                    key={option.optionId}
                    type="button"
                    className={`
                      no-drag w-full rounded-2xl border-none bg-stone-200/55 px-3 py-2 text-left text-[13px] font-medium
                      text-stone-800 transition-colors hover:bg-stone-300/75
                    `}
                    onClick={() => onResolvePermission(pendingPermission.requestId, option.optionId)}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {isThinking && !pendingPermission ? (
            <ThinkingIndicator />
          ) : null}
          <div ref={bottomSentinelRef} className="h-px w-full" aria-hidden />
        </div>
      </div>

      {showScrollToBottom ? (
        <button
          type="button"
          aria-label="Scroll to bottom"
          className="no-drag absolute bottom-3 left-1/2 z-20 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-[0_16px_34px_-24px_rgba(20,20,20,0.55)] transition-colors hover:bg-stone-50"
          onClick={scrollToBottom}
        >
          <ArrowDown className="h-[18px] w-[18px]" />
        </button>
      ) : null}

      <Dialog
        open={imagePreview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setImagePreview(null);
          }
        }}
      >
        <DialogContent
          className="no-drag w-auto max-w-[92vw] rounded-[18px] border-none bg-transparent p-0 shadow-none"
        >
          {imagePreview ? (
            <div className="overflow-hidden rounded-[16px] bg-stone-100/90">
              <img
                src={imagePreview.src}
                alt={imagePreview.label}
                className="block max-h-[88vh] max-w-[92vw] object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const EmptyState = (): JSX.Element => {
  return <></>;
};

const ThinkingIndicator = (): JSX.Element => {
  return (
    <div className="pb-1 pt-0.5 text-[15px] leading-7">
      <span className="thinking-shimmer" data-text="Thinking">
        Thinking
      </span>
    </div>
  );
};

const NewThreadLanding = ({
  workspaceName,
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onSelectSuggestion,
}: {
  workspaceName: string;
  projects: TranscriptProjectOption[];
  selectedProjectId: string;
  onSelectProject: (workspaceId: string) => void;
  onAddProject: () => void;
  onSelectSuggestion: (value: string) => void;
}): JSX.Element => {
  const [isProjectMenuOpen, setIsProjectMenuOpen] = React.useState(false);
  const suggestions = [
    {
      id: 'explain-project',
      text: 'Explain what this project does in simple words.',
      icon: MessageSquare,
    },
    {
      id: 'plan-next-steps',
      text: 'Give me a clear step-by-step plan for what to do next.',
      icon: ListChecks,
    },
    {
      id: 'first-task',
      text: 'Suggest a good first task and how to start it.',
      icon: Lightbulb,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-none px-2 pb-4 pt-2">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <div className="flex w-full max-w-[520px] flex-col items-center">
          <DropdownMenu open={isProjectMenuOpen} onOpenChange={setIsProjectMenuOpen}>
            <div className="flex flex-wrap items-center justify-center gap-y-1 text-[34px] font-semibold leading-[1.08] tracking-[-0.02em]">
              <span className="text-stone-900">Build</span>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="no-drag ml-2 mr-0.5 inline-flex items-center rounded-md px-0 py-0.5 text-stone-500 transition-colors hover:text-stone-700"
                >
                  <span>{workspaceName}</span>
                  <ChevronDown
                    className={cn(
                      'ml-1 h-6 w-6 transition-transform duration-150',
                      isProjectMenuOpen && 'rotate-180',
                    )}
                  />
                </button>
              </DropdownMenuTrigger>
              <span className="text-stone-900">with</span>
            </div>

            <DropdownMenuContent
              align="center"
              sideOffset={10}
              className="w-[260px] max-w-[80vw] rounded-2xl px-1.5 py-1.5"
            >
              <DropdownMenuLabel className="px-3 pb-1.5 pt-1 text-[13px] font-normal text-stone-400">
                Select your project
              </DropdownMenuLabel>

              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  className="h-8 rounded-lg px-3"
                  onClick={() => {
                    onSelectProject(project.id);
                  }}
                  title={project.path}
                >
                  <Folder className="mr-2 h-4 w-4 text-stone-600" />
                  <span className="flex-1 text-[13px] font-normal text-stone-900">{project.name}</span>
                  {project.id === selectedProjectId ? (
                    <Check className="h-4 w-4 text-stone-900" />
                  ) : null}
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator className="my-1.5" />
              <DropdownMenuItem
                className="h-8 rounded-lg px-3"
                onClick={() => {
                  onAddProject();
                }}
              >
                <FolderPlus className="mr-2 h-4 w-4 text-stone-600" />
                <span className="text-[13px] font-normal text-stone-900">Add new project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <img src={zeroLogo} alt="Zero logo" className="mt-4 h-16 w-auto object-contain" />
        </div>
      </div>

      <div className="mb-4 mt-3 grid gap-2 md:grid-cols-3">
        {suggestions.map((suggestion) => {
          const SuggestionIcon = suggestion.icon;
          return (
            <button
              key={suggestion.id}
              type="button"
              className="no-drag flex h-full flex-col items-start rounded-2xl border border-stone-200/85 bg-white px-3 py-3 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-50"
              onClick={() => {
                onSelectSuggestion(suggestion.text);
              }}
            >
              <div className="mb-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                <SuggestionIcon className="h-3.5 w-3.5" />
              </div>
              <p className="text-left">{suggestion.text}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};
