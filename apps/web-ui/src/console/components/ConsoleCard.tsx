import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function ConsoleCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        'kyc-console-card rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_14px_44px_rgba(15,23,42,0.09)] backdrop-blur-sm sm:rounded-3xl sm:p-5',
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold tracking-tight text-slate-900', className)} {...props} />;
}

export function CardHint({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-slate-600/95', className)} {...props} />;
}
