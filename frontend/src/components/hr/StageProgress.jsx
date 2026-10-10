import { cn } from '@/lib/utils';

/**
 * A thin segmented bar: how far along the workflow a candidate is.
 * Decorative for sighted users; screen readers get "Stage 4 of 7: Turn up".
 * Segments come from the candidate's own workflow, so the count varies by team.
 */
export function StageProgress({ stages, currentStageId, className }) {
  if (!stages || stages.length < 2) return null;
  const idx = stages.findIndex((s) => s.id === currentStageId);
  if (idx < 0) return null;
  return (
    <div className={cn('flex gap-1', className)} role="img" aria-label={`Stage ${idx + 1} of ${stages.length}: ${stages[idx].name}`}>
      {stages.map((s, i) => (
        <span key={s.id} aria-hidden className={cn('h-1 min-w-3 flex-1 rounded-full', i <= idx ? 'bg-primary' : 'bg-border')} />
      ))}
    </div>
  );
}
