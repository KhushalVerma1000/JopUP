import { useFetch } from '../../hooks/useFetch';
import { Field } from '@/components/common';
import { NativeSelect } from '@/components/ui/native-select';

const KIND_GROUP = { flow: 'Over a period', snapshot: 'Right now' };

/** The metric catalogue as a picker. `teamOnly` hides metrics that can't be measured for one person. */
export function MetricSelect({ id, label = 'Measured by', value, onChange, teamOnly = false, cumulativeOnly = false }) {
  const { data } = useFetch('/api/v1/performance/metrics');
  const all = data?.metrics || [];
  const metrics = all.filter((m) => (!teamOnly || m.userScope) && (!cumulativeOnly || m.cumulative));
  const picked = all.find((m) => m.key === value);

  return (
    <Field label={label} htmlFor={id} hint={picked?.description}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a metric</option>
        {Object.entries(KIND_GROUP).map(([kind, title]) => {
          const group = metrics.filter((m) => m.kind === kind);
          return group.length ? (
            <optgroup key={kind} label={title}>
              {group.map((m) => <option key={m.key} value={m.key}>{m.label}{m.unit && m.unit !== 'count' ? ` (${m.unit})` : ''}</option>)}
            </optgroup>
          ) : null;
        })}
      </NativeSelect>
    </Field>
  );
}

export const AutoBadge = ({ children = 'Automatic' }) => (
  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{children}</span>
);
