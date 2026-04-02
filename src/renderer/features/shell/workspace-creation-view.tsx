import * as React from 'react';
import { Check, Folder, FolderPlus } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/cn';
import type { WorkspaceRecord } from '@renderer/store/use-shell-state';

interface WorkspaceCreationViewProps {
  projects: WorkspaceRecord[];
  name: string;
  selectedPaths: string[];
  isPickingProject: boolean;
  onNameChange: (value: string) => void;
  onToggleProjectPath: (projectPath: string) => void;
  onAddProject: () => void;
  onSubmit: () => void;
}

const getFolderName = (folderPath: string): string =>
  folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath;

export const WorkspaceCreationView = ({
  projects,
  name,
  selectedPaths,
  isPickingProject,
  onNameChange,
  onToggleProjectPath,
  onAddProject,
  onSubmit,
}: WorkspaceCreationViewProps): JSX.Element => {
  const selectedPathSet = React.useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const projectOptions = React.useMemo(() => {
    const items = projects.map((project) => ({
      path: project.path,
      name: project.name,
      isExisting: true,
    }));

    for (const path of selectedPaths) {
      if (items.some((item) => item.path === path)) {
        continue;
      }

      items.push({
        path,
        name: getFolderName(path),
        isExisting: false,
      });
    }

    return items;
  }, [projects, selectedPaths]);

  const canSubmit = name.trim().length > 0 && selectedPaths.length > 0;
  const hasWorkspaceName = name.trim().length > 0;
  const projectCountLabel =
    selectedPaths.length === 0
      ? 'Choose at least one project.'
      : `${selectedPaths.length} project${selectedPaths.length === 1 ? '' : 's'} selected.`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto scrollbar-none px-2 pb-4 pt-2">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="w-full max-w-[760px]">
          <div className="mx-auto max-w-[560px] text-center">
            <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.02em] text-stone-900">
              Create workspace
            </h1>
            <p className="mt-2 text-[15px] leading-[1.45] text-stone-500">
              Group chats across multiple projects and keep them scoped together.
            </p>
          </div>

          <form
            className="mt-8"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className="space-y-2">
              <label
                htmlFor="workspace-name"
                className="text-[13px] font-medium text-stone-700"
              >
                Workspace name
              </label>
              <input
                id="workspace-name"
                autoFocus
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Workspace name"
                className={cn(
                  'no-drag h-11 w-full rounded-[16px] border border-stone-200 bg-stone-50/85 px-3.5 text-[14px] text-stone-900 outline-none transition-colors',
                  'focus:border-stone-300 focus:bg-white',
                )}
              />
            </div>

            <div
              className={cn(
                'overflow-hidden transition-[max-height,opacity,transform,margin] duration-200 ease-out',
                hasWorkspaceName
                  ? 'mt-6 max-h-[520px] translate-y-0 opacity-100'
                  : 'mt-0 max-h-0 -translate-y-1 opacity-0 pointer-events-none',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-stone-700">Projects</p>
                  <p className="mt-1 text-[12px] leading-[1.45] text-stone-500">
                    Select the projects this workspace should include.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-[12px]"
                  onClick={onAddProject}
                  disabled={isPickingProject}
                >
                  <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                  Add project
                </Button>
              </div>

              <div className="mt-3 grid max-h-[320px] gap-2 overflow-y-auto pr-1">
                {projectOptions.length === 0 ? (
                  <button
                    type="button"
                    className={cn(
                      'no-drag flex w-full items-center justify-center rounded-[18px] border border-dashed border-stone-300 bg-stone-50/75 px-4 py-8 text-center text-[13px] text-stone-500 transition-colors',
                      'hover:border-stone-400 hover:text-stone-700',
                    )}
                    onClick={onAddProject}
                    disabled={isPickingProject}
                  >
                    Add the first project
                  </button>
                ) : (
                  projectOptions.map((project) => {
                    const isSelected = selectedPathSet.has(project.path);

                    return (
                      <button
                        key={project.path}
                        type="button"
                        className={cn(
                          'no-drag flex w-full items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition-colors',
                          isSelected
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-200 bg-stone-50/80 text-stone-700 hover:border-stone-300 hover:bg-stone-100/80',
                        )}
                        onClick={() => {
                          onToggleProjectPath(project.path);
                        }}
                      >
                        <span
                          className={cn(
                            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px]',
                            isSelected ? 'bg-white/12 text-white' : 'bg-white text-stone-600',
                          )}
                        >
                          <Folder className="h-4 w-4" />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {project.name}
                          </span>
                          <span
                            className={cn(
                              'mt-0.5 block truncate text-[12px]',
                              isSelected ? 'text-white/75' : 'text-stone-500',
                            )}
                          >
                            {project.path}
                          </span>
                        </span>

                        {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
                        {!project.isExisting && !isSelected ? (
                          <span className="text-[11px] text-stone-500">New</span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-3',
                hasWorkspaceName ? 'mt-6 border-t border-stone-200/80 pt-4' : 'mt-8 pt-0',
              )}
            >
              <p className="text-[12px] text-stone-500">
                {hasWorkspaceName ? projectCountLabel : ''}
              </p>

              <Button
                type="submit"
                variant="primary"
                className="rounded-[12px] px-4"
                disabled={!canSubmit}
              >
                Create workspace
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
