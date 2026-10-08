import { CalendarClock, ListChecks, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Floating bar while selecting. Sits above the phone's bottom tab bar (same
 * offsets as the Add candidate button, which is hidden while this is showing).
 */
export function BulkBar({ count, total, onToggleAll, onDates, onStatus, onCancel, canDates, canStatus }) {
  return (
    <div role="region" aria-label="Bulk actions" className="pb-safe fixed inset-x-3 bottom-20 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-lg md:inset-x-auto md:bottom-8 md:right-8 md:w-[34rem]">
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{count} selected</span>
        <button type="button" onClick={onToggleAll} className="ml-2 min-h-8 text-primary underline-offset-2 hover:underline">{count === total ? 'Clear' : `Select all ${total}`}</button>
      </div>
      {canDates && <Button size="sm" variant="outline" disabled={count === 0} onClick={onDates}><CalendarClock /> Dates</Button>}
      {canStatus && <Button size="sm" disabled={count === 0} onClick={onStatus}><ListChecks /> Status</Button>}
      <Button size="icon" variant="ghost" aria-label="Stop selecting" onClick={onCancel}><X /></Button>
    </div>
  );
}
