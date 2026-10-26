import { useAuth } from '../../auth/AuthContext';
import { GroupsAdmin } from './GroupsAdmin';
import { UsersAdmin } from './UsersAdmin';

/** Utilisateurs puis groupes sur une même page ; les groupes demandent le droit de configuration. */
export function UsersGroupsAdmin() {
  const { can } = useAuth();
  return (
    <>
      <UsersAdmin />
      {can('settings:manage') && <GroupsAdmin />}
    </>
  );
}
