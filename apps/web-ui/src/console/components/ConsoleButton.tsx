import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface ConsoleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

const intentClass: Record<NonNullable<ConsoleButtonProps['intent']>, string> = {
  primary:
    'border border-slate-900 bg-slate-900 text-white shadow-[0_8px_20px_rgba(15,23,42,0.25)] hover:bg-slate-800 hover:border-slate-800 disabled:border-slate-300 disabled:bg-slate-300',
  secondary:
    'border border-slate-300 bg-white/95 text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400',
  ghost: 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:text-slate-400',
  danger:
    'border border-rose-600 bg-rose-600 text-white shadow-[0_8px_20px_rgba(225,29,72,0.25)] hover:bg-rose-500 hover:border-rose-500 disabled:border-rose-300 disabled:bg-rose-300',
};

const sizeClass: Record<NonNullable<ConsoleButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export function ConsoleButton({
  className,
  intent = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ConsoleButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed',
        intentClass[intent],
        sizeClass[size],
        className
      )}
      {...props}
    />
  );
}
