import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { User } from '../api/types';
import { Avatar, ErrorMessage } from './ui';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Choix du demandeur d'un ticket saisi par le support : recherche parmi les utilisateurs actifs,
 * ou création d'un contact externe à partir de son adresse e-mail.
 */
export function RequesterPicker({
  onSelect,
  onCancel,
  disabled,
}: {
  onSelect: (user: User) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');

  // Attend une courte pause dans la saisie avant d'interroger l'API.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({ queryKey: ['requesters', search], queryFn: () => api.requesters(search) });
  const create = useMutation({ mutationFn: api.createRequester, onSuccess: onSelect });

  const email = query.trim().toLowerCase();
  const canCreate =
    EMAIL_PATTERN.test(email) && search === query.trim() && !results.data?.some((u) => u.email === email);

  // Pas de <form> : le sélecteur s'insère aussi dans le formulaire de création de ticket.
  function onCreate() {
    if (name.trim()) create.mutate({ email, name: name.trim() });
  }

  return (
    <div className="requester-picker">
      <input
        aria-label="Rechercher un demandeur"
        placeholder="Nom ou adresse e-mail"
        autoFocus
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
      />
      <ErrorMessage error={results.error ?? create.error} />
      {results.data && results.data.length > 0 && (
        <ul className="requester-results">
          {results.data.map((u) => (
            <li key={u.id}>
              <button type="button" disabled={disabled} onClick={() => onSelect(u)}>
                <Avatar name={u.name} size="sm" />
                <span>
                  {u.name} <span className="muted small">{u.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.data?.length === 0 && !canCreate && (
        <p className="muted small">Aucun résultat. Saisissez une adresse e-mail pour créer le contact.</p>
      )}
      {canCreate && (
        <div className="inline-form">
          <input
            aria-label="Nom du nouveau contact"
            placeholder={`Nom de ${email}`}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCreate();
              }
            }}
          />
          <button type="button" disabled={disabled || create.isPending || !name.trim()} onClick={onCreate}>
            Créer le contact
          </button>
        </div>
      )}
      <div className="link-row">
        <button type="button" className="link" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  );
}
