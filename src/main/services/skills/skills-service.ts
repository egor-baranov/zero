import { spawn, spawnSync } from 'node:child_process';
import { type Dirent, promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type {
  SkillSummary,
  SkillsCatalogDetailRequest,
  SkillsCatalogDetailResult,
  SkillsCatalogEntry,
  SkillsCatalogResult,
  SkillsDeleteRequest,
  SkillsDeleteResult,
  SkillsInstallRequest,
  SkillsInstallResult,
  SkillsListResult,
  SkillsReadRequest,
  SkillsReadResult,
  SkillsWriteRequest,
  SkillsWriteResult,
} from '@shared/types/skills';

const SKILL_FILE_NAME = 'SKILL.md';
const SYSTEM_SKILLS_DIRECTORY = '.system';
const SKILLS_SITE_URL = 'https://skills.sh';
const SKILLS_SITEMAP_URL = `${SKILLS_SITE_URL}/sitemap.xml`;
const REMOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const SKILL_ICON_FILE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.ico',
  '.avif',
]);

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");

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

const isSkillIconFile = (entryPath: string): boolean =>
  SKILL_ICON_FILE_EXTENSIONS.has(path.extname(entryPath).toLowerCase());

const toRepositoryUrl = (source: string): string => `https://github.com/${source}`;

const toInstallCommand = (repositoryUrl: string, skillId: string): string =>
  `npx skills add ${repositoryUrl} --skill ${skillId}`;

const toCatalogInstallMap = (html: string): Map<string, number> => {
  const installsBySkill = new Map<string, number>();
  const matches = html.matchAll(
    /\\"source\\":\\"([^\\]+)\\",\\"skillId\\":\\"([^\\]+)\\",\\"name\\":\\"([^\\]+)\\",\\"installs\\":(\d+)/g,
  );

  for (const match of matches) {
    const source = match[1]?.trim();
    const skillId = match[2]?.trim();
    const installsCount = Number(match[4]);
    if (!source || !skillId || !Number.isFinite(installsCount)) {
      continue;
    }

    installsBySkill.set(`${source}/${skillId}`.toLowerCase(), installsCount);
  }

  return installsBySkill;
};

const toEntryFromSkillPath = (
  skillPath: string,
  installsCount: number | null,
): SkillsCatalogEntry | null => {
  const normalizedPath = skillPath.trim().replace(/^\/+|\/+$/g, '');
  const parts = normalizedPath.split('/').filter(Boolean);

  if (parts.length !== 3) {
    return null;
  }

  const [owner, repo, skillId] = parts;
  if (!owner || !repo || !skillId) {
    return null;
  }

  const source = `${owner}/${repo}`;
  const repositoryUrl = toRepositoryUrl(source);

  return {
    source,
    owner,
    repo,
    skillId,
    name: skillId,
    installsCount,
    pageUrl: `${SKILLS_SITE_URL}/${owner}/${repo}/${skillId}`,
    repositoryUrl,
    installCommand: toInstallCommand(repositoryUrl, skillId),
  };
};

export class SkillsService {
  private readonly codexHome = toResolvedCodexHome();
  private readonly skillsRoot = path.join(this.codexHome, 'skills');
  private readonly systemSkillsRoot = path.join(this.skillsRoot, SYSTEM_SKILLS_DIRECTORY);
  private catalogCache:
    | {
        expiresAtMs: number;
        result: SkillsCatalogResult;
      }
    | null = null;
  private readonly catalogDetailCache = new Map<
    string,
    {
      expiresAtMs: number;
      result: SkillsCatalogDetailResult;
    }
  >();

  private async readTextUrl(urlValue: string, redirectCount = 0): Promise<string> {
    if (redirectCount > 5) {
      throw new Error('Too many redirects while loading skills catalog.');
    }

    const targetUrl = new URL(urlValue);
    const client = targetUrl.protocol === 'http:' ? http : https;

    return await new Promise<string>((resolve, reject) => {
      const request = client.get(
        targetUrl,
        {
          headers: {
            'user-agent': 'Zero Skills Browser',
            accept: 'text/html,application/xml;q=0.9,*/*;q=0.8',
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          const location = response.headers.location;

          if (
            location &&
            statusCode >= 300 &&
            statusCode < 400
          ) {
            response.resume();
            const redirectUrl = new URL(location, targetUrl).toString();
            void this.readTextUrl(redirectUrl, redirectCount + 1).then(resolve, reject);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            reject(new Error(`skills.sh request failed with status ${statusCode}.`));
            return;
          }

          response.setEncoding('utf8');
          let body = '';

          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => {
            resolve(body);
          });
        },
      );

      request.on('error', (error) => {
        reject(error);
      });
    });
  }

  private toCatalogEntries(
    sitemapXml: string,
    installsBySkill: Map<string, number>,
  ): SkillsCatalogEntry[] {
    const entries = [...sitemapXml.matchAll(/<loc>https:\/\/skills\.sh\/([^<]+)<\/loc>/g)];
    const seen = new Set<string>();
    const skills: SkillsCatalogEntry[] = [];

    for (const entry of entries) {
      const skillPath = entry[1] ?? '';
      const normalizedPath = skillPath.trim().replace(/^\/+|\/+$/g, '');
      const parts = normalizedPath.split('/').filter(Boolean);
      const installsCount =
        parts.length === 3
          ? installsBySkill.get(`${parts[0]}/${parts[1]}/${parts[2]}`.toLowerCase()) ?? null
          : null;
      const catalogEntry = toEntryFromSkillPath(skillPath, installsCount);
      if (!catalogEntry) {
        continue;
      }

      const dedupeKey = `${catalogEntry.source}/${catalogEntry.skillId}`.toLowerCase();
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      skills.push(catalogEntry);
    }

    return skills;
  }

  private parseCatalogDetail(
    html: string,
    fallbackSkill: SkillsCatalogEntry,
  ): SkillsCatalogDetailResult {
    const installMatch = html.match(
      /npx skills add (https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+) --skill ([A-Za-z0-9._-]+)/,
    );
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const summaryMatch = html.match(/<div class="prose[^"]*"><p><strong>([^<]+)<\/strong><\/p>/);
    const installsMatch = html.match(
      /Weekly Installs[\s\S]*?<div class="text-3xl[^"]*">([^<]+)<\/div>/,
    );
    const repositoryMatch = html.match(
      /href="(https:\/\/github\.com\/[A-Za-z0-9._/-]+)"[^>]*title="([A-Za-z0-9._/-]+)"/,
    );

    const repositoryUrl = installMatch?.[1] ?? repositoryMatch?.[1] ?? fallbackSkill.repositoryUrl;
    const source = repositoryUrl.replace(/^https:\/\/github\.com\//, '').replace(/\/+$/g, '');
    const sourceParts = source.split('/');
    const skillId = installMatch?.[2] ?? fallbackSkill.skillId;
    const nextSkill =
      sourceParts.length === 2
        ? {
            source,
            owner: sourceParts[0] ?? fallbackSkill.owner,
            repo: sourceParts[1] ?? fallbackSkill.repo,
            skillId,
            name: decodeHtmlEntities(titleMatch?.[1] ?? fallbackSkill.name),
            installsCount: fallbackSkill.installsCount,
            pageUrl: fallbackSkill.pageUrl,
            repositoryUrl,
            installCommand: toInstallCommand(repositoryUrl, skillId),
          }
        : fallbackSkill;

    return {
      skill: nextSkill,
      summary: summaryMatch?.[1] ? decodeHtmlEntities(summaryMatch[1].trim()) : null,
      weeklyInstalls: installsMatch?.[1] ? decodeHtmlEntities(installsMatch[1].trim()) : null,
    };
  }

  private resolveCommandOnLoginShell(command: string): string | null {
    if (process.platform === 'win32') {
      return null;
    }

    const shellPath = process.env.SHELL?.trim() || '/bin/zsh';
    try {
      const result = spawnSync(shellPath, ['-lc', `command -v '${command.replace(/'/g, `'\\''`)}'`], {
        encoding: 'utf8',
      });
      if (result.status !== 0) {
        return null;
      }

      const resolved = result.stdout.trim().split('\n').pop()?.trim();
      return resolved || null;
    } catch {
      return null;
    }
  }

  private toNpmExecArgsFromNpxArgs(args: string[]): string[] | null {
    const remainingArgs = [...args];
    let includeYes = false;

    while (remainingArgs[0] === '-y' || remainingArgs[0] === '--yes') {
      includeYes = true;
      remainingArgs.shift();
    }

    const packageName = remainingArgs.shift();
    if (!packageName) {
      return null;
    }

    const npmExecArgs = ['exec'];
    if (includeYes) {
      npmExecArgs.push('--yes');
    }
    npmExecArgs.push(packageName);

    if (remainingArgs.length > 0) {
      npmExecArgs.push('--', ...remainingArgs);
    }

    return npmExecArgs;
  }

  private async runCommand(command: string, args: string[]): Promise<void> {
    await fs.mkdir(this.codexHome, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.codexHome,
        env: {
          ...process.env,
          CODEX_HOME: this.codexHome,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      let stdout = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const output = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        reject(
          new Error(output || `Skills install command exited with code ${code ?? 'unknown'}.`),
        );
      });
    });
  }

  private async runSkillsInstallCommand(args: string[]): Promise<void> {
    const resolvedNpx =
      (process.platform === 'win32' ? 'npx.cmd' : null) ??
      this.resolveCommandOnLoginShell('npx') ??
      'npx';

    try {
      await this.runCommand(resolvedNpx, args);
      return;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException | undefined;
      if (failure?.code !== 'ENOENT') {
        throw error;
      }
    }

    const resolvedNpm =
      (process.platform === 'win32' ? 'npm.cmd' : null) ??
      this.resolveCommandOnLoginShell('npm') ??
      'npm';
    const npmExecArgs = this.toNpmExecArgsFromNpxArgs(args);
    if (!npmExecArgs) {
      throw new Error('Could not resolve an install command for skills.sh.');
    }

    await this.runCommand(resolvedNpm, npmExecArgs);
  }

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

  private async findFirstImageInDirectory(directoryPath: string): Promise<string | null> {
    const entries = await readDirectoryEntries(directoryPath);
    if (entries.length === 0) {
      return null;
    }

    const prioritizedFiles = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directoryPath, entry.name))
      .filter(isSkillIconFile)
      .sort((left, right) => {
        const leftName = path.basename(left).toLowerCase();
        const rightName = path.basename(right).toLowerCase();
        const leftPriority = leftName.startsWith('icon.') ? 0 : 1;
        const rightPriority = rightName.startsWith('icon.') ? 0 : 1;

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return leftName.localeCompare(rightName);
      });

    if (prioritizedFiles[0]) {
      return prioritizedFiles[0];
    }

    const childDirectories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(directoryPath, entry.name))
      .sort((left, right) => left.localeCompare(right));

    for (const childDirectory of childDirectories) {
      const nestedImage = await this.findFirstImageInDirectory(childDirectory);
      if (nestedImage) {
        return nestedImage;
      }
    }

    return null;
  }

  private async findSkillIconPath(directoryPath: string): Promise<string | null> {
    const candidateDirectories = ['resources', 'assets'].map((segment) =>
      path.join(directoryPath, segment),
    );

    for (const candidateDirectory of candidateDirectories) {
      const imagePath = await this.findFirstImageInDirectory(candidateDirectory);
      if (imagePath) {
        return imagePath;
      }
    }

    return null;
  }

  private async toSkillSummary(skillFilePath: string): Promise<SkillSummary> {
    const absolutePath = path.resolve(skillFilePath);
    ensureStartsWithPath(this.skillsRoot, absolutePath);

    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf8'),
      fs.stat(absolutePath),
    ]);

    const directoryPath = path.dirname(absolutePath);
    const iconAbsolutePath = await this.findSkillIconPath(directoryPath);
    const relativePath = path.relative(this.skillsRoot, absolutePath).split(path.sep).join('/');
    const slug = path.relative(this.skillsRoot, directoryPath).split(path.sep).join('/');
    const scope = absolutePath.startsWith(`${this.systemSkillsRoot}${path.sep}`) ? 'system' : 'custom';
    const fallbackName = path.basename(directoryPath);

    return {
      absolutePath,
      directoryPath,
      relativePath,
      slug,
      iconAbsolutePath,
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

  public async catalog(): Promise<SkillsCatalogResult> {
    if (this.catalogCache && this.catalogCache.expiresAtMs > Date.now()) {
      return this.catalogCache.result;
    }

    const [sitemapXml, homepageHtml] = await Promise.all([
      this.readTextUrl(SKILLS_SITEMAP_URL),
      this.readTextUrl(SKILLS_SITE_URL),
    ]);
    const installsBySkill = toCatalogInstallMap(homepageHtml);
    const result: SkillsCatalogResult = {
      catalogUrl: SKILLS_SITE_URL,
      total: 0,
      skills: this.toCatalogEntries(sitemapXml, installsBySkill),
    };
    result.total = result.skills.length;

    this.catalogCache = {
      expiresAtMs: Date.now() + REMOTE_CACHE_TTL_MS,
      result,
    };

    return result;
  }

  public async catalogDetail(
    request: SkillsCatalogDetailRequest,
  ): Promise<SkillsCatalogDetailResult> {
    const pageUrl = request.pageUrl.trim();
    if (!pageUrl.startsWith(SKILLS_SITE_URL)) {
      throw new Error('Skills details must come from skills.sh.');
    }

    const cached = this.catalogDetailCache.get(pageUrl);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.result;
    }

    const url = new URL(pageUrl);
    const fallbackSkill = toEntryFromSkillPath(url.pathname, null) ?? (() => {
      throw new Error('Unsupported skills.sh entry.');
    })();
    const html = await this.readTextUrl(pageUrl);
    const result = this.parseCatalogDetail(html, fallbackSkill);

    this.catalogDetailCache.set(pageUrl, {
      expiresAtMs: Date.now() + REMOTE_CACHE_TTL_MS,
      result,
    });

    return result;
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

  public async install(request: SkillsInstallRequest): Promise<SkillsInstallResult> {
    const source = request.source.trim().replace(/^\/+|\/+$/g, '');
    const skillId = request.skillId.trim().replace(/^\/+|\/+$/g, '');
    const repositoryUrl = (request.repositoryUrl?.trim() || toRepositoryUrl(source)).replace(/\/+$/g, '');

    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(source)) {
      throw new Error('Unsupported skills.sh source.');
    }

    if (!/^[A-Za-z0-9._-]+$/.test(skillId)) {
      throw new Error('Unsupported skills.sh skill id.');
    }

    if (!repositoryUrl.startsWith('https://github.com/')) {
      throw new Error('Skills installs currently require a GitHub repository URL.');
    }

    const cliArgs = ['--yes', 'skills', 'add', repositoryUrl, '--skill', skillId];
    await this.runSkillsInstallCommand(cliArgs);

    return {
      source,
      skillId,
      repositoryUrl,
      command: toInstallCommand(repositoryUrl, skillId),
    };
  }
}
