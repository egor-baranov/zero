export type SkillScope = 'system' | 'custom';

export interface SkillSummary {
  absolutePath: string;
  directoryPath: string;
  relativePath: string;
  slug: string;
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
