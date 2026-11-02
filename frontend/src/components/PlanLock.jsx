import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { usePlan } from '../hooks/usePlan';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Shown where a plan feature is not available: what it does, a number from the
 * user's own workspace so it feels like theirs, and one way forward. It never
 * hides existing data; it only explains why a screen is closed.
 */
export function PlanLock({ title, children, plan = 'Pro' }) {
  const { preview, usage } = usePlan();
  const candidates = usage?.limits?.max_candidates?.current;
  const ended = preview?.configured && !preview.active;

  return (
    <Card className="items-center gap-3 p-6 text-center md:p-10">
      <span className="flex size-11 items-center justify-center rounded-full bg-accent text-primary"><Lock className="size-5" aria-hidden /></span>
      <h2 className="text-balance text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-balance text-sm text-muted-foreground">
        {ended ? `Your ${preview.planName || plan} preview has ended. ` : `This is part of the ${plan} plan. `}
        {children}
      </p>
      {candidates > 0 && (
        <p className="max-w-md text-balance text-sm">
          You have <strong className="tabular-nums">{candidates.toLocaleString('en-IN')}</strong> candidate{candidates === 1 ? '' : 's'} in your pipeline. {plan} turns that into targets your team can track.
        </p>
      )}
      <Button asChild size="lg" className="mt-1 min-h-11">
        <Link to="/upgrade">Get {plan}</Link>
      </Button>
      <p className="text-xs text-muted-foreground">Everything you have added stays safe.</p>
    </Card>
  );
}
