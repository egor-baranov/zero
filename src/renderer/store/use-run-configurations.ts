import * as React from 'react';

const RUN_CONFIGURATIONS_STORAGE_KEY = 'zeroade.run.configurations.v2';
const EMPTY_WORKSPACE_KEY = '__empty_workspace__';

export interface RunConfigurationRecord {
  id: string;
  name: string;
  command: string;
  updatedAtMs: number;
}

interface WorkspaceRunConfigurationState {
  selectedConfigurationId: string;
  configurations: RunConfigurationRecord[];
}

type PersistedRunConfigurationState = Record<string, WorkspaceRunConfigurationState>;

const toWorkspaceStorageKey = (workspacePath: string): string => {
  const normalized = workspacePath.trim();
  return normalized.length > 0 ? normalized : EMPTY_WORKSPACE_KEY;
};

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizeCommand = (value: string): string =>
  value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

const toDefaultConfigurationName = (
  command: string,
  existingCount: number,
): string => {
  const firstLine = normalizeText(command.split('\n')[0] ?? '');
  if (firstLine.length > 0) {
    return firstLine.length <= 44 ? firstLine : `${firstLine.slice(0, 44).trimEnd()}…`;
  }

  return `Run ${existingCount + 1}`;
};

const createRunConfigurationId = (): string =>
  `run-config-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const parseStoredState = (): PersistedRunConfigurationState => {
  const raw = window.localStorage.getItem(RUN_CONFIGURATIONS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const entries = Object.entries(parsed as Record<string, unknown>).flatMap(
      ([workspaceKey, value]) => {
        if (!value || typeof value !== 'object') {
          return [];
        }

        const record = value as Partial<WorkspaceRunConfigurationState>;
        const configurations = Array.isArray(record.configurations)
          ? record.configurations
              .filter(
                (item): item is RunConfigurationRecord =>
                  Boolean(
                    item &&
                      typeof item === 'object' &&
                      typeof (item as RunConfigurationRecord).id === 'string' &&
                      typeof (item as RunConfigurationRecord).name === 'string' &&
                      typeof (item as RunConfigurationRecord).command === 'string',
                  ),
              )
              .map((item) => ({
                ...item,
                name: normalizeText(item.name),
                command: normalizeCommand(item.command),
                updatedAtMs:
                  typeof item.updatedAtMs === 'number' && Number.isFinite(item.updatedAtMs)
                    ? item.updatedAtMs
                    : Date.now(),
              }))
              .filter((item) => item.name.length > 0 && item.command.length > 0)
          : [];

        return [
          [
            workspaceKey,
            {
              selectedConfigurationId:
                typeof record.selectedConfigurationId === 'string'
                  ? record.selectedConfigurationId
                  : '',
              configurations: configurations.sort((left, right) => right.updatedAtMs - left.updatedAtMs),
            },
          ] as const,
        ];
      },
    );

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const upsertWorkspaceState = (
  previous: PersistedRunConfigurationState,
  workspaceKey: string,
  nextWorkspaceState: WorkspaceRunConfigurationState,
): PersistedRunConfigurationState => ({
  ...previous,
  [workspaceKey]: nextWorkspaceState,
});

export const useRunConfigurations = (
  workspacePath: string,
): {
  configurations: RunConfigurationRecord[];
  selectedConfigurationId: string;
  selectedConfiguration: RunConfigurationRecord | null;
  saveConfiguration: (input: {
    id?: string;
    name: string;
    command: string;
  }) => RunConfigurationRecord | null;
  deleteConfiguration: (configurationId: string) => void;
  selectConfiguration: (configurationId: string) => void;
  touchConfiguration: (configurationId: string) => void;
} => {
  const workspaceKey = React.useMemo(
    () => toWorkspaceStorageKey(workspacePath),
    [workspacePath],
  );
  const [state, setState] = React.useState<PersistedRunConfigurationState>(() => parseStoredState());

  React.useEffect(() => {
    window.localStorage.setItem(RUN_CONFIGURATIONS_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const workspaceState = state[workspaceKey] ?? {
    selectedConfigurationId: '',
    configurations: [],
  };

  const selectedConfiguration =
    workspaceState.configurations.find(
      (configuration) => configuration.id === workspaceState.selectedConfigurationId,
    ) ?? null;

  const saveConfiguration = React.useCallback(
    (input: {
      id?: string;
      name: string;
      command: string;
    }): RunConfigurationRecord | null => {
      const normalizedCommand = normalizeCommand(input.command);
      const existingCount = state[workspaceKey]?.configurations.length ?? 0;
      const normalizedName = normalizeText(input.name) || toDefaultConfigurationName(normalizedCommand, existingCount);

      if (normalizedName.length === 0 || normalizedCommand.length === 0) {
        return null;
      }

      const nextConfiguration: RunConfigurationRecord = {
        id: input.id?.trim() || createRunConfigurationId(),
        name: normalizedName,
        command: normalizedCommand,
        updatedAtMs: Date.now(),
      };

      setState((previous) => {
        const currentWorkspaceState = previous[workspaceKey] ?? {
          selectedConfigurationId: '',
          configurations: [],
        };
        const nextConfigurations = [
          nextConfiguration,
          ...currentWorkspaceState.configurations.filter(
            (configuration) => configuration.id !== nextConfiguration.id,
          ),
        ];

        return upsertWorkspaceState(previous, workspaceKey, {
          selectedConfigurationId: nextConfiguration.id,
          configurations: nextConfigurations,
        });
      });

      return nextConfiguration;
    },
    [state, workspaceKey],
  );

  const deleteConfiguration = React.useCallback(
    (configurationId: string) => {
      setState((previous) => {
        const currentWorkspaceState = previous[workspaceKey];
        if (!currentWorkspaceState) {
          return previous;
        }

        const nextConfigurations = currentWorkspaceState.configurations.filter(
          (configuration) => configuration.id !== configurationId,
        );

        if (nextConfigurations.length === currentWorkspaceState.configurations.length) {
          return previous;
        }

        return upsertWorkspaceState(previous, workspaceKey, {
          selectedConfigurationId:
            currentWorkspaceState.selectedConfigurationId === configurationId
              ? nextConfigurations[0]?.id ?? ''
              : currentWorkspaceState.selectedConfigurationId,
          configurations: nextConfigurations,
        });
      });
    },
    [workspaceKey],
  );

  const selectConfiguration = React.useCallback(
    (configurationId: string) => {
      setState((previous) => {
        const currentWorkspaceState = previous[workspaceKey] ?? {
          selectedConfigurationId: '',
          configurations: [],
        };

        if (
          currentWorkspaceState.selectedConfigurationId === configurationId ||
          !currentWorkspaceState.configurations.some(
            (configuration) => configuration.id === configurationId,
          )
        ) {
          return previous;
        }

        return upsertWorkspaceState(previous, workspaceKey, {
          ...currentWorkspaceState,
          selectedConfigurationId: configurationId,
        });
      });
    },
    [workspaceKey],
  );

  const touchConfiguration = React.useCallback(
    (configurationId: string) => {
      setState((previous) => {
        const currentWorkspaceState = previous[workspaceKey];
        if (!currentWorkspaceState) {
          return previous;
        }

        const configuration = currentWorkspaceState.configurations.find(
          (item) => item.id === configurationId,
        );
        if (!configuration) {
          return previous;
        }

        const nextConfiguration: RunConfigurationRecord = {
          ...configuration,
          updatedAtMs: Date.now(),
        };

        return upsertWorkspaceState(previous, workspaceKey, {
          selectedConfigurationId: configurationId,
          configurations: [
            nextConfiguration,
            ...currentWorkspaceState.configurations.filter((item) => item.id !== configurationId),
          ],
        });
      });
    },
    [workspaceKey],
  );

  return {
    configurations: workspaceState.configurations,
    selectedConfigurationId: workspaceState.selectedConfigurationId,
    selectedConfiguration,
    saveConfiguration,
    deleteConfiguration,
    selectConfiguration,
    touchConfiguration,
  };
};
