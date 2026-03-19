import * as React from 'react';
import {
  Bell,
  ChevronDown,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  Play,
  SquareTerminal,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Separator } from '@renderer/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { cn } from '@renderer/lib/cn';

interface ToolbarActionsProps {
  onOpenFileTree: () => void;
  isFileTreeOpen: boolean;
  onToggleFilesView: () => void;
  isFilesViewOpen: boolean;
  openFilesCount: number;
  onOpenCommitDialog: () => void;
  onOpenRunConfiguration: () => void;
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
  onOpenCommitDialog,
  onOpenRunConfiguration,
  onOpenWebBrowser,
  isWebBrowserOpen,
  onToggleTerminal,
  isTerminalOpen,
  unreadPushCount,
  isPushPanelOpen,
  onTogglePushPanel,
}: ToolbarActionsProps): JSX.Element => {
  return (
    <TooltipProvider delayDuration={220}>
      <div className="flex items-center gap-1.5">
        {openFilesCount > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              'h-7 gap-1.5 rounded-full border-stone-200/80 bg-white/90 px-2.5 text-[12px]',
              isFilesViewOpen && 'bg-stone-200/70 text-stone-800',
            )}
            onClick={onToggleFilesView}
          >
            <FileText className="h-3.5 w-3.5" />
            {openFilesCount}
          </Button>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-stone-500"
              onClick={onOpenRunConfiguration}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run configuration</TooltipContent>
        </Tooltip>

        <Button
          variant="secondary"
          size="sm"
          className="h-7 gap-1.5 rounded-full border-stone-200/80 bg-white/90 px-2.5 text-[12px]"
          onClick={onOpenCommitDialog}
        >
          <GitBranch className="h-3.5 w-3.5" />
          Commit
          <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-4 bg-stone-200" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-7 w-7 rounded-full text-stone-500',
                isFileTreeOpen && 'bg-stone-200/70 text-stone-700',
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
                'h-7 w-7 rounded-full text-stone-500',
                isTerminalOpen && 'bg-stone-200/70 text-stone-700',
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
                'h-7 w-7 rounded-full text-stone-500',
                isWebBrowserOpen && 'bg-stone-200/70 text-stone-700',
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
                'relative h-7 w-7 rounded-full text-stone-500',
                isPushPanelOpen && 'bg-stone-200/70 text-stone-700',
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
