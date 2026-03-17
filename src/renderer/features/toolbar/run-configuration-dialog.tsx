import * as React from 'react';
import { Play } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';

interface RunConfigurationDialogProps {
  open: boolean;
  command: string;
  onOpenChange: (open: boolean) => void;
  onSaveAndRun: (command: string) => void;
}

export const RunConfigurationDialog = ({
  open,
  command,
  onOpenChange,
  onSaveAndRun,
}: RunConfigurationDialogProps): JSX.Element => {
  const [draftCommand, setDraftCommand] = React.useState(command);

  React.useEffect(() => {
    if (open) {
      setDraftCommand(command);
    }
  }, [command, open]);

  const trimmedCommand = draftCommand.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] rounded-[20px] p-0">
        <div className="px-4 pb-3.5 pt-4">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-stone-100 text-stone-900">
            <Play className="h-3.5 w-3.5" />
          </div>

          <h2 className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
            Run
          </h2>
          <p className="mt-2 max-w-[360px] text-[13px] leading-[1.35] text-stone-500">
            Tell Zero how to install dependencies and start your app.
          </p>

          <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500">
            Command to run
          </label>
          <textarea
            value={draftCommand}
            onChange={(event) => {
              setDraftCommand(event.target.value);
            }}
            spellCheck={false}
            className="no-drag mt-2 h-[144px] w-full resize-none rounded-[12px] border border-stone-300 bg-white px-3 py-2 font-mono text-[13px] leading-[1.45] text-stone-800 placeholder:text-stone-400 focus:outline-none"
            placeholder={'eg:\nnpm install\nnpm run dev'}
          />

          <div className="mt-3.5 flex items-center justify-between gap-3">
            <button
              type="button"
              className="no-drag rounded-xl px-2 py-1 text-[12px] text-stone-500 transition-colors hover:text-stone-700"
            >
              Environment settings
            </button>
            <Button
              size="lg"
              className="h-9 rounded-[11px] bg-stone-600 px-4 text-[13px] font-semibold text-white hover:bg-stone-700 disabled:bg-stone-300"
              disabled={trimmedCommand.length === 0}
              onClick={() => onSaveAndRun(trimmedCommand)}
            >
              Save and run
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
