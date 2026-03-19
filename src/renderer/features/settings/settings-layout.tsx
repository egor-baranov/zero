import * as React from 'react';
import {
  ArrowLeft,
  CircleDashed,
  ChevronDown,
  Check,
  Cog,
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
  applyUiPreferences,
  readUiPreferences,
  type AccentColorPreference,
  type UiPreferences,
  writeAccentColorPreference,
  writeThemePreference,
} from '@renderer/store/ui-preferences';

interface SettingsLayoutProps {
  onBack: () => void;
  sidebarWidth: number;
  isResizing: boolean;
  showResizeHandle: boolean;
  onStartResizing: () => void;
}

const sections = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'configuration', label: 'Configuration', icon: CircleDashed },
  { id: 'personalization', label: 'Personalization', icon: Palette },
  { id: 'mcp', label: 'MCP servers', icon: Plug },
  { id: 'git', label: 'Git', icon: GitBranch },
];

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

export const SettingsLayout = ({
  onBack,
  sidebarWidth,
  isResizing,
  showResizeHandle,
  onStartResizing,
}: SettingsLayoutProps): JSX.Element => {
  const [activeSection, setActiveSection] = React.useState(sections[0].id);
  const [uiPreferences, setUiPreferences] = React.useState<UiPreferences>(() => readUiPreferences());

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

  return (
    <section className="flex h-full min-w-0 bg-transparent">
      <aside
        style={{ width: sidebarWidth }}
        className={cn(
          'shrink-0 overflow-hidden',
          !isResizing && 'transition-[width] duration-200 ease-out',
        )}
      >
        <div className="flex h-full flex-col bg-[rgba(249,250,252,0.26)] backdrop-blur-[30px] backdrop-saturate-150">
          <div className="px-3 pt-2.5">
            <button
              type="button"
              className="no-drag mb-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-stone-600 transition-colors hover:bg-stone-200/55 hover:text-stone-900"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to app
            </button>
          </div>

          <div className="px-3 pb-1 pt-2">
            <p className="px-1 text-[12px] font-semibold tracking-[0.01em] text-stone-600">
              Settings
            </p>
          </div>

          <div className="space-y-0.5 px-2.5">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.id === activeSection;

              return (
                <button
                  key={section.id}
                  type="button"
                  className={cn(
                    'no-drag flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-stone-600 transition-colors hover:bg-stone-200/55 hover:text-stone-900',
                    isActive && 'bg-stone-200/65 text-stone-900',
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
          <span className="absolute inset-y-0 -left-3 w-6" />
        </button>
      ) : null}

      <div className="min-w-0 flex-1 overflow-y-auto bg-[#fdfdff]">
        <div className="mx-auto w-full max-w-[760px] px-6 pb-10 pt-7">
          <h2 className="text-[35px] font-semibold tracking-[-0.02em] text-stone-900">
            {sections.find((section) => section.id === activeSection)?.label ?? 'General'}
          </h2>

          <div className="mt-5 rounded-2xl border border-stone-200/80 bg-white">
            <SettingRow
              title="Default open destination"
              description="Where files and folders open by default"
              control={<PillLabel>IntelliJ IDEA</PillLabel>}
            />
            <SettingRow
              title="Language"
              description="Language for the app UI"
              control={<PillLabel>Auto Detect</PillLabel>}
            />
            <SettingRow
              title="Thread detail"
              description="Choose how much command output to show in threads"
              control={<PillLabel>Steps with code commands</PillLabel>}
            />
            <SettingRow
              title="Prevent sleep while running"
              description="Keep your computer awake while Zero is running a thread."
              control={<ToggleStub enabled={false} />}
            />
            <SettingRow
              title="Require ⌘ + enter to send long prompts"
              description="When enabled, multiline prompts require ⌘ + enter to send."
              control={<ToggleStub enabled={false} />}
            />
          </div>

          <h3 className="mt-6 text-[20px] font-semibold text-stone-900">Appearance</h3>
          <div className="mt-3 rounded-2xl border border-stone-200/80 bg-white">
            <SettingRow
              title="Theme"
              description="Use light, dark, or match your system"
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
              description="Choose the accent color for active highlights and controls."
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
            <SettingRow
              title="Use opaque window background"
              description="Make windows use a solid background rather than system translucency."
              control={<ToggleStub enabled={false} />}
            />
            <SettingRow
              title="Use pointer cursors"
              description="Change the cursor to a pointer when hovering over interactive elements."
              control={<ToggleStub enabled={false} />}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-stone-200/80 bg-white p-3">
            <div className="flex items-center gap-2 text-[13px] text-stone-600">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-stone-100 text-stone-500">
                <Cog className="h-4 w-4" />
              </span>
              Theme and accent preferences are saved locally and apply across the app.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

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

const ToggleStub = ({ enabled }: { enabled: boolean }): JSX.Element => (
  <span
    className={cn(
      'inline-flex h-6 w-10 items-center rounded-full p-0.5 transition-colors',
      enabled ? 'bg-stone-700' : 'bg-stone-200',
    )}
  >
    <span
      className={cn(
        'h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
        enabled ? 'translate-x-4' : 'translate-x-0',
      )}
    />
  </span>
);
