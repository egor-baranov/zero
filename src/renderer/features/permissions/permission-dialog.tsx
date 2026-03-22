import type { AcpPermissionRequestEvent } from '@shared/types/acp';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Button } from '@renderer/components/ui/button';

interface PermissionDialogProps {
  request: AcpPermissionRequestEvent | null;
  onResolve: (requestId: string, optionId: string) => void;
  onCancel: (requestId: string) => void;
}

export const PermissionDialog = ({
  request,
  onResolve,
  onCancel,
}: PermissionDialogProps): JSX.Element => {
  const isOpen = request !== null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && request) {
          onCancel(request.requestId);
        }
      }}
    >
      <DialogContent className="no-drag max-w-[640px] rounded-[28px] border-none bg-stone-100/80 p-4">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-900">
              {request?.toolCall.title ?? 'Tool approval needed'}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              The agent requested permission to run a tool call for this session.
            </p>
          </div>

          <div className="space-y-1.5">
            {request?.options.map((option) => (
              <Button
                key={option.optionId}
                variant="secondary"
                className={`
                  h-10 w-full justify-start rounded-2xl border-none bg-stone-200/55 px-3 text-sm font-medium
                  text-stone-800 hover:bg-stone-300/75 focus-visible:ring-stone-400
                `}
                onClick={() => onResolve(request.requestId, option.optionId)}
              >
                {option.name}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
