import * as React from 'react';
import {
  Bell,
  ChevronDown,
  FileText,
  FolderTree,
  Globe,
  Play,
  Square,
  SquareTerminal,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Separator } from '@renderer/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { cn } from '@renderer/lib/cn';
import type { RunConfigurationRecord } from '@renderer/store/use-run-configurations';

interface ToolbarActionsProps {
  onOpenFileTree: () => void;
  isFileTreeOpen: boolean;
  onToggleFilesView: () => void;
  isFilesViewOpen: boolean;
  openFilesCount: number;
  onOpenRunConfiguration: () => void;
  runConfigurations: RunConfigurationRecord[];
  selectedRunConfigurationId: string;
  selectedRunConfigurationName: string | null;
  isRunInProgress: boolean;
  onSelectRunConfiguration: (configurationId: string) => void;
  onRunSelectedConfiguration: () => void;
  onInterruptRun: () => void;
  onOpenWebBrowser: () => void;
  isWebBrowserOpen: boolean;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
  unreadPushCount: number;
  isPushPanelOpen: boolean;
  onTogglePushPanel: () => void;
}

export const ToolbarActions = ({
  onOpenFileTree,
  isFileTreeOpen,
  onToggleFilesView,
  isFilesViewOpen,
  openFilesCount,
  onOpenRunConfiguration,
  runConfigurations,
  selectedRunConfigurationId,
  selectedRunConfigurationName,
  isRunInProgress,
  onSelectRunConfiguration,
  onRunSelectedConfiguration,
  onInterruptRun,
  onOpenWebBrowser,
  isWebBrowserOpen,
  onToggleTerminal,
  isTerminalOpen,
  unreadPushCount,
  isPushPanelOpen,
  onTogglePushPanel,
}: ToolbarActionsProps): JSX.Element => {
  const hasRunConfigurations = runConfigurations.length > 0;

  return (
    <TooltipProvider delayDuration={220}>
      <div className="flex items-center gap-1.5">
        {openFilesCount > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              'h-7 gap-1.5 rounded-full border-stone-200/80 bg-white/90 px-2.5 text-[12px] hover:bg-stone-200/45',
              isFilesViewOpen && 'bg-stone-200/45 text-stone-800 hover:bg-stone-200/45',
            )}
            onClick={onToggleFilesView}
          >
            <FileText className="h-3.5 w-3.5" />
            {openFilesCount}
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              className={cn(
                'h-7 gap-1.5 rounded-[8px] border-stone-200/80 bg-white/90 px-2.5 text-[12px] hover:bg-stone-200/45 focus-visible:ring-0',
                selectedRunConfigurationName
                  ? 'max-w-[240px]'
                  : 'max-w-[220px]',
              )}
            >
              <span className="truncate">
                {selectedRunConfigurationName ?? 'Add Configuration..'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className={cn(
              hasRunConfigurations ? 'min-w-[220px] max-w-[320px]' : 'min-w-0 w-fit',
            )}
          >
            {hasRunConfigurations ? (
              <>
                {runConfigurations.map((configuration) => (
                  <DropdownMenuCheckboxItem
                    key={configuration.id}
                    checked={configuration.id === selectedRunConfigurationId}
                    onCheckedChange={() => onSelectRunConfiguration(configuration.id)}
                  >
                    <span className="truncate text-[13px] font-medium text-stone-800">
                      {configuration.name}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator className="my-1" />
              </>
            ) : null}
            <DropdownMenuItem
              className="no-drag whitespace-nowrap text-[13px]"
              onSelect={onOpenRunConfiguration}
            >
              Edit configurations…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-full text-stone-500 hover:bg-stone-200/45 hover:text-stone-700',
              )}
              onClick={hasRunConfigurations ? onRunSelectedConfiguration : onOpenRunConfiguration}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run selected configuration</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-full text-stone-500 hover:bg-stone-200/45 hover:text-stone-700',
                isRunInProgress && 'bg-rose-100/80 text-rose-700 hover:bg-rose-100 hover:text-rose-800',
              )}
              disabled={!isRunInProgress}
              onClick={onInterruptRun}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Interrupt active run</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-4 bg-stone-200" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-full text-stone-500 hover:bg-stone-200/45 hover:text-stone-700',
                isFileTreeOpen && 'bg-stone-200/45 text-stone-700 hover:bg-stone-200/45',
              )}
              onClick={onOpenFileTree}
            >
              <FolderTree className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle files</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-full text-stone-500 hover:bg-stone-200/45 hover:text-stone-700',
                isTerminalOpen && 'bg-stone-200/45 text-stone-700 hover:bg-stone-200/45',
              )}
              onClick={onToggleTerminal}
            >
              <SquareTerminal className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle terminal</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-full text-stone-500 hover:bg-stone-200/45 hover:text-stone-700',
                isWebBrowserOpen && 'bg-stone-200/45 text-stone-700 hover:bg-stone-200/45',
              )}
              onClick={onOpenWebBrowser}
            >
              <Globe className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open web browser</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'relative h-7 w-7 rounded-full text-stone-500 hover:bg-stone-200/45 hover:text-stone-700',
                isPushPanelOpen && 'bg-stone-200/45 text-stone-700 hover:bg-stone-200/45',
              )}
              onClick={onTogglePushPanel}
              aria-label="Notifications"
            >
              <Bell className="h-3.5 w-3.5" />
              {unreadPushCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-stone-800 px-1 text-[10px] font-medium text-white">
                  {unreadPushCount > 9 ? '9+' : unreadPushCount}
                </span>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open notifications</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};
