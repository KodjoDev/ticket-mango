import {
  DEFAULT_PRIORITY_MATRIX,
  IMPACT_LABELS,
  IMPACTS,
  PRIORITIES,
  URGENCIES,
  URGENCY_LABELS,
  type Priority,
  type PriorityMatrix,
} from '@ticketing/shared';
import { useState } from 'react';
import { adminApi } from '../../api/client';
import { ErrorMessage } from '../../components/ui';
import { useConfig } from '../../config/ConfigContext';
import { useAdminMutation } from './common';

export function PriorityAdmin() {
  const config = useConfig();
  const [matrix, setMatrix] = useState<PriorityMatrix>(config.priorityMatrix);
  const save = useAdminMutation(adminApi.savePriorityMatrix);
  const dirty = JSON.stringify(matrix) !== JSON.stringify(config.priorityMatrix);

  const set = (impact: (typeof IMPACTS)[number], urgency: (typeof URGENCIES)[number], priority: Priority) =>
    setMatrix((m) => ({ ...m, [impact]: { ...m[impact], [urgency]: priority } }));

  return (
    <div className="admin-section">
      <section className="card">
        <h2>Matrice impact × urgence</h2>
        <p className="muted small">
          La priorité est recalculée à chaque création et requalification de ticket. Un changement ici ne modifie pas les
          tickets existants tant qu'ils ne sont pas requalifiés, et n'affecte pas les priorités forcées.
        </p>
        <ErrorMessage error={save.error} />
        <table className="matrix">
          <thead>
            <tr>
              <th>Impact \ Urgence</th>
              {URGENCIES.map((u) => (
                <th key={u}>{URGENCY_LABELS[u]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IMPACTS.map((impact) => (
              <tr key={impact}>
                <th>{IMPACT_LABELS[impact]}</th>
                {URGENCIES.map((urgency) => (
                  <td key={urgency}>
                    <select
                      aria-label={`${IMPACT_LABELS[impact]} × ${URGENCY_LABELS[urgency]}`}
                      className={`matrix-cell priority-${matrix[impact][urgency].toLowerCase()}`}
                      value={matrix[impact][urgency]}
                      onChange={(e) => set(impact, urgency, e.target.value as Priority)}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button type="button" onClick={() => setMatrix(DEFAULT_PRIORITY_MATRIX)}>
            Valeurs par défaut
          </button>
          <button type="button" className="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(matrix)}>
            Enregistrer
          </button>
        </div>
      </section>
    </div>
  );
}
