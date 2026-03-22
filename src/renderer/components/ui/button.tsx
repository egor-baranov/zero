import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@renderer/lib/cn';

const buttonVariants = cva(
  'no-drag inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-stone-900 text-stone-50 shadow-[0_8px_24px_-18px_rgba(15,15,15,0.85)] hover:bg-stone-800',
        secondary:
          'border border-stone-200 bg-white/90 text-stone-700 hover:bg-stone-100',
        outline:
          'border border-stone-200 bg-transparent text-stone-700 hover:bg-stone-100/80',
        ghost: 'text-stone-600 hover:bg-stone-100',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        lg: 'h-10 px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  ),
);

Button.displayName = 'Button';

export { Button, buttonVariants };
