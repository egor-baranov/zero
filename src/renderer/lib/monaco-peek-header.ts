import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { OneReferenceRenderer } from 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/peek/referencesTree.js';

interface PeekSymbolDescriptor {
  kindLabel: string;
  symbolName: string;
}

interface PeekReferenceLike {
  uri: {
    path?: string;
    fsPath?: string;
    toString(): string;
  };
  range: {
    startLineNumber: number;
  };
}

interface PeekReferenceNode {
  element: PeekReferenceLike;
}

interface PeekReferenceTemplateData {
  label: {
    element: HTMLElement;
    set(value: string): void;
  };
}

let peekReferencesListFormatterPatched = false;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const inferKindFromSource = (
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  symbolName: string,
): string => {
  const lineText = model.getLineContent(position.lineNumber);
  const symbolPattern = escapeRegExp(symbolName);

  if (new RegExp(`\\bclass\\s+${symbolPattern}\\b`).test(lineText)) {
    return 'Class';
  }

  if (new RegExp(`\\binterface\\s+${symbolPattern}\\b`).test(lineText)) {
    return 'Interface';
  }

  if (new RegExp(`\\benum\\s+${symbolPattern}\\b`).test(lineText)) {
    return 'Enum';
  }

  if (new RegExp(`\\btype\\s+${symbolPattern}\\b`).test(lineText)) {
    return 'Type';
  }

  if (new RegExp(`\\bfunction\\s+${symbolPattern}\\b`).test(lineText)) {
    return 'Function';
  }

  if (new RegExp(`\\b(const|let|var)\\s+${symbolPattern}\\b`).test(lineText)) {
    return 'Property';
  }

  if (new RegExp(`\\b${symbolPattern}\\s*:`).test(lineText)) {
    return 'Property';
  }

  if (new RegExp(`\\b${symbolPattern}\\s*\\(`).test(lineText)) {
    return 'Function';
  }

  return 'Symbol';
};

const parseUsageCount = (value: string): number | null => {
  const match = value.match(/\((\d+)\)|\b(\d+)\b/);
  const rawCount = match?.[1] ?? match?.[2];

  if (!rawCount) {
    return null;
  }

  const parsed = Number.parseInt(rawCount, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildPathLabel = (dirname: string, filename: string): string => {
  const trimmedFileName = filename.trim();
  const trimmedDirname = dirname.trim();

  if (!trimmedDirname) {
    return trimmedFileName;
  }

  return `${trimmedDirname.replace(/\/+$/, '')}/${trimmedFileName}`.replace(/\/{2,}/g, '/');
};

const getPathBaseName = (pathValue: string): string => {
  const normalizedPath = pathValue.replace(/\\/g, '/');
  const pathSegments = normalizedPath.split('/').filter(Boolean);
  return pathSegments.at(-1) ?? normalizedPath;
};

const getReferenceLabel = (reference: PeekReferenceLike): string => {
  const rawPath = reference.uri.path?.trim() || reference.uri.fsPath?.trim() || reference.uri.toString();
  const fileName = getPathBaseName(rawPath);
  return `${fileName} ${reference.range.startLineNumber}`;
};

const ensurePeekReferencesListFormatter = (): void => {
  if (peekReferencesListFormatterPatched) {
    return;
  }

  peekReferencesListFormatterPatched = true;

  const rendererPrototype = OneReferenceRenderer.prototype as {
    renderElement: (
      node: PeekReferenceNode,
      index: number,
      templateData: PeekReferenceTemplateData,
    ) => void;
  };
  const originalRenderElement = rendererPrototype.renderElement;

  rendererPrototype.renderElement = function renderElement(
    this: OneReferenceRenderer,
    node: PeekReferenceNode,
    index: number,
    templateData: PeekReferenceTemplateData,
  ): void {
    const reference = node.element;

    if (!reference?.uri || !reference.range || !templateData?.label?.element) {
      originalRenderElement.call(this, node, index, templateData);
      return;
    }

    const compactLabel = getReferenceLabel(reference);
    templateData.label.element.classList.remove('referenceMatch');
    templateData.label.element.classList.add('zeroade-peek-reference-label');
    templateData.label.set(compactLabel);
    templateData.label.element.title = compactLabel;
  };
};

const resolveSymbolDescriptor = (
  editor: monaco.editor.IStandaloneCodeEditor,
): PeekSymbolDescriptor | null => {
  const model = editor.getModel();
  const position = editor.getPosition();

  if (!model || !position) {
    return null;
  }

  const word = model.getWordAtPosition(position);
  if (!word?.word) {
    return null;
  }

  return {
    kindLabel: inferKindFromSource(model, position, word.word),
    symbolName: word.word,
  };
};

export const attachPeekReferencesHeaderFormatter = (
  editor: monaco.editor.IStandaloneCodeEditor,
): (() => void) => {
  ensurePeekReferencesListFormatter();

  if (!document.body) {
    return () => undefined;
  }

  let disposed = false;
  let scheduled = false;
  let symbolDescriptorCacheKey = '';
  let symbolDescriptorCache: PeekSymbolDescriptor | null = null;

  const getSymbolDescriptor = (): PeekSymbolDescriptor | null => {
    const model = editor.getModel();
    const position = editor.getPosition();
    const word = model && position ? model.getWordAtPosition(position) : null;
    const cacheKey = `${model?.uri.toString() ?? ''}:${model?.getVersionId() ?? 0}:${
      position?.lineNumber ?? 0
    }:${position?.column ?? 0}:${word?.word ?? ''}`;

    if (cacheKey === symbolDescriptorCacheKey) {
      return symbolDescriptorCache;
    }

    symbolDescriptorCacheKey = cacheKey;
    symbolDescriptorCache = resolveSymbolDescriptor(editor);
    return symbolDescriptorCache;
  };

  const applyFormattedTitle = (): void => {
    const titles = Array.from(
      document.querySelectorAll<HTMLElement>('.peekview-widget .head .peekview-title'),
    );

    if (titles.length === 0) {
      return;
    }

    const symbolDescriptor = getSymbolDescriptor();

    for (const title of titles) {
      const fileName = title.querySelector<HTMLElement>('.filename');
      const dirName = title.querySelector<HTMLElement>('.dirname');
      const meta = title.querySelector<HTMLElement>('.meta');

      if (!fileName || !dirName || !meta) {
        continue;
      }

      const currentFileNameText = fileName.textContent?.trim() ?? '';
      const currentDirNameText = dirName.textContent?.trim() ?? '';
      const currentMetaText = meta.textContent?.trim() ?? '';
      const lastFormattedTitle = title.dataset.zeroadeLastFormattedTitle ?? '';
      const lastFormattedMeta = title.dataset.zeroadeLastFormattedMeta ?? '';

      if (
        currentFileNameText !== lastFormattedTitle ||
        currentMetaText !== lastFormattedMeta ||
        currentDirNameText.length > 0
      ) {
        title.dataset.zeroadeRawFilename = currentFileNameText;
        title.dataset.zeroadeRawDirname = currentDirNameText;
        title.dataset.zeroadeRawMeta = currentMetaText;
      }

      const rawFileName = title.dataset.zeroadeRawFilename?.trim() ?? '';
      const rawDirName = title.dataset.zeroadeRawDirname?.trim() ?? '';
      const rawMeta = title.dataset.zeroadeRawMeta?.trim() ?? '';

      if (!rawFileName) {
        continue;
      }

      const pathLabel = buildPathLabel(rawDirName, rawFileName);
      const usageCount = parseUsageCount(rawMeta);
      const titleLabel = symbolDescriptor
        ? `${symbolDescriptor.kindLabel} ${symbolDescriptor.symbolName} in ${pathLabel}.`
        : `Symbol in ${pathLabel}.`;
      const usageLabel =
        usageCount === null ? '' : `${usageCount} ${usageCount === 1 ? 'usage' : 'usages'}`;

      title.classList.add('zeroade-peekview-title-formatted');
      fileName.textContent = titleLabel;
      fileName.title = titleLabel;
      dirName.textContent = '';
      meta.textContent = usageLabel;
      meta.title = usageLabel;
      title.dataset.zeroadeLastFormattedTitle = titleLabel;
      title.dataset.zeroadeLastFormattedMeta = usageLabel;
    }
  };

  const scheduleApply = (): void => {
    if (disposed || scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      applyFormattedTitle();
    });
  };

  const observer = new MutationObserver(() => {
    scheduleApply();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  scheduleApply();

  return () => {
    disposed = true;
    observer.disconnect();
  };
};
