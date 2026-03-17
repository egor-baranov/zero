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
      <DialogContent className="no-drag max-w-[540px] rounded-[24px] p-5">
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-stone-500">
              Permission Request
            </p>
            <h2 className="mt-1 text-lg font-semibold text-stone-800">
              {request?.toolCall.title ?? 'Tool approval needed'}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              The agent requested permission to run a tool call for this session.
            </p>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-3">
            <p className="text-xs font-medium text-stone-600">Session</p>
            <p className="mt-1 text-xs text-stone-500">{request?.sessionId}</p>
          </div>

          <div className="space-y-2">
            {request?.options.map((option) => (
              <Button
                key={option.optionId}
                variant="secondary"
                className="h-10 w-full justify-start rounded-xl border border-stone-200/95 px-3 text-sm"
                onClick={() => onResolve(request.requestId, option.optionId)}
              >
                {option.name}
              </Button>
            ))}
          </div>

          <Button
            variant="ghost"
            className="h-9 w-full rounded-xl text-sm text-stone-500"
            onClick={() => {
              if (request) {
                onCancel(request.requestId);
              }
            }}
          >
            Cancel Prompt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
