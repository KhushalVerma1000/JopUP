import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Ready to send?" Plain problems with what to do about each, or one green line when
 * there are none. Errors are things the mail cannot go without; warnings are worth a look.
 */
export function ReadyChecks({ checks = [], className }) {
  if (checks.length === 0) {
    return <div className={cn('flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-800', className)}><CheckCircle2 className="size-4" aria-hidden /> Ready to send</div>;
  }
  return (
    <ul className={cn('space-y-1.5', className)} aria-label="Before you send">
      {checks.map((c) => {
        const Icon = c.level === 'error' ? XCircle : AlertTriangle;
        return (
          <li key={c.id} className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]', c.level === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900')}>
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{c.text}{c.fixTo && <> <Link to={c.fixTo} className="font-medium underline">Fix it</Link></>}</span>
          </li>
        );
      })}
    </ul>
  );
}
