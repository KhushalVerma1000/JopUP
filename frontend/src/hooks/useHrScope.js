import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useFetch } from './useFetch';

/**
 * Which teams / open positions this HR user works with. Shared by every
 * tab of the HR workbench so teams and positions are fetched once.
 */
export function useHrScope() {
  const auth = useAuth();
  const teams = useFetch('/api/v1/teams');
  const positions = useFetch('/api/v1/open-positions');

  const myTeamIds = useMemo(() => {
    if (auth.isOrgAdmin) return (teams.data?.teams || []).map((t) => t.id);
    return [...new Set([...auth.hrTeamIds, ...auth.managedTeamIds])];
  }, [auth.isOrgAdmin, auth.hrTeamIds, auth.managedTeamIds, teams.data]);

  const myTeams = useMemo(() => (teams.data?.teams || []).filter((t) => myTeamIds.includes(t.id)), [teams.data, myTeamIds]);
  const myPositions = useMemo(
    () => (positions.data?.positions || []).filter((p) => myTeamIds.includes(p.teamId)),
    [positions.data, myTeamIds],
  );

  return {
    myTeamIds,
    myTeams,
    positions: myPositions,
    openPositions: myPositions.filter((p) => p.status === 'open'),
    positionsLoading: positions.loading && !positions.data,
    positionsError: positions.error,
    reloadPositions: positions.reload,
  };
}
