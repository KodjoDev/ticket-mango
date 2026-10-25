import {
  DEFAULT_SLA_POLICY,
  PRIORITIES,
  PRIORITY_LABELS,
  SLA_CALENDAR_LABELS,
  type SlaCalendar,
  type SlaPolicy,
} from '@ticketing/shared';
import { useState } from 'react';
import { adminApi } from '../../api/client';
import { ErrorMessage, Field } from '../../components/ui';
import { useConfig } from '../../config/ConfigContext';
import { useAdminMutation } from './common';

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** Saisie d'une durée en heures et minutes, stockée en minutes. */
function DurationInput({ label, minutes, onChange }: { label: string; minutes: number; onChange: (m: number) => void }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <span className="duration-input" role="group" aria-label={label}>
      <input type="number" min={0} aria-label={`${label} (heures)`} value={h} onChange={(e) => onChange(Math.max(0, Number(e.target.value)) * 60 + m)} />
      <span>h</span>
      <input type="number" min={0} max={59} aria-label={`${label} (minutes)`} value={m} onChange={(e) => onChange(h * 60 + Math.min(59, Math.max(0, Number(e.target.value))))} />
      <span>min</span>
    </span>
  );
}

export function SlaAdmin() {
  const config = useConfig();
  const [policy, setPolicy] = useState<SlaPolicy>(config.slaPolicy);
  const [newDate, setNewDate] = useState('');
  const save = useAdminMutation(adminApi.saveSlaPolicy);
  const dirty = JSON.stringify(policy) !== JSON.stringify(config.slaPolicy);
  const bh = policy.businessHours;
  const setBh = (change: Partial<SlaPolicy['businessHours']>) => setPolicy({ ...policy, businessHours: { ...bh, ...change } });

  return (
    <div className="admin-section">
      <section className="card">
        <h2>Objectifs par priorité</h2>
        <ErrorMessage error={save.error} />
        <table className="matrix sla-targets">
          <thead>
            <tr>
              <th>Priorité</th>
              <th>Première réponse</th>
              <th>Résolution</th>
              <th>Décompte</th>
            </tr>
          </thead>
          <tbody>
            {PRIORITIES.map((p) => {
              const t = policy.targets[p];
              const set = (change: Partial<typeof t>) => setPolicy({ ...policy, targets: { ...policy.targets, [p]: { ...t, ...change } } });
              return (
                <tr key={p}>
                  <th>{PRIORITY_LABELS[p]}</th>
                  <td>
                    <DurationInput label={`Première réponse ${p}`} minutes={t.firstResponseMinutes} onChange={(m) => set({ firstResponseMinutes: m })} />
                  </td>
                  <td>
                    <DurationInput label={`Résolution ${p}`} minutes={t.resolutionMinutes} onChange={(m) => set({ resolutionMinutes: m })} />
                  </td>
                  <td>
                    <select aria-label={`Décompte ${p}`} value={t.calendar} onChange={(e) => set({ calendar: e.target.value as SlaCalendar })}>
                      {Object.entries(SLA_CALENDAR_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Field label="Seuil d'alerte « à risque » (% du délai consommé)">
          <input
            type="number"
            min={10}
            max={99}
            className="narrow"
            value={policy.warningPercent}
            onChange={(e) => setPolicy({ ...policy, warningPercent: Number(e.target.value) })}
          />
        </Field>
      </section>

      <section className="card">
        <h2>Heures ouvrées</h2>
        <Field label="Fuseau horaire">
          <input className="narrow-wide" value={bh.timeZone} onChange={(e) => setBh({ timeZone: e.target.value })} />
        </Field>
        <table className="matrix">
          <tbody>
            {DAYS.map((day, i) => {
              const hours = bh.week[i];
              const setDay = (value: (typeof bh.week)[number]) => setBh({ week: bh.week.map((d, j) => (j === i ? value : d)) });
              return (
                <tr key={day}>
                  <th>
                    <label className="checkbox">
                      <input type="checkbox" checked={!!hours} onChange={(e) => setDay(e.target.checked ? { start: '08:00', end: '18:00' } : null)} />
                      {day}
                    </label>
                  </th>
                  <td>
                    {hours ? (
                      <span className="hours">
                        <input type="time" aria-label={`Ouverture ${day}`} value={hours.start} onChange={(e) => setDay({ ...hours, start: e.target.value })} />
                        –
                        <input type="time" aria-label={`Fermeture ${day}`} value={hours.end} onChange={(e) => setDay({ ...hours, end: e.target.value })} />
                      </span>
                    ) : (
                      <span className="muted">Fermé</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="checkbox">
          <input type="checkbox" checked={bh.frenchHolidays} onChange={(e) => setBh({ frenchHolidays: e.target.checked })} />
          Exclure les jours fériés français
        </label>
        <div className="field closed-dates">
          <span className="field-label">Fermetures exceptionnelles</span>
          <div className="tag-list">
            {bh.closedDates.map((d) => (
              <span key={d} className="tag">
                {new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR')}
                <button type="button" className="link" aria-label={`Retirer le ${d}`} onClick={() => setBh({ closedDates: bh.closedDates.filter((x) => x !== d) })}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <span className="inline-form">
            <input type="date" aria-label="Date de fermeture" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <button
              type="button"
              disabled={!newDate || bh.closedDates.includes(newDate)}
              onClick={() => {
                setBh({ closedDates: [...bh.closedDates, newDate].sort() });
                setNewDate('');
              }}
            >
              Ajouter
            </button>
          </span>
        </div>
      </section>

      <div className="actions">
        <button type="button" onClick={() => setPolicy(DEFAULT_SLA_POLICY)}>
          Valeurs du cahier des charges
        </button>
        <button type="button" disabled={!dirty} onClick={() => setPolicy(config.slaPolicy)}>
          Annuler
        </button>
        <button type="button" className="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(policy)}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
