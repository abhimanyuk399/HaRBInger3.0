import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-white/20 dark:bg-white/5 dark:text-white',
        className
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
