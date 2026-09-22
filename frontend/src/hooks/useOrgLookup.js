import { useState, useEffect } from 'react';
import { apiFetch, ApiError } from '../lib/api';

/**
 * Resolves a slug into { id, name, slug } via the public
 * GET /organizations/by-slug/:slug endpoint, and (optionally) its team list
 * via GET /organizations/by-slug/:slug/teams. Both are unauthenticated and
 * deliberately return only non-sensitive fields (see
 * backend organization.service.js's getPublicOrgBySlug/getPublicTeamsBySlug).
 *
 * This is the one place that turns a slug into something a human-friendly
 * UI can use — everything downstream (LoginPage, RegisterPage) works with
 * `organization.id` and a team's `id`, never asking the person to type or
 * even see a UUID.
 *
 * @param {string|undefined} slug
 * @param {{ withTeams?: boolean }} [options]
 */
export function useOrgLookup(slug, { withTeams = false } = {}) {
  const [organization, setOrganization] = useState(null);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(!!slug);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) {
      setOrganization(null);
      setTeams([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function run() {
      try {
        const orgRes = await apiFetch(`/api/v1/organizations/by-slug/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        setOrganization(orgRes.data.organization);

        if (withTeams) {
          const teamsRes = await apiFetch(`/api/v1/organizations/by-slug/${encodeURIComponent(slug)}/teams`);
          if (cancelled) return;
          setTeams(teamsRes.data.teams);
        }
      } catch (err) {
        if (cancelled) return;
        setOrganization(null);
        setTeams([]);
        setError(
          err instanceof ApiError && err.status === 404
            ? "We couldn't find a workspace with that ID."
            : 'Something went wrong looking up that workspace.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [slug, withTeams]);

  return { organization, teams, loading, error };
}
