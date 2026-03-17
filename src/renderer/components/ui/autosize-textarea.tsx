import * as React from 'react';
import { cn } from '@renderer/lib/cn';

export interface AutosizeTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
  maxRows?: number;
}

const AutosizeTextarea = React.forwardRef<HTMLTextAreaElement, AutosizeTextareaProps>(
  ({ className, minRows = 1, maxRows = 6, onChange, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;

        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
          return;
        }

        if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const resize = React.useCallback(() => {
      const textarea = innerRef.current;
      if (!textarea) {
        return;
      }

      textarea.style.height = 'auto';

      const computed = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(computed.lineHeight) || 22;
      const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
      const minHeight = minRows * lineHeight + borderTop + borderBottom;
      const maxHeight = maxRows * lineHeight + borderTop + borderBottom;

      const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }, [maxRows, minRows]);

    React.useLayoutEffect(() => {
      resize();
    }, [resize, props.value]);

    return (
      <textarea
        ref={setRefs}
        className={cn(
          'no-drag w-full resize-none bg-transparent text-[15px] leading-6 text-stone-700 placeholder:text-stone-400 focus:outline-none',
          className,
        )}
        onChange={(event) => {
          resize();
          onChange?.(event);
        }}
        rows={minRows}
        {...props}
      />
    );
  },
);

AutosizeTextarea.displayName = 'AutosizeTextarea';

export { AutosizeTextarea };
