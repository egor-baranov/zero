import * as React from 'react';
import { Check, CircleDot, GitBranch, Github, X } from 'lucide-react';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/cn';

interface CommitDialogProps {
  open: boolean;
  branchName: string;
  changesSummary: string;
  onOpenChange: (open: boolean) => void;
  onContinue: (payload: {
    includeUnstaged: boolean;
    message: string;
    nextStep: 'commit' | 'commit-and-push' | 'commit-and-pr';
  }) => void;
}

const nextStepOptions: Array<{
  id: 'commit' | 'commit-and-push' | 'commit-and-pr';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}> = [
  { id: 'commit', label: 'Commit', icon: CircleDot },
  { id: 'commit-and-push', label: 'Commit and push', icon: GitBranch, disabled: true },
  { id: 'commit-and-pr', label: 'Commit and create PR', icon: Github, disabled: true },
];

export const CommitDialog = ({
  open,
  branchName,
  changesSummary,
  onOpenChange,
  onContinue,
}: CommitDialogProps): JSX.Element => {
  const [includeUnstaged, setIncludeUnstaged] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [nextStep, setNextStep] = React.useState<'commit' | 'commit-and-push' | 'commit-and-pr'>(
    'commit',
  );

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setIncludeUnstaged(false);
    setMessage('');
    setNextStep('commit');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="no-drag max-w-[420px] rounded-[20px] p-0">
        <div className="px-4 pb-4 pt-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-stone-100 text-stone-700">
              <CircleDot className="h-4 w-4" />
            </span>
            <button
              type="button"
              aria-label="Close commit dialog"
              className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <h2 className="mt-3 text-[26px] font-semibold leading-none tracking-[-0.015em] text-stone-900">
            Commit your changes
          </h2>

          <div className="mt-4 space-y-2 text-[13px]">
            <div className="flex items-center justify-between text-stone-700">
              <span className="font-medium">Branch</span>
              <span className="flex items-center gap-1.5 text-stone-800">
                <GitBranch className="h-3.5 w-3.5" />
                {branchName}
              </span>
            </div>

            <div className="flex items-center justify-between text-stone-700">
              <span className="font-medium">Changes</span>
              <span className="text-stone-500">{changesSummary}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={includeUnstaged}
              className={cn(
                'no-drag relative inline-flex h-6 w-10 items-center rounded-full transition-colors',
                includeUnstaged ? 'bg-stone-700' : 'bg-stone-200',
              )}
              onClick={() => setIncludeUnstaged((previous) => !previous)}
            >
              <span
                className={cn(
                  'absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                  includeUnstaged && 'translate-x-4',
                )}
              />
            </button>
            <span className="text-[13px] text-stone-700">Include unstaged</span>
          </div>

          <label className="mt-4 block text-[13px] font-medium text-stone-700">Commit message</label>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            spellCheck={false}
            placeholder="Leave blank to autogenerate a commit message"
            className="no-drag mt-2 h-[84px] w-full resize-none rounded-[12px] border border-stone-200 bg-stone-50/40 px-3 py-2 text-[13px] text-stone-800 placeholder:text-stone-400 focus:outline-none"
          />

          <p className="mt-4 text-[13px] font-medium text-stone-700">Next steps</p>
          <div className="mt-2 overflow-hidden rounded-[12px] border border-stone-200 bg-stone-50/30">
            {nextStepOptions.map((option) => {
              const Icon = option.icon;
              const isSelected = option.id === nextStep;

              return (
                <button
                  type="button"
                  key={option.id}
                  disabled={option.disabled}
                  className={cn(
                    'no-drag flex h-9 w-full items-center justify-between border-b border-stone-200 px-3 text-left text-[13px] transition-colors last:border-b-0',
                    option.disabled
                      ? 'cursor-not-allowed text-stone-400'
                      : 'text-stone-700 hover:bg-stone-100/70',
                  )}
                  onClick={() => {
                    if (!option.disabled) {
                      setNextStep(option.id);
                    }
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </span>
                  {isSelected && !option.disabled ? <Check className="h-4 w-4 text-stone-700" /> : null}
                </button>
              );
            })}
          </div>

          <Button
            className="mt-4 h-8 w-full rounded-[10px] bg-stone-600 text-[13px] font-medium text-white hover:bg-stone-700"
            onClick={() =>
              onContinue({
                includeUnstaged,
                message: message.trim(),
                nextStep,
              })
            }
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
