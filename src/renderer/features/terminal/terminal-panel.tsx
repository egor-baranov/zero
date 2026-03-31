import * as React from 'react';
import { Plus, TerminalSquare, X } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { cn } from '@renderer/lib/cn';
import type { TerminalEvent } from '@shared/types/terminal';
import '@xterm/xterm/css/xterm.css';

const TERMINAL_PANEL_HEIGHT_KEY = 'zeroade.terminal-panel.height.v1';
const TERMINAL_PANEL_HEIGHT_DEFAULT = 256;
const TERMINAL_PANEL_HEIGHT_OPEN = 250;
const TERMINAL_PANEL_HEIGHT_MIN = 0;
const TERMINAL_PANEL_HEIGHT_MAX = 680;
const TERMINAL_PANEL_HEIGHT_COLLAPSE_THRESHOLD = 48;

const isDarkTheme = (): boolean => document.documentElement.dataset.zeroadeTheme === 'dark';

const getTerminalSurfaceColor = (): string => (isDarkTheme() ? '#101013' : '#fdfdff');

const getTerminalTheme = () => {
  if (isDarkTheme()) {
    return {
      background: getTerminalSurfaceColor(),
      foreground: '#d4d4d8',
      cursor: '#f5f5f5',
      selectionBackground: '#2a2a30',
    };
  }

  return {
    background: getTerminalSurfaceColor(),
    foreground: '#2f2d2b',
    cursor: '#2f2d2b',
    selectionBackground: '#dce3f4',
  };
};

interface TerminalPanelProps {
  open: boolean;
  cwd: string;
  runRequest: {
    id: number;
    configurationId: string;
    configurationName: string;
    command: string;
  } | null;
  interruptRequest: {
    id: number;
  } | null;
  onExecutionStateChange: (execution: {
    configurationId: string;
    configurationName: string;
  } | null) => void;
  onRequestClose: () => void;
}

interface TerminalTab {
  id: string;
  label: string;
  cwd: string;
}

interface TerminalTabSessionProps {
  tab: TerminalTab;
  active: boolean;
  open: boolean;
  surfaceColor: string;
  runRequest: {
    id: number;
    configurationId: string;
    configurationName: string;
    command: string;
    tabId: string;
  } | null;
  interruptRequest: {
    id: number;
  } | null;
  onRunRequestHandled: (requestId: number) => void;
  onInterruptRequestHandled: (requestId: number) => void;
  onSessionExit: (tabId: string) => void;
}

interface ActiveTerminalExecution {
  configurationId: string;
  configurationName: string;
  tabId: string;
}

const createTerminalTabId = (): string =>
  `terminal-tab-${Date.now()}-${Math.random().toString(16).slice(2, 9)}`;

const clampPanelHeight = (value: number): number => {
  const viewportMax = Math.max(TERMINAL_PANEL_HEIGHT_OPEN, window.innerHeight - 180);
  const maxHeight = Math.min(TERMINAL_PANEL_HEIGHT_MAX, viewportMax);
  return Math.min(Math.max(value, TERMINAL_PANEL_HEIGHT_MIN), maxHeight);
};

const readStoredPanelHeight = (): number => {
  const raw = window.localStorage.getItem(TERMINAL_PANEL_HEIGHT_KEY);
  if (!raw) {
    return TERMINAL_PANEL_HEIGHT_DEFAULT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TERMINAL_PANEL_HEIGHT_DEFAULT;
  }

  return clampPanelHeight(parsed);
};

const getDimensions = (
  fitAddon: FitAddon | null,
): {
  cols: number;
  rows: number;
} => {
  const proposed = fitAddon?.proposeDimensions();

  return {
    cols: proposed?.cols && proposed.cols > 0 ? proposed.cols : 120,
    rows: proposed?.rows && proposed.rows > 0 ? proposed.rows : 28,
  };
};

const TerminalTabSession = ({
  tab,
  active,
  open,
  surfaceColor,
  runRequest,
  interruptRequest,
  onRunRequestHandled,
  onInterruptRequestHandled,
  onSessionExit,
}: TerminalTabSessionProps): JSX.Element => {
  const terminalContainerRef = React.useRef<HTMLDivElement | null>(null);
  const terminalRef = React.useRef<XTerm | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const terminalIdRef = React.useRef<string | null>(null);

  const ensureSession = React.useCallback(async (): Promise<string | null> => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    if (!terminal || !fitAddon) {
      return null;
    }

    fitAddon.fit();

    if (terminalIdRef.current) {
      const { cols, rows } = getDimensions(fitAddon);
      await window.desktop.terminalResize({
        terminalId: terminalIdRef.current,
        cols,
        rows,
      });

      terminal.focus();
      return terminalIdRef.current;
    }

    const { cols, rows } = getDimensions(fitAddon);
    const result = await window.desktop.terminalCreate({
      cwd: tab.cwd,
      cols,
      rows,
    });

    terminalIdRef.current = result.terminalId;
    terminal.focus();
    return result.terminalId;
  }, [tab.cwd]);

  React.useEffect(() => {
    const container = terminalContainerRef.current;

    if (!container || terminalRef.current) {
      return;
    }

    const terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.32,
      scrollback: 5000,
      scrollOnUserInput: true,
      theme: getTerminalTheme(),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const writeDisposable = terminal.onData((data) => {
      const terminalId = terminalIdRef.current;
      if (!terminalId) {
        return;
      }

      void window.desktop.terminalWrite({
        terminalId,
        data,
      });
    });

    return () => {
      writeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const applyTheme = (): void => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      terminal.options.theme = getTerminalTheme();
      terminal.refresh(0, terminal.rows - 1);
    };

    applyTheme();
    window.addEventListener('zeroade-ui-preferences-changed', applyTheme);

    return () => {
      window.removeEventListener('zeroade-ui-preferences-changed', applyTheme);
    };
  }, []);

  React.useEffect(() => {
    const unsubscribe = window.desktop.onTerminalEvent((event: TerminalEvent) => {
      const terminalId = terminalIdRef.current;
      if (!terminalId || event.terminalId !== terminalId) {
        return;
      }

      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      if (event.type === 'data') {
        terminal.write(event.data);
        return;
      }

      const exitCodeText = typeof event.exitCode === 'number' ? String(event.exitCode) : '?';
      terminal.writeln(`\r\n[Process exited: ${exitCodeText}]`);
      terminalIdRef.current = null;
      onSessionExit(tab.id);
    });

    return unsubscribe;
  }, [onSessionExit, tab.id]);

  React.useEffect(() => {
    if (!open || !active) {
      return;
    }

    void ensureSession();
  }, [active, ensureSession, open]);

  React.useEffect(() => {
    if (!open || !active || !runRequest) {
      return;
    }

    const executeCommand = async (): Promise<void> => {
      const terminalId = await ensureSession();
      if (!terminalId) {
        return;
      }

      const command = runRequest.command.trim();
      if (!command) {
        onRunRequestHandled(runRequest.id);
        return;
      }

      await window.desktop.terminalWrite({
        terminalId,
        data: command.endsWith('\n') ? command : `${command}\n`,
      });
      onRunRequestHandled(runRequest.id);
    };

    void executeCommand();
  }, [active, ensureSession, onRunRequestHandled, open, runRequest]);

  React.useEffect(() => {
    if (!interruptRequest) {
      return;
    }

    const terminalId = terminalIdRef.current;
    if (!terminalId) {
      onInterruptRequestHandled(interruptRequest.id);
      return;
    }

    void window.desktop
      .terminalWrite({
        terminalId,
        data: '\u0003',
      })
      .finally(() => {
        onInterruptRequestHandled(interruptRequest.id);
      });
  }, [interruptRequest, onInterruptRequestHandled]);

  React.useEffect(() => {
    if (!open || !active) {
      return;
    }

    const container = terminalContainerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!open || !active) {
        return;
      }

      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      const terminalId = terminalIdRef.current;

      if (!terminal || !fitAddon || !terminalId) {
        return;
      }

      fitAddon.fit();
      const { cols, rows } = getDimensions(fitAddon);

      void window.desktop.terminalResize({
        terminalId,
        cols,
        rows,
      });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [active, open]);

  React.useEffect(() => {
    if (!open || !active) {
      return;
    }

    terminalRef.current?.focus();
  }, [active, open]);

  React.useEffect(() => {
    return () => {
      const terminalId = terminalIdRef.current;
      if (!terminalId) {
        return;
      }

      void window.desktop.terminalClose({ terminalId });
      terminalIdRef.current = null;
    };
  }, []);

  return (
    <div
      ref={terminalContainerRef}
      className="h-full w-full overflow-auto rounded-md"
      style={{ backgroundColor: surfaceColor }}
    />
  );
};

export const TerminalPanel = ({
  open,
  cwd,
  runRequest,
  interruptRequest,
  onExecutionStateChange,
  onRequestClose,
}: TerminalPanelProps): JSX.Element => {
  const initialTab = React.useRef<TerminalTab>({
    id: createTerminalTabId(),
    label: 'Terminal 1',
    cwd,
  });
  const tabCounterRef = React.useRef(2);
  const [tabs, setTabs] = React.useState<TerminalTab[]>([initialTab.current]);
  const [activeTabId, setActiveTabId] = React.useState(initialTab.current.id);
  const [draggingTabId, setDraggingTabId] = React.useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = React.useState<string | null>(null);
  const [surfaceColor, setSurfaceColor] = React.useState(() => getTerminalSurfaceColor());
  const [panelHeight, setPanelHeight] = React.useState<number>(() => readStoredPanelHeight());
  const [isResizing, setIsResizing] = React.useState(false);
  const [pendingRunRequest, setPendingRunRequest] = React.useState<{
    id: number;
    configurationId: string;
    configurationName: string;
    command: string;
    tabId: string;
  } | null>(null);
  const [pendingInterruptRequest, setPendingInterruptRequest] = React.useState<{
    id: number;
  } | null>(null);
  const [activeExecution, setActiveExecution] = React.useState<ActiveTerminalExecution | null>(null);
  const resizingRef = React.useRef(false);
  const resizePointerIdRef = React.useRef<number | null>(null);
  const resizeHandleRef = React.useRef<HTMLButtonElement | null>(null);
  const lastRunRequestIdRef = React.useRef<number | null>(null);
  const lastInterruptRequestIdRef = React.useRef<number | null>(null);
  const createTab = React.useCallback((nextCwd: string): TerminalTab => {
    const tab: TerminalTab = {
      id: createTerminalTabId(),
      label: `Terminal ${tabCounterRef.current}`,
      cwd: nextCwd,
    };

    tabCounterRef.current += 1;
    return tab;
  }, []);

  React.useEffect(() => {
    setPanelHeight((previous) => clampPanelHeight(previous));
  }, []);

  React.useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? '');
    }
  }, [activeTabId, tabs]);

  React.useEffect(() => {
    const syncSurfaceColor = (): void => {
      setSurfaceColor(getTerminalSurfaceColor());
    };

    window.addEventListener('zeroade-ui-preferences-changed', syncSurfaceColor);
    return () => {
      window.removeEventListener('zeroade-ui-preferences-changed', syncSurfaceColor);
    };
  }, []);

  React.useEffect(() => {
    if (!open || tabs.length > 0) {
      return;
    }

    const tab = createTab(cwd);
    setTabs([tab]);
    setActiveTabId(tab.id);
  }, [createTab, cwd, open, tabs.length]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const nextHeight = clampPanelHeight(TERMINAL_PANEL_HEIGHT_OPEN);
    setPanelHeight(nextHeight);
    window.localStorage.setItem(TERMINAL_PANEL_HEIGHT_KEY, String(nextHeight));
  }, [open]);

  React.useEffect(() => {
    if (!runRequest || runRequest.id === lastRunRequestIdRef.current) {
      return;
    }

    lastRunRequestIdRef.current = runRequest.id;
    const targetTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? createTab(cwd);

    if (!tabs.some((tab) => tab.id === targetTab.id)) {
      setTabs([targetTab]);
      setActiveTabId(targetTab.id);
    }

    setTabs((previous) => {
      const hasTarget = previous.some((tab) => tab.id === targetTab.id);
      const nextTabs = hasTarget ? previous : [...previous, targetTab];

      return nextTabs.map((tab) =>
        tab.id === targetTab.id
          ? {
              ...tab,
              label: runRequest.configurationName,
              cwd,
            }
          : tab,
      );
    });
    setActiveTabId(targetTab.id);
    setPendingRunRequest({
      ...runRequest,
      tabId: targetTab.id,
    });
    setActiveExecution({
      configurationId: runRequest.configurationId,
      configurationName: runRequest.configurationName,
      tabId: targetTab.id,
    });
  }, [activeTabId, createTab, cwd, runRequest, tabs]);

  React.useEffect(() => {
    if (!interruptRequest || interruptRequest.id === lastInterruptRequestIdRef.current) {
      return;
    }

    lastInterruptRequestIdRef.current = interruptRequest.id;
    if (!activeExecution) {
      return;
    }

    setPendingInterruptRequest(interruptRequest);
  }, [activeExecution, interruptRequest]);

  React.useEffect(() => {
    setTabs((previous) =>
      previous.map((tab) =>
        tab.id === activeTabId && tab.cwd !== cwd
          ? {
              ...tab,
              cwd,
            }
          : tab,
      ),
    );
  }, [activeTabId, cwd]);

  React.useEffect(() => {
    const stopResizing = (): void => {
      if (!resizingRef.current) {
        return;
      }

      resizingRef.current = false;
      resizePointerIdRef.current = null;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handlePointerMove = (event: PointerEvent): void => {
      if (!resizingRef.current) {
        return;
      }

      if (resizePointerIdRef.current !== null && event.pointerId !== resizePointerIdRef.current) {
        return;
      }

      const rawHeight = window.innerHeight - event.clientY;
      if (rawHeight <= TERMINAL_PANEL_HEIGHT_COLLAPSE_THRESHOLD) {
        const resetHeight = clampPanelHeight(TERMINAL_PANEL_HEIGHT_OPEN);
        setPanelHeight(resetHeight);
        window.localStorage.setItem(TERMINAL_PANEL_HEIGHT_KEY, String(resetHeight));
        stopResizing();
        onRequestClose();
        return;
      }

      const nextHeight = clampPanelHeight(rawHeight);
      setPanelHeight(nextHeight);
      window.localStorage.setItem(TERMINAL_PANEL_HEIGHT_KEY, String(nextHeight));
    };

    const handlePointerUp = (event: PointerEvent): void => {
      if (!resizingRef.current) {
        return;
      }

      if (resizePointerIdRef.current !== null && event.pointerId !== resizePointerIdRef.current) {
        return;
      }

      stopResizing();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('blur', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('blur', stopResizing);
      stopResizing();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onRequestClose]);

  const startResizing = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizePointerIdRef.current = event.pointerId;
    resizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  }, []);

  const handleCreateTab = React.useCallback(() => {
    const tab = createTab(cwd);
    setTabs((previous) => [...previous, tab]);
    setActiveTabId(tab.id);
  }, [createTab, cwd]);

  const handleCloseTab = React.useCallback(
    (tabId: string) => {
      const closeIndex = tabs.findIndex((tab) => tab.id === tabId);
      if (closeIndex < 0) {
        return;
      }

      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      setTabs(nextTabs);
      setActiveExecution((previous) => (previous?.tabId === tabId ? null : previous));

      if (nextTabs.length === 0) {
        setActiveTabId('');
        onRequestClose();
        return;
      }

      if (activeTabId !== tabId) {
        return;
      }

      const fallbackTab = nextTabs[closeIndex] ?? nextTabs[closeIndex - 1] ?? nextTabs[0];
      if (fallbackTab) {
        setActiveTabId(fallbackTab.id);
      }
    },
    [activeTabId, onRequestClose, tabs],
  );

  const handleReorderTabs = React.useCallback((sourceTabId: string, targetTabId: string) => {
    if (sourceTabId === targetTabId) {
      return;
    }

    setTabs((previous) => {
      const sourceTab = previous.find((tab) => tab.id === sourceTabId);
      if (!sourceTab) {
        return previous;
      }

      const nextTabs = previous.filter((tab) => tab.id !== sourceTabId);
      const targetIndex = nextTabs.findIndex((tab) => tab.id === targetTabId);
      if (targetIndex < 0) {
        return previous;
      }

      nextTabs.splice(targetIndex, 0, sourceTab);
      return nextTabs;
    });
  }, []);

  const handleRunRequestHandled = React.useCallback((requestId: number) => {
    setPendingRunRequest((previous) => {
      if (!previous || previous.id !== requestId) {
        return previous;
      }

      return null;
    });
  }, []);

  const handleInterruptRequestHandled = React.useCallback((requestId: number) => {
    setPendingInterruptRequest((previous) => {
      if (!previous || previous.id !== requestId) {
        return previous;
      }

      return null;
    });
    setActiveExecution(null);
  }, []);

  const handleSessionExit = React.useCallback((tabId: string) => {
    setActiveExecution((previous) => (previous?.tabId === tabId ? null : previous));
  }, []);

  React.useEffect(() => {
    onExecutionStateChange(
      activeExecution
        ? {
            configurationId: activeExecution.configurationId,
            configurationName: activeExecution.configurationName,
          }
        : null,
    );
  }, [activeExecution, onExecutionStateChange]);

  const activeRunRequest = open ? pendingRunRequest : null;

  return (
    <section
      style={{
        height: open ? panelHeight : 0,
        backgroundColor: surfaceColor,
      }}
      className={cn(
        'relative overflow-hidden transition-[height] duration-200',
        open ? 'border-t border-t-[var(--zeroade-shell-divider)]' : 'border-t-0',
        isResizing && 'transition-none',
      )}
    >
      {open ? (
        <button
          ref={resizeHandleRef}
          type="button"
          aria-label="Resize terminal panel"
          className="no-drag absolute inset-x-0 top-0 z-20 h-4 cursor-row-resize"
          onPointerDown={startResizing}
        />
      ) : null}

      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex h-10 shrink-0 items-center gap-1.5 px-2.5"
          style={{ backgroundColor: surfaceColor }}
        >
          <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;

              return (
                <div
                  key={tab.id}
                  role="button"
                  tabIndex={0}
                  draggable={tabs.length > 1}
                  className={cn(
                    'no-drag group inline-flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] transition-colors focus:outline-none',
                    isActive
                      ? 'bg-stone-200/85 text-stone-900'
                      : 'bg-stone-100/75 text-stone-600 hover:bg-stone-200/70 hover:text-stone-800',
                    draggingTabId === tab.id && 'opacity-60',
                    dragOverTabId === tab.id && draggingTabId !== tab.id && 'bg-stone-200/90',
                  )}
                  onClick={() => setActiveTabId(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') {
                      return;
                    }

                    event.preventDefault();
                    setActiveTabId(tab.id);
                  }}
                  onDragStart={(event) => {
                    if (tabs.length <= 1) {
                      event.preventDefault();
                      return;
                    }

                    setDraggingTabId(tab.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', tab.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggingTabId || draggingTabId === tab.id) {
                      return;
                    }

                    event.preventDefault();
                    setDragOverTabId(tab.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceTabId = draggingTabId ?? event.dataTransfer.getData('text/plain');
                    if (!sourceTabId || sourceTabId === tab.id) {
                      return;
                    }

                    handleReorderTabs(sourceTabId, tab.id);
                  }}
                  onDragEnd={() => {
                    setDraggingTabId(null);
                    setDragOverTabId(null);
                  }}
                  onDragLeave={() => {
                    if (dragOverTabId === tab.id) {
                      setDragOverTabId(null);
                    }
                  }}
                >
                  <TerminalSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    className={cn(
                      'inline-flex h-4 w-4 items-center justify-center rounded-md text-stone-500 transition-colors',
                      'hover:bg-stone-300/70 hover:text-stone-700',
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="New terminal tab"
            className="no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
            onClick={handleCreateTab}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div
          className="relative min-h-0 flex-1 overflow-hidden px-2 py-1.5"
          style={{ backgroundColor: surfaceColor }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;

            return (
              <div
                key={tab.id}
                className={cn(
                  'absolute inset-0 px-2 py-1.5',
                  isActive ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                <TerminalTabSession
                  tab={tab}
                  active={open && isActive}
                  open={open}
                  surfaceColor={surfaceColor}
                  runRequest={activeRunRequest?.tabId === tab.id ? activeRunRequest : null}
                  interruptRequest={
                    activeExecution?.tabId === tab.id ? pendingInterruptRequest : null
                  }
                  onRunRequestHandled={handleRunRequestHandled}
                  onInterruptRequestHandled={handleInterruptRequestHandled}
                  onSessionExit={handleSessionExit}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
