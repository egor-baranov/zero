import 'monaco-editor/min/vs/editor/editor.main.css';
import 'monaco-editor/esm/vs/editor/contrib/semanticTokens/browser/documentSemanticTokens';
import 'monaco-editor/esm/vs/editor/contrib/semanticTokens/browser/viewportSemanticTokens';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import 'monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import { Disposable } from 'monaco-editor/esm/vs/base/common/lifecycle';
import { HoverService } from 'monaco-editor/esm/vs/platform/hover/browser/hoverService';
// eslint-disable-next-line import/default
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
// eslint-disable-next-line import/default
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
// eslint-disable-next-line import/default
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
// eslint-disable-next-line import/default
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
// eslint-disable-next-line import/default
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

interface MonacoEnvironmentGlobal {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
}

const monacoGlobal = globalThis as typeof globalThis & MonacoEnvironmentGlobal;

let hasConfiguredEnvironment = false;
let hasPatchedFindWidgetHoverDisable = false;
let hasInstalledFindWidgetHoverSuppression = false;

const FIND_WIDGET_HOVER_SUPPRESSION_CLASS = 'zeroade-suppress-find-widget-hover';
const FIND_WIDGET_CONTROL_SELECTOR =
  '.find-widget .button, .find-widget .monaco-custom-toggle, .findOptionsWidget .monaco-custom-toggle, .find-widget .monaco-inputbox .input';
const FIND_WIDGET_HOVER_RELEASE_DELAY_MS = 450;

const configureMonacoEnvironment = (): void => {
  if (hasConfiguredEnvironment) {
    return;
  }

  monacoGlobal.MonacoEnvironment = {
    ...(monacoGlobal.MonacoEnvironment ?? {}),
    getWorker: (_moduleId, label) => {
      if (label === 'json') {
        return new jsonWorker();
      }

      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }

      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }

      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }

      return new editorWorker();
    },
  };

  hasConfiguredEnvironment = true;
};

const isHTMLElement = (value: unknown): value is HTMLElement =>
  typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;

const getFindWidgetHoverControl = (target: EventTarget | null): HTMLElement | null => {
  if (!isHTMLElement(target)) {
    return null;
  }

  const control = target.closest(FIND_WIDGET_CONTROL_SELECTOR);
  return isHTMLElement(control) ? control : null;
};

const patchFindWidgetHoverDisable = (): void => {
  if (hasPatchedFindWidgetHoverDisable) {
    return;
  }

  const originalSetupDelayedHover = HoverService.prototype.setupDelayedHover;
  HoverService.prototype.setupDelayedHover = function patchedSetupDelayedHover(
    target,
    options,
    lifecycleOptions,
  ) {
    if (getFindWidgetHoverControl(target)) {
      return Disposable.None;
    }

    return originalSetupDelayedHover.call(this, target, options, lifecycleOptions);
  };

  const originalSetupDelayedHoverAtMouse = HoverService.prototype.setupDelayedHoverAtMouse;
  HoverService.prototype.setupDelayedHoverAtMouse = function patchedSetupDelayedHoverAtMouse(
    target,
    options,
    lifecycleOptions,
  ) {
    if (getFindWidgetHoverControl(target)) {
      return Disposable.None;
    }

    return originalSetupDelayedHoverAtMouse.call(this, target, options, lifecycleOptions);
  };

  hasPatchedFindWidgetHoverDisable = true;
};

const setFindWidgetHoverSuppression = (suppressed: boolean): void => {
  if (typeof document === 'undefined') {
    return;
  }

  document.body.classList.toggle(FIND_WIDGET_HOVER_SUPPRESSION_CLASS, suppressed);
};

const installFindWidgetHoverSuppression = (): void => {
  if (hasInstalledFindWidgetHoverSuppression || typeof document === 'undefined') {
    return;
  }

  let hoveredControl: HTMLElement | null = null;
  let focusedControl: HTMLElement | null = null;
  let hoveredControlReleaseTimer: number | null = null;

  const syncSuppression = (): void => {
    setFindWidgetHoverSuppression(hoveredControl !== null || focusedControl !== null);
  };

  const clearHoveredControlReleaseTimer = (): void => {
    if (hoveredControlReleaseTimer !== null) {
      window.clearTimeout(hoveredControlReleaseTimer);
      hoveredControlReleaseTimer = null;
    }
  };

  document.addEventListener(
    'mouseover',
    (event) => {
      const nextHoveredControl = getFindWidgetHoverControl(event.target);
      if (!nextHoveredControl) {
        return;
      }

      if (hoveredControl === nextHoveredControl) {
        return;
      }

      clearHoveredControlReleaseTimer();
      hoveredControl = nextHoveredControl;
      syncSuppression();
    },
    true,
  );

  document.addEventListener(
    'mouseout',
    (event) => {
      const currentControl = getFindWidgetHoverControl(event.target);
      if (!currentControl || hoveredControl !== currentControl) {
        return;
      }

      const nextControl = getFindWidgetHoverControl(event.relatedTarget);
      if (nextControl === currentControl) {
        return;
      }

      clearHoveredControlReleaseTimer();
      if (nextControl) {
        hoveredControl = nextControl;
        syncSuppression();
        return;
      }

      hoveredControlReleaseTimer = window.setTimeout(() => {
        hoveredControlReleaseTimer = null;
        hoveredControl = null;
        syncSuppression();
      }, FIND_WIDGET_HOVER_RELEASE_DELAY_MS);
    },
    true,
  );

  document.addEventListener(
    'focusin',
    (event) => {
      const nextFocusedControl = getFindWidgetHoverControl(event.target);
      if (focusedControl === nextFocusedControl) {
        return;
      }

      focusedControl = nextFocusedControl;
      syncSuppression();
    },
    true,
  );

  document.addEventListener(
    'focusout',
    () => {
      window.setTimeout(() => {
        const activeFocusedControl = getFindWidgetHoverControl(document.activeElement);
        if (focusedControl === activeFocusedControl) {
          return;
        }

        focusedControl = activeFocusedControl;
        syncSuppression();
      }, 0);
    },
    true,
  );

  hasInstalledFindWidgetHoverSuppression = true;
};

const getFileExtension = (filePath: string): string => {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const fileName = normalizedPath.split('/').filter(Boolean).at(-1) ?? normalizedPath;
  const parts = fileName.toLowerCase().split('.');
  if (parts.length < 2) {
    return '';
  }

  return parts.at(-1) ?? '';
};

export const ensureMonacoSetup = (): void => {
  configureMonacoEnvironment();
  patchFindWidgetHoverDisable();
  installFindWidgetHoverSuppression();
};

export const getMonacoLanguage = (filePath: string): string => {
  const extension = getFileExtension(filePath);

  if (extension === 'ts' || extension === 'tsx') {
    return 'typescript';
  }

  if (extension === 'js' || extension === 'jsx' || extension === 'mjs' || extension === 'cjs') {
    return 'javascript';
  }

  if (extension === 'json') {
    return 'json';
  }

  if (extension === 'go') {
    return 'go';
  }

  if (extension === 'java') {
    return 'java';
  }

  if (extension === 'kt' || extension === 'kts') {
    return 'kotlin';
  }

  if (extension === 'md') {
    return 'markdown';
  }

  if (extension === 'py') {
    return 'python';
  }

  if (extension === 'rb') {
    return 'ruby';
  }

  if (extension === 'rs') {
    return 'rust';
  }

  if (extension === 'css' || extension === 'scss' || extension === 'less') {
    return 'css';
  }

  if (extension === 'html') {
    return 'html';
  }

  if (extension === 'xml') {
    return 'xml';
  }

  if (extension === 'yml' || extension === 'yaml') {
    return 'yaml';
  }

  if (extension === 'sh' || extension === 'zsh' || extension === 'bash') {
    return 'shell';
  }

  return 'plaintext';
};
