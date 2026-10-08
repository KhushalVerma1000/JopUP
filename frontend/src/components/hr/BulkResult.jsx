import { Notice } from '@/components/common';

/**
 * What a bulk change did (or would do): who changes, and who is skipped with
 * the reason. Shared by the dates and status sheets so they read the same.
 * `detail(item)` is the short right-hand text for a changed candidate.
 */
export function BulkResult({ result, done, noun = 'change', detail = () => '' }) {
  if (!result) return null;
  const { applied, skipped } = result;
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <p className="text-sm font-medium">
        {done
          ? `${applied.length} updated${skipped.length ? `, ${skipped.length} skipped` : ''}`
          : `${applied.length} will ${noun}${skipped.length ? `, ${skipped.length} will be skipped` : ''}`}
      </p>
      {applied.length > 0 && (
        <ul className="max-h-48 divide-y overflow-auto rounded-md border text-sm">
          {applied.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{a.candidateName || 'Candidate'}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{detail(a)}</span>
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <Notice tone="warn" title={done ? 'Not changed' : 'Will be skipped'}>
          <ul className="mt-1 list-disc pl-4">
            {skipped.map((s) => <li key={s.id}>{s.candidateName ? <strong>{s.candidateName}</strong> : 'A candidate'}: {s.reason}</li>)}
          </ul>
        </Notice>
      )}
    </div>
  );
}
