import { type Dirent, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  SkillSummary,
  SkillsDeleteRequest,
  SkillsDeleteResult,
  SkillsListResult,
  SkillsReadRequest,
  SkillsReadResult,
  SkillsWriteRequest,
  SkillsWriteResult,
} from '@shared/types/skills';

const SKILL_FILE_NAME = 'SKILL.md';
const SYSTEM_SKILLS_DIRECTORY = '.system';

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');

const toResolvedCodexHome = (): string => {
  const configured = process.env.CODEX_HOME?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.join(os.homedir(), '.codex');
};

const toSafeSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

const extractSkillTitle = (content: string, fallback: string): string => {
  const lines = normalizeLineEndings(content).split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^#\s+(.+)$/);
    if (headingMatch?.[1]) {
      return headingMatch[1].trim();
    }
  }

  return fallback;
};

const extractSkillDescription = (content: string): string => {
  const lines = normalizeLineEndings(content).split('\n');
  const paragraphs: string[] = [];
  let collecting = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!collecting) {
      if (!line || line.startsWith('#')) {
        continue;
      }

      collecting = true;
      paragraphs.push(line);
      continue;
    }

    if (!line) {
      break;
    }

    if (line.startsWith('#')) {
      break;
    }

    paragraphs.push(line);
  }

  return paragraphs.join(' ').trim();
};

const ensureStartsWithPath = (rootPath: string, candidatePath: string): void => {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);

  if (
    normalizedCandidate !== normalizedRoot &&
    !normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error('Path is outside of skills directory');
  }
};

const readDirectoryEntries = async (directoryPath: string): Promise<Dirent[]> => {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException | undefined;
    if (failure?.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

export class SkillsService {
  private readonly codexHome = toResolvedCodexHome();
  private readonly skillsRoot = path.join(this.codexHome, 'skills');
  private readonly systemSkillsRoot = path.join(this.skillsRoot, SYSTEM_SKILLS_DIRECTORY);

  private async collectSkillFilePaths(
    directoryPath: string,
    filePaths: string[],
  ): Promise<void> {
    const entries = await readDirectoryEntries(directoryPath);
    if (entries.length === 0) {
      return;
    }

    const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === SKILL_FILE_NAME);
    if (hasSkillFile) {
      filePaths.push(path.join(directoryPath, SKILL_FILE_NAME));
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }

      if (entry.name.startsWith('.') && directoryPath !== this.skillsRoot) {
        continue;
      }

      await this.collectSkillFilePaths(path.join(directoryPath, entry.name), filePaths);
    }
  }

  private async toSkillSummary(skillFilePath: string): Promise<SkillSummary> {
    const absolutePath = path.resolve(skillFilePath);
    ensureStartsWithPath(this.skillsRoot, absolutePath);

    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ]);

    const directoryPath = path.dirname(absolutePath);
    const relativePath = path.relative(this.skillsRoot, absolutePath).split(path.sep).join('/');
    const slug = path.relative(this.skillsRoot, directoryPath).split(path.sep).join('/');
    const scope = absolutePath.startsWith(`${this.systemSkillsRoot}${path.sep}`) ? 'system' : 'custom';
    const fallbackName = path.basename(directoryPath);

    return {
      absolutePath,
      directoryPath,
      relativePath,
      slug,
      name: extractSkillTitle(content, fallbackName),
      description: extractSkillDescription(content) || 'No description provided.',
      scope,
      readOnly: scope === 'system',
      updatedAtMs: stat.mtimeMs,
    };
  }

  private ensureSkillFilePath(absolutePath: string): string {
    const normalizedPath = path.resolve(absolutePath);
    ensureStartsWithPath(this.skillsRoot, normalizedPath);

    if (path.basename(normalizedPath) !== SKILL_FILE_NAME) {
      throw new Error('Skill file must point to SKILL.md');
    }

    return normalizedPath;
  }

  private ensureCustomSkillFilePath(absolutePath: string): string {
    const normalizedPath = this.ensureSkillFilePath(absolutePath);

    if (
      normalizedPath === this.systemSkillsRoot ||
      normalizedPath.startsWith(`${this.systemSkillsRoot}${path.sep}`)
    ) {
      throw new Error('Built-in skills are read-only');
    }

    return normalizedPath;
  }

  public async list(): Promise<SkillsListResult> {
    await fs.mkdir(this.skillsRoot, { recursive: true });

    const skillFilePaths: string[] = [];
    await this.collectSkillFilePaths(this.skillsRoot, skillFilePaths);

    const skills = await Promise.all(skillFilePaths.map((skillFilePath) => this.toSkillSummary(skillFilePath)));
    skills.sort((left, right) => {
      if (left.scope !== right.scope) {
        return left.scope === 'custom' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

    return {
      skillsRoot: this.skillsRoot,
      skills,
    };
  }

  public async read(request: SkillsReadRequest): Promise<SkillsReadResult> {
    const absolutePath = this.ensureSkillFilePath(request.absolutePath);
    const [skill, content] = await Promise.all([
      this.toSkillSummary(absolutePath),
      fs.readFile(absolutePath, 'utf8'),
    ]);

    return {
      skill,
      content,
    };
  }

  public async write(request: SkillsWriteRequest): Promise<SkillsWriteResult> {
    const content = normalizeLineEndings(request.content).trim();
    if (!content) {
      throw new Error('Skill content cannot be empty');
    }

    let absolutePath: string;
    let created = false;

    if (request.absolutePath) {
      absolutePath = this.ensureCustomSkillFilePath(request.absolutePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    } else {
      const slug = toSafeSlug(request.slug ?? '');
      if (!slug) {
        throw new Error('Skill folder name is required');
      }

      if (slug === SYSTEM_SKILLS_DIRECTORY || slug.startsWith(`${SYSTEM_SKILLS_DIRECTORY}/`)) {
        throw new Error('Skill folder name is reserved');
      }

      const directoryPath = path.join(this.skillsRoot, slug);
      ensureStartsWithPath(this.skillsRoot, directoryPath);
      absolutePath = path.join(directoryPath, SKILL_FILE_NAME);

      try {
        await fs.stat(absolutePath);
        throw new Error('A skill with that folder name already exists');
      } catch (error) {
        const failure = error as NodeJS.ErrnoException | undefined;
        if (failure?.code !== 'ENOENT') {
          throw error;
        }
      }

      await fs.mkdir(directoryPath, { recursive: true });
      created = true;
    }

    await fs.writeFile(absolutePath, `${content}\n`, 'utf8');

    return {
      skill: await this.toSkillSummary(absolutePath),
      created,
    };
  }

  public async delete(request: SkillsDeleteRequest): Promise<SkillsDeleteResult> {
    const absolutePath = this.ensureCustomSkillFilePath(request.absolutePath);
    const directoryPath = path.dirname(absolutePath);
    ensureStartsWithPath(this.skillsRoot, directoryPath);

    if (!directoryPath || directoryPath === this.skillsRoot) {
      throw new Error('Cannot delete the skills root');
    }

    await fs.rm(directoryPath, {
      recursive: true,
      force: false,
    });

    return {
      deleted: true,
    };
  }
}
