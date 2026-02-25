import { cn } from "../../lib/utils";

export function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200/80 dark:bg-slate-700/60", className)} />;
}

export function LoadingListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, idx) => (
        <LoadingSkeleton key={idx} className="h-10 w-full" />
      ))}
    </div>
  );
}
