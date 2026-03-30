export type SkillScope = 'system' | 'custom';

export interface SkillSummary {
  absolutePath: string;
  directoryPath: string;
  relativePath: string;
  slug: string;
  iconAbsolutePath: string | null;
  name: string;
  description: string;
  scope: SkillScope;
  readOnly: boolean;
  updatedAtMs: number;
}

export interface SkillsListResult {
  skillsRoot: string;
  skills: SkillSummary[];
}

export interface SkillsCatalogEntry {
  source: string;
  owner: string;
  repo: string;
  skillId: string;
  name: string;
  installsCount: number | null;
  pageUrl: string;
  repositoryUrl: string;
  installCommand: string;
}

export interface SkillsCatalogResult {
  catalogUrl: string;
  total: number;
  skills: SkillsCatalogEntry[];
}

export interface SkillsCatalogDetailRequest {
  pageUrl: string;
}

export interface SkillsCatalogDetailResult {
  skill: SkillsCatalogEntry;
  summary: string | null;
  weeklyInstalls: string | null;
}

export interface SkillsReadRequest {
  absolutePath: string;
}

export interface SkillsReadResult {
  skill: SkillSummary;
  content: string;
}

export interface SkillsWriteRequest {
  absolutePath?: string;
  slug?: string;
  content: string;
}

export interface SkillsWriteResult {
  skill: SkillSummary;
  created: boolean;
}

export interface SkillsDeleteRequest {
  absolutePath: string;
}

export interface SkillsDeleteResult {
  deleted: boolean;
}

export interface SkillsInstallRequest {
  source: string;
  skillId: string;
  repositoryUrl?: string;
}

export interface SkillsInstallResult {
  source: string;
  skillId: string;
  repositoryUrl: string;
  command: string;
}
