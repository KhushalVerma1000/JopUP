import { ArrowRightLeft, Pause, X } from 'lucide-react';
import { Sheet } from '@/components/common';

/**
 * The "⋯" menu on a candidate card: the less common actions, one tap each,
 * 48px rows. Anything the person's role can't do is simply not listed.
 */
export function CandidateActionsSheet({ tracker, onClose, canAdvance, canHold, canBlock, onChooseStage, onHold, onReject }) {
  const run = (fn) => () => { const t = tracker; onClose(); fn(t); };
  const rows = [
    canAdvance && { key: 'stage', icon: ArrowRightLeft, label: 'Choose Another Stage…', hint: 'Skip ahead or go back', fn: onChooseStage },
    canHold && { key: 'hold', icon: Pause, label: 'Put on Hold', hint: 'You can resume any time', fn: onHold },
    canBlock && { key: 'reject', icon: X, label: 'Reject…', hint: 'Asks for a reason first', fn: onReject, danger: true },
  ].filter(Boolean);
  return (
    <Sheet open={!!tracker} onClose={onClose} title={tracker?.candidateName || 'Actions'}>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.key}>
              <button type="button" onClick={run(r.fn)}
                className={`flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-accent active:bg-accent ${r.danger ? 'text-destructive' : ''}`}>
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
