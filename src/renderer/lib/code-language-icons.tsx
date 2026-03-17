import { Code2, FileText } from 'lucide-react';
import {
  SiC,
  SiCplusplus,
  SiCss,
  SiGo,
  SiGnubash,
  SiHtml5,
  SiJavascript,
  SiOpenjdk,
  SiPython,
  SiRust,
  SiTypescript,
  SiYaml,
} from 'react-icons/si';

export interface LanguagePresentation {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const LANGUAGE_PRESENTATION: Record<string, LanguagePresentation> = {
  python: { label: 'Python', Icon: SiPython },
  javascript: { label: 'JavaScript', Icon: SiJavascript },
  typescript: { label: 'TypeScript', Icon: SiTypescript },
  bash: { label: 'Bash', Icon: SiGnubash },
  sh: { label: 'Shell', Icon: SiGnubash },
  json: { label: 'JSON', Icon: Code2 },
  yaml: { label: 'YAML', Icon: SiYaml },
  yml: { label: 'YAML', Icon: SiYaml },
  html: { label: 'HTML', Icon: SiHtml5 },
  css: { label: 'CSS', Icon: SiCss },
  java: { label: 'Java', Icon: SiOpenjdk },
  go: { label: 'Go', Icon: SiGo },
  rust: { label: 'Rust', Icon: SiRust },
  c: { label: 'C', Icon: SiC },
  cpp: { label: 'C++', Icon: SiCplusplus },
  markdown: { label: 'Markdown', Icon: Code2 },
};

const FILE_EXTENSION_TO_LANGUAGE: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'sh',
  bash: 'bash',
  zsh: 'sh',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  java: 'java',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  hh: 'cpp',
  md: 'markdown',
  mdx: 'markdown',
};

export const toLanguagePresentation = (language: string): LanguagePresentation => {
  const known = LANGUAGE_PRESENTATION[language];
  if (known) {
    return known;
  }

  return {
    label: language.charAt(0).toUpperCase() + language.slice(1),
    Icon: Code2,
  };
};

const getFileExtension = (fileName: string): string => {
  const parts = fileName.toLowerCase().split('.');
  if (parts.length < 2) {
    return '';
  }

  return parts.at(-1) ?? '';
};

export const toFileIconComponent = (
  fileName: string,
): React.ComponentType<{ className?: string }> => {
  const extension = getFileExtension(fileName);
  const language = FILE_EXTENSION_TO_LANGUAGE[extension];

  if (!language) {
    return FileText;
  }

  return toLanguagePresentation(language).Icon;
};
