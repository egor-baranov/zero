import * as React from 'react';
import { Code2, FileText } from 'lucide-react';
import { FaJava } from 'react-icons/fa6';
import {
  SiC,
  SiCplusplus,
  SiCss,
  SiGo,
  SiGnubash,
  SiHtml5,
  SiJavascript,
  SiKotlin,
  SiPython,
  SiRust,
  SiTypescript,
  SiYaml,
} from 'react-icons/si';
import { cn } from '@renderer/lib/cn';
import bashOriginal from '@renderer/assets/devicon/bash-original.svg';
import cOriginal from '@renderer/assets/devicon/c-original.svg';
import cppOriginal from '@renderer/assets/devicon/cplusplus-original.svg';
import cssOriginal from '@renderer/assets/devicon/css3-original.svg';
import goOriginal from '@renderer/assets/devicon/go-original.svg';
import htmlOriginal from '@renderer/assets/devicon/html5-original.svg';
import javaOriginal from '@renderer/assets/devicon/java-original.svg';
import javascriptOriginal from '@renderer/assets/devicon/javascript-original.svg';
import jsonOriginal from '@renderer/assets/devicon/json-original.svg';
import kotlinOriginal from '@renderer/assets/devicon/kotlin-original.svg';
import markdownOriginal from '@renderer/assets/devicon/markdown-original.svg';
import pythonOriginal from '@renderer/assets/devicon/python-original.svg';
import rustOriginal from '@renderer/assets/devicon/rust-original.svg';
import typescriptOriginal from '@renderer/assets/devicon/typescript-original.svg';
import yamlOriginal from '@renderer/assets/devicon/yaml-original.svg';

interface IconProps {
  className?: string;
}

export interface LanguagePresentation {
  label: string;
  Icon: React.ComponentType<IconProps>;
}

type IconComponent = React.ComponentType<IconProps>;

const subscribeToUiPreferences = (callback: () => void): (() => void) => {
  window.addEventListener('zeroade-ui-preferences-changed', callback);
  return () => {
    window.removeEventListener('zeroade-ui-preferences-changed', callback);
  };
};

const readMonochromeLanguageIconsPreference = (): boolean =>
  document.documentElement.dataset.zeroadeMonochromeLanguageIcons !== 'false';

const useMonochromeLanguageIcons = (): boolean =>
  React.useSyncExternalStore(
    subscribeToUiPreferences,
    readMonochromeLanguageIconsPreference,
    () => true,
  );

const createDeviconImage = (src: string): IconComponent => {
  const DeviconImage = ({ className }: IconProps): JSX.Element => (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('zeroade-language-icon-image object-contain', className)}
    />
  );

  return DeviconImage;
};

const createAdaptiveLanguageIcon = (
  MonochromeIcon: IconComponent,
  coloredSrc?: string,
): IconComponent => {
  const ColoredIcon = coloredSrc ? createDeviconImage(coloredSrc) : MonochromeIcon;

  const AdaptiveIcon = ({ className }: IconProps): JSX.Element => {
    const monochromeLanguageIcons = useMonochromeLanguageIcons();
    const Icon = monochromeLanguageIcons ? MonochromeIcon : ColoredIcon;
    return <Icon className={className} />;
  };

  return AdaptiveIcon;
};

const LANGUAGE_PRESENTATION: Record<string, LanguagePresentation> = {
  python: {
    label: 'Python',
    Icon: createAdaptiveLanguageIcon(SiPython, pythonOriginal),
  },
  javascript: {
    label: 'JavaScript',
    Icon: createAdaptiveLanguageIcon(SiJavascript, javascriptOriginal),
  },
  typescript: {
    label: 'TypeScript',
    Icon: createAdaptiveLanguageIcon(SiTypescript, typescriptOriginal),
  },
  bash: {
    label: 'Bash',
    Icon: createAdaptiveLanguageIcon(SiGnubash, bashOriginal),
  },
  sh: {
    label: 'Shell',
    Icon: createAdaptiveLanguageIcon(SiGnubash, bashOriginal),
  },
  json: {
    label: 'JSON',
    Icon: createAdaptiveLanguageIcon(Code2, jsonOriginal),
  },
  yaml: {
    label: 'YAML',
    Icon: createAdaptiveLanguageIcon(SiYaml, yamlOriginal),
  },
  yml: {
    label: 'YAML',
    Icon: createAdaptiveLanguageIcon(SiYaml, yamlOriginal),
  },
  html: {
    label: 'HTML',
    Icon: createAdaptiveLanguageIcon(SiHtml5, htmlOriginal),
  },
  css: {
    label: 'CSS',
    Icon: createAdaptiveLanguageIcon(SiCss, cssOriginal),
  },
  java: {
    label: 'Java',
    Icon: createAdaptiveLanguageIcon(FaJava, javaOriginal),
  },
  kotlin: {
    label: 'Kotlin',
    Icon: createAdaptiveLanguageIcon(SiKotlin, kotlinOriginal),
  },
  go: {
    label: 'Go',
    Icon: createAdaptiveLanguageIcon(SiGo, goOriginal),
  },
  rust: {
    label: 'Rust',
    Icon: createAdaptiveLanguageIcon(SiRust, rustOriginal),
  },
  c: {
    label: 'C',
    Icon: createAdaptiveLanguageIcon(SiC, cOriginal),
  },
  cpp: {
    label: 'C++',
    Icon: createAdaptiveLanguageIcon(SiCplusplus, cppOriginal),
  },
  markdown: {
    label: 'Markdown',
    Icon: createAdaptiveLanguageIcon(Code2, markdownOriginal),
  },
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
  kt: 'kotlin',
  kts: 'kotlin',
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
