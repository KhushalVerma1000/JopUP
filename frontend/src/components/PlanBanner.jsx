import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { usePlan } from '../hooks/usePlan';
import { cn } from '@/lib/utils';

/**
 * One slim line while a trial's Pro preview is running: what they are using,
 * and how long they keep it. Nothing shows once the preview ends (the lock
 * cards explain it where the features were) or for paid and platform users.
 */
export function PlanBanner() {
  const { preview, usage } = usePlan();
  if (!preview?.active || !usage?.trial?.active) return null;

  const name = preview.planName || 'Pro';
  const n = preview.daysLeft;
  const urgent = n <= 3;
  return (
    <div
      role="status"
      className={cn(
        'border-b px-4 py-2 text-sm md:px-8',
        urgent ? 'border-amber-300/60 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100' : 'bg-accent/50',
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <strong>{name} preview:</strong>{' '}
          {urgent ? `ends in ${n} day${n === 1 ? '' : 's'}. ` : `${n} days left. `}
          KPIs, goals, reviews and strategy are on for you.
        </span>
        <Link to="/upgrade" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
          Keep {name}
        </Link>
      </div>
    </div>
  );
}
