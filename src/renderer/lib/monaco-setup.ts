import 'monaco-editor/min/vs/editor/editor.main.css';
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
