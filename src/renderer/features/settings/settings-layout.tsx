import * as React from 'react';
import {
  ArrowLeft,
  CircleDashed,
  ChevronDown,
  Check,
  GitBranch,
  Palette,
  Plug,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@renderer/lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import {
  onStoredNotificationsChanged,
  readStoredNotifications,
  type AppNotificationItem,
} from '@renderer/store/browser-pushes';
import type { AcpAgentPreset } from '@renderer/store/use-acp';
import { useRunConfigurations } from '@renderer/store/use-run-configurations';
import {
  applyUiPreferences,
  readUiPreferences,
  type AccentColorPreference,
  type UiPreferences,
  writeAccentColorPreference,
  writeThemePreference,
} from '@renderer/store/ui-preferences';
import { McpSettingsSection } from '@renderer/features/settings/mcp-settings-section';
import type { AcpCustomAgentConfig } from '@shared/types/acp';
import type { WorkspaceGitStatusResult } from '@shared/types/workspace';

interface SettingsLayoutProps {
  onBack: () => void;
  sidebarWidth: number;
  isResizing: boolean;
  showResizeHandle: boolean;
  onStartResizing: () => void;
  workspacePath: string;
  agentPreset: AcpAgentPreset;
  codexAgentConfig: AcpCustomAgentConfig | null;
  claudeAgentConfig: AcpCustomAgentConfig | null;
  customAgentConfig: AcpCustomAgentConfig | null;
}

const sections = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'configuration', label: 'Configuration', icon: CircleDashed },
  { id: 'personalization', label: 'Personalization', icon: Palette },
  { id: 'mcp', label: 'MCP servers', icon: Plug },
  { id: 'git', label: 'Git', icon: GitBranch },
] as const;

type SectionId = (typeof sections)[number]['id'];

interface AccentOption {
  value: AccentColorPreference;
  label: string;
  swatch: string;
}

const accentOptions: AccentOption[] = [
  { value: 'default', label: 'Default', swatch: '#a8a29e' },
  { value: 'orange', label: 'Orange', swatch: '#f97316' },
  { value: 'yellow', label: 'Yellow', swatch: '#eab308' },
  { value: 'green', label: 'Green', swatch: '#22c55e' },
  { value: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { value: 'pink', label: 'Pink', swatch: '#ec4899' },
  { value: 'purple', label: 'Purple', swatch: '#a855f7' },
  { value: 'black', label: 'Black', swatch: '#171717' },
];

const getFolderName = (folderPath: string): string =>
  folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;

const truncateText = (value: string, maxLength = 68): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}…`;

const toCountLabel = (value: number, singular: string, plural = `${singular}s`): string =>
  `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

const toCommandPreview = (config: AcpCustomAgentConfig | null): string => {
  if (!config) {
    return 'No saved command.';
  }

  const preview = [config.command, ...config.args].filter(Boolean).join(' ').trim();
  return preview.length > 0 ? truncateText(preview) : 'No saved command.';
};

const toPresetLabel = (preset: AcpAgentPreset): string => {
  if (preset === 'codex') {
    return 'Codex';
  }

  if (preset === 'claude') {
    return 'Claude Code';
  }

  if (preset === 'custom') {
    return 'Added ACP agent';
  }

  return 'Not selected';
};

const summarizeBranches = (branches: string[]): string => {
  if (branches.length === 0) {
    return 'No branches detected.';
  }

  if (branches.length <= 3) {
    return branches.join(', ');
  }

  return `${branches.slice(0, 3).join(', ')} +${branches.length - 3} more`;
};

export const SettingsLayout = ({
  onBack,
  sidebarWidth,
  isResizing,
  showResizeHandle,
  onStartResizing,
  workspacePath,
  agentPreset,
  codexAgentConfig,
  claudeAgentConfig,
  customAgentConfig,
}: SettingsLayoutProps): JSX.Element => {
  const [activeSection, setActiveSection] = React.useState<SectionId>(sections[0].id);
  const [uiPreferences, setUiPreferences] = React.useState<UiPreferences>(() => readUiPreferences());
  const [notifications, setNotifications] = React.useState<AppNotificationItem[]>(() =>
    readStoredNotifications(),
  );
  const [gitStatus, setGitStatus] = React.useState<WorkspaceGitStatusResult | null>(null);
  const [isGitStatusLoading, setIsGitStatusLoading] = React.useState(false);
  const [gitStatusError, setGitStatusError] = React.useState<string | null>(null);

  const hasWorkspace = workspacePath.trim().length > 1 && workspacePath !== '/';
  const workspaceName = hasWorkspace ? getFolderName(workspacePath) : 'No workspace';
  const {
    configurations: runConfigurations,
    selectedConfiguration,
  } = useRunConfigurations(hasWorkspace ? workspacePath : '');
  const unreadNotificationCount = notifications.filter((item) => !item.read).length;
  const latestNotification = notifications[0] ?? null;
  React.useEffect(() => {
    writeThemePreference(uiPreferences.theme);
    writeAccentColorPreference(uiPreferences.accentColor);
    applyUiPreferences(uiPreferences);

    if (uiPreferences.theme !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      applyUiPreferences(uiPreferences);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [uiPreferences]);

  React.useEffect(() => {
    setNotifications(readStoredNotifications());
    return onStoredNotificationsChanged(() => {
      setNotifications(readStoredNotifications());
    });
  }, []);

  React.useEffect(() => {
    if (activeSection !== 'git') {
      return;
    }

    if (!hasWorkspace) {
      setGitStatus(null);
      setGitStatusError(null);
      setIsGitStatusLoading(false);
      return;
    }

    let cancelled = false;
    const loadGitStatus = async (): Promise<void> => {
      setIsGitStatusLoading(true);
      setGitStatusError(null);

      try {
        const result = await window.desktop.workspaceGitStatus({ workspacePath });
        if (cancelled) {
          return;
        }

        setGitStatus(result);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setGitStatus(null);
        setGitStatusError(error instanceof Error ? error.message : 'Could not load repository state.');
      } finally {
        if (!cancelled) {
          setIsGitStatusLoading(false);
        }
      }
    };

    void loadGitStatus();

    return () => {
      cancelled = true;
    };
  }, [activeSection, hasWorkspace, workspacePath]);

  const renderGeneralSection = (): JSX.Element => (
    <>
      <SectionGroup title="Workspace">
        <SettingsCard>
          <SettingRow
            title="Workspace folder"
            description={hasWorkspace ? workspacePath : 'No workspace is open for this thread.'}
            control={<PillLabel>{workspaceName}</PillLabel>}
          />
          <SettingRow
            title="Saved run configurations"
            description="Terminal commands saved for the current workspace."
            control={<PillLabel>{toCountLabel(runConfigurations.length, 'configuration')}</PillLabel>}
          />
          <SettingRow
            title="Selected run configuration"
            description={
              selectedConfiguration
                ? truncateText(selectedConfiguration.command.replace(/\s+/g, ' '))
                : 'No run configuration is selected right now.'
            }
            control={<PillLabel>{selectedConfiguration?.name ?? 'None'}</PillLabel>}
          />
        </SettingsCard>
      </SectionGroup>

      <SectionGroup title="Notifications">
        <SettingsCard>
          <SettingRow
            title="Unread notifications"
            description="Items that still need attention in the notifications panel."
            control={<PillLabel>{toCountLabel(unreadNotificationCount, 'item')}</PillLabel>}
          />
          <SettingRow
            title="Saved notifications"
            description="Notifications currently stored in local history."
            control={<PillLabel>{toCountLabel(notifications.length, 'notification')}</PillLabel>}
          />
          <SettingRow
            title="Latest notification"
            description={
              latestNotification
                ? `${latestNotification.title} · ${latestNotification.origin}`
                : 'No notifications have been stored yet.'
            }
            control={<PillLabel>{latestNotification ? latestNotification.kind : 'None'}</PillLabel>}
          />
        </SettingsCard>
      </SectionGroup>
    </>
  );

  const renderConfigurationSection = (): JSX.Element => (
    <>
      <SectionGroup title="Agent defaults">
        <SettingsCard>
          <SettingRow
            title="Default agent"
            description="The preset used when a new agent session starts."
            control={<PillLabel>{toPresetLabel(agentPreset)}</PillLabel>}
          />
          <SettingRow
            title="Codex adapter"
            description={toCommandPreview(codexAgentConfig)}
            control={<PillLabel>{codexAgentConfig ? 'Configured' : 'Not set'}</PillLabel>}
          />
          <SettingRow
            title="Claude adapter"
            description={toCommandPreview(claudeAgentConfig)}
            control={<PillLabel>{claudeAgentConfig ? 'Configured' : 'Not set'}</PillLabel>}
          />
          <SettingRow
            title="Custom adapter"
            description={toCommandPreview(customAgentConfig)}
            control={<PillLabel>{customAgentConfig ? 'Configured' : 'Not set'}</PillLabel>}
          />
        </SettingsCard>
      </SectionGroup>
    </>
  );

  const renderPersonalizationSection = (): JSX.Element => (
    <>
      <SectionGroup title="Appearance">
        <SettingsCard>
          <SettingRow
            title="Theme"
            description="Use light, dark, or match your system."
            control={
              <div className="inline-flex items-center gap-1 rounded-full bg-stone-100 p-0.5">
                <SegmentChip
                  active={uiPreferences.theme === 'light'}
                  onClick={() => {
                    setUiPreferences((previous) => ({
                      ...previous,
                      theme: 'light',
                    }));
                  }}
                >
                  Light
                </SegmentChip>
                <SegmentChip
                  active={uiPreferences.theme === 'dark'}
                  onClick={() => {
                    setUiPreferences((previous) => ({
                      ...previous,
                      theme: 'dark',
                    }));
                  }}
                >
                  Dark
                </SegmentChip>
                <SegmentChip
                  active={uiPreferences.theme === 'system'}
                  onClick={() => {
                    setUiPreferences((previous) => ({
                      ...previous,
                      theme: 'system',
                    }));
                  }}
                >
                  System
                </SegmentChip>
              </div>
            }
          />
          <SettingRow
            title="Accent color"
            description="Choose the accent color for highlights and active controls."
            control={
              <AccentColorSelect
                value={uiPreferences.accentColor}
                onSelect={(accentColor) => {
                  setUiPreferences((previous) => ({
                    ...previous,
                    accentColor,
                  }));
                }}
              />
            }
          />
        </SettingsCard>
      </SectionGroup>
    </>
  );

  const renderMcpSection = (): JSX.Element => <McpSettingsSection />;

  const renderGitSection = (): JSX.Element => {
    if (!hasWorkspace) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Workspace folder"
              description="Open a workspace to inspect repository status here."
              control={<PillLabel>Not opened</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    if (isGitStatusLoading) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Repository status"
              description="Loading the current workspace repository details."
              control={<PillLabel>Loading…</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    if (gitStatusError) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Repository status"
              description={gitStatusError}
              control={<PillLabel>Error</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    if (!gitStatus?.available) {
      return (
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Repository"
              description="Current workspace is not a git repository."
              control={<PillLabel>No repo</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      );
    }

    return (
      <>
        <SectionGroup title="Repository">
          <SettingsCard>
            <SettingRow
              title="Current branch"
              description="The branch checked out for this workspace."
              control={<PillLabel>{gitStatus.currentBranch ?? 'Detached'}</PillLabel>}
            />
            <SettingRow
              title="Local branches"
              description={summarizeBranches(gitStatus.localBranches)}
              control={<PillLabel>{toCountLabel(gitStatus.localBranches.length, 'branch')}</PillLabel>}
            />
            <SettingRow
              title="Remote branches"
              description={summarizeBranches(gitStatus.remoteBranches)}
              control={<PillLabel>{toCountLabel(gitStatus.remoteBranches.length, 'branch')}</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>

        <SectionGroup title="Working tree">
          <SettingsCard>
            <SettingRow
              title="Changed files"
              description="Files with local modifications in the working tree."
              control={<PillLabel>{toCountLabel(gitStatus.uncommittedFiles, 'file')}</PillLabel>}
            />
            <SettingRow
              title="Added lines"
              description="Total added lines across current uncommitted changes."
              control={<PillLabel>{gitStatus.additions.toLocaleString()}</PillLabel>}
            />
            <SettingRow
              title="Deleted lines"
              description="Total deleted lines across current uncommitted changes."
              control={<PillLabel>{gitStatus.deletions.toLocaleString()}</PillLabel>}
            />
          </SettingsCard>
        </SectionGroup>
      </>
    );
  };

  const renderSectionContent = (): JSX.Element => {
    if (activeSection === 'general') {
      return renderGeneralSection();
    }

    if (activeSection === 'configuration') {
      return renderConfigurationSection();
    }

    if (activeSection === 'personalization') {
      return renderPersonalizationSection();
    }

    if (activeSection === 'mcp') {
      return renderMcpSection();
    }

    return renderGitSection();
  };

  return (
    <section className="flex h-full min-w-0 bg-transparent">
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          'shrink-0 overflow-hidden',
          !isResizing && 'transition-[width] duration-200 ease-out',
        )}
      >
        <div className="flex h-full flex-col border-r border-stone-200/55 bg-[rgba(249,250,252,0.06)] backdrop-blur-[4px] backdrop-saturate-125">
          <div className="px-3 pt-2.5">
            <button
              type="button"
              className="zeroade-sidebar-hover-shadow no-drag mb-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-stone-600 transition-colors hover:bg-white/55 hover:text-stone-900"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to app
            </button>
          </div>

          <div className="space-y-0.5 px-2.5 pt-2">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeSection;

              return (
                <button
                  key={section.id}
                  type="button"
                  className={cn(
                    'zeroade-sidebar-hover-shadow no-drag flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-stone-600 transition-colors hover:bg-white/55 hover:text-stone-900',
                    isActive && 'bg-white/45 text-stone-900',
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {showResizeHandle ? (
        <button
          type="button"
          aria-label="Resize settings sidebar"
          className="no-drag relative w-0 cursor-col-resize"
          onPointerDown={onStartResizing}
        >
          <span className="absolute inset-y-0 -left-5 w-10" />
        </button>
      ) : null}

      <div className="min-w-0 flex-1 overflow-y-auto bg-[#fdfdff]">
        <div className="mx-auto w-full max-w-[760px] px-6 pb-10 pt-7">
          <h2 className="text-[35px] font-semibold tracking-[-0.02em] text-stone-900">
            {sections.find((section) => section.id === activeSection)?.label ?? 'General'}
          </h2>

          <div className="mt-5">{renderSectionContent()}</div>
        </div>
      </div>
    </section>
  );
};

interface SectionGroupProps {
  title: string;
  children: React.ReactNode;
}

const SectionGroup = ({ title, children }: SectionGroupProps): JSX.Element => (
  <section className="mt-6 first:mt-0">
    <h3 className="text-[20px] font-semibold text-stone-900">{title}</h3>
    <div className="mt-3">{children}</div>
  </section>
);

const SettingsCard = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <div className="rounded-2xl border border-stone-200/80 bg-white">{children}</div>
);

interface SettingRowProps {
  title: string;
  description: string;
  control: React.ReactNode;
}

const SettingRow = ({ title, description, control }: SettingRowProps): JSX.Element => {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-stone-200/75 px-3 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-stone-800">{title}</p>
        <p className="mt-0.5 text-[13px] text-stone-500">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
};

const PillLabel = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <span className="inline-flex h-8 items-center rounded-full bg-stone-100 px-3 text-[13px] text-stone-700">
    {children}
  </span>
);

interface SegmentChipProps {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}

const SegmentChip = ({ children, active = false, onClick }: SegmentChipProps): JSX.Element => {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-7 items-center rounded-full px-2.5 text-[12px] text-stone-600 transition-colors',
        active && 'settings-segment-chip-active shadow-sm',
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

interface AccentColorSelectProps {
  value: AccentColorPreference;
  onSelect: (value: AccentColorPreference) => void;
}

const AccentColorSelect = ({ value, onSelect }: AccentColorSelectProps): JSX.Element => {
  const activeOption = accentOptions.find((option) => option.value === value) ?? accentOptions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="no-drag inline-flex h-8 items-center gap-2 rounded-full border border-stone-200 bg-white pl-2 pr-2.5 text-[13px] text-stone-700 transition-colors hover:bg-stone-50"
          aria-label="Select accent color"
        >
          <span
            className="h-4 w-4 rounded-full border border-black/10"
            style={{ backgroundColor: activeOption.swatch }}
          />
          <span>{activeOption.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[230px] rounded-[22px] p-2">
        {accentOptions.map((option) => {
          const isSelected = option.value === value;

          return (
            <DropdownMenuItem
              key={option.value}
              className={cn(
                'min-h-11 rounded-[14px] px-3 text-[15px]',
                isSelected && 'bg-stone-100/85',
              )}
              onSelect={() => {
                onSelect(option.value);
              }}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center">
                <Check className={cn('h-4 w-4 text-stone-900', !isSelected && 'opacity-0')} />
              </span>
              <span
                className="mr-3 h-5 w-5 rounded-full border border-black/10"
                style={{ backgroundColor: option.swatch }}
              />
              <span>{option.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
