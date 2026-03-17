import * as React from 'react';
import { cn } from '@renderer/lib/cn';

interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
}

export const Separator = ({
  className,
  orientation = 'horizontal',
  ...props
}: SeparatorProps): JSX.Element => {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-stone-200/80',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
};
