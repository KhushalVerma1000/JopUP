import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useFetch } from './useFetch';

/**
 * Stage lists keyed by workflow template id, each in pipeline order. Lets a screen know a
 * candidate's "next stage" without every card fetching its own copy.
 */
export function useStagesByTemplate() {
  const workflows = useFetch('/api/v1/workflows');
  const [stagesByTemplate, setStagesByTemplate] = useState({});

  useEffect(() => {
    const templates = workflows.data?.templates || [];
    if (templates.length === 0) return;
    let cancelled = false;
    Promise.all(templates.map(async (t) => {
      const res = await apiFetch(`/api/v1/workflows/${t.id}/stages`);
      return [t.id, [...res.data.stages].sort((a, b) => a.orderIndex - b.orderIndex)];
    })).then((entries) => { if (!cancelled) setStagesByTemplate(Object.fromEntries(entries)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workflows.data]);

  return stagesByTemplate;
}
