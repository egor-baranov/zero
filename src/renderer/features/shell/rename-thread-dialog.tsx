import * as React from 'react';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';

interface RenameThreadDialogProps {
  open: boolean;
  initialTitle: string;
  onOpenChange: (open: boolean) => void;
  onSave: (nextTitle: string) => void;
}

export const RenameThreadDialog = ({
  open,
  initialTitle,
  onOpenChange,
  onSave,
}: RenameThreadDialogProps): JSX.Element => {
  const [title, setTitle] = React.useState(initialTitle);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setTitle(initialTitle);
  }, [initialTitle, open]);

  const trimmedTitle = title.trim();
  const initialTrimmedTitle = initialTitle.trim();
  const canSave =
    trimmedTitle.length > 0 && trimmedTitle !== initialTrimmedTitle;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="no-drag max-w-[360px] rounded-[18px] p-0">
        <div className="px-4 pb-4 pt-4">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-stone-900">
            Rename thread
          </h2>

          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSave) {
                event.preventDefault();
                onSave(trimmedTitle);
              }
            }}
            className="no-drag mt-2 h-10 w-full rounded-[10px] border border-stone-200 bg-white px-3 text-[14px] text-stone-900 focus:outline-none"
          />

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              className="h-8 rounded-[10px] px-3 text-[13px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-8 rounded-[10px] bg-stone-900 px-4 text-[13px] font-semibold text-white hover:bg-stone-800 disabled:bg-stone-300"
              disabled={!canSave}
              onClick={() => onSave(trimmedTitle)}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
