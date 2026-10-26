import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  blocksOf,
  type PageBlock,
  type PageBlockItem,
  type PageColumn,
  type TicketStatus,
} from "@ticketing/shared";
import { api, ApiError } from "../api/client";
import type { Agent, Ticket, TicketDetail, TicketInput } from "../api/types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useConfig } from "../config/ConfigContext";
import { CustomFieldInputs } from "./CustomFields";
import { QualificationFields } from "./QualificationFields";
import { DevLinksCard } from "./DevLinks";
import { MergeCard } from "./Merge";
import { ReferentCard } from "./Referent";
import { RequesterHistory } from "./RequesterHistory";
import { RequesterPicker } from "./Requester";
import { SlaCard } from "./Sla";
import {
  Avatar,
  ErrorMessage,
  Field,
  formatDate,
  options,
  PriorityBadge,
  StatusBadge,
} from "./ui";

/** Libellé du bouton selon la transition (réouverture, renvoi en arrière…). */
function transitionLabel(from: TicketStatus, to: TicketStatus): string {
  if (from === "RESOLVED" && to === "QUALIFYING") return "Rouvrir";
  if (to === "CLOSED") return "Clôturer";
  if (to === "RESOLVED") return "Résoudre";
  return STATUS_LABELS[to];
}

interface BlocksProps {
  ticket: TicketDetail;
  agents: Agent[];
  column: PageColumn;
  layout: PageBlockItem[];
  /** Blocs fournis par la page (description, conversation…). */
  extra: Partial<Record<PageBlock, ReactNode>>;
}

/**
 * Blocs d'une colonne de la page ticket, dans l'ordre configuré. Chaque colonne en porte une instance :
 * un bloc n'est rendu que dans la colonne où l'administrateur l'a placé.
 */
export function TicketBlocks({
  ticket,
  agents,
  column,
  layout,
  extra,
}: BlocksProps) {
  const { can } = useAuth();
  const config = useConfig();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const closed = ticket.status === "CLOSED";
  const [editingRequester, setEditingRequester] = useState(false);

  const onSuccess = (updated: Ticket) => {
    // Fusion : la réponse ne contient pas la liste des tickets rattachés du détail.
    queryClient.setQueryData<TicketDetail>(["ticket", ticket.id], (old) =>
      old ? { ...old, ...updated } : old,
    );
    void queryClient.invalidateQueries({
      queryKey: ["ticket", ticket.id, "audit"],
    });
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    void queryClient.invalidateQueries({ queryKey: ["views"] });
  };
  // Conflit (modification concurrente) : on recharge la version à jour.
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      void queryClient.invalidateQueries({ queryKey: ["ticket", ticket.id] });
    }
  };

  const update = useMutation({
    mutationFn: (input: TicketInput) => api.updateTicket(ticket.id, input),
    onSuccess,
    onError,
  });
  const changeRequester = useMutation({
    mutationFn: (requesterId: string) =>
      api.updateTicket(ticket.id, { requesterId }),
    onSuccess: (updated: Ticket) => {
      onSuccess(updated);
      setEditingRequester(false);
    },
    onError,
  });
  const transition = useMutation({
    mutationFn: (to: TicketStatus) => api.transition(ticket.id, to),
    onSuccess,
    onError,
  });
  const route = useMutation({
    mutationFn: () => api.route(ticket.id),
    onSuccess,
    onError,
  });

  const canQualify = can("ticket:qualify") && !closed;
  const canAssign = can("ticket:assign") && !closed;
  const nextStatuses = can("ticket:transition")
    ? STATUS_TRANSITIONS[ticket.status]
    : [];
  const busy =
    update.isPending ||
    transition.isPending ||
    route.isPending ||
    changeRequester.isPending;
  // Membres du groupe du ticket proposés en premier dans la liste d'assignation.
  const groupMembers = new Set(
    config.groups.find((g) => g.id === ticket.group?.id)?.memberIds ?? [],
  );
  const sortedAgents = [...agents].sort(
    (a, b) => Number(groupMembers.has(b.id)) - Number(groupMembers.has(a.id)),
  );

  const blocks: Partial<Record<PageBlock, ReactNode>> = {
    ...extra,
    requesterHistory: can("ticket:read:all") ? (
      <RequesterHistory ticketId={ticket.id} />
    ) : null,
    requester: (
      <section className="card">
        <h2>Demandeur</h2>
        <ErrorMessage error={changeRequester.error} />
        <div className="requester">
          <Avatar name={ticket.requester.name} />
          <div>
            <strong>{ticket.requester.name}</strong>
            <div className="muted small">{ticket.requester.email}</div>
          </div>
        </div>
        {canQualify &&
          (editingRequester ? (
            <RequesterPicker
              disabled={busy}
              onSelect={(u) =>
                u.id === ticket.requester.id
                  ? setEditingRequester(false)
                  : changeRequester.mutate(u.id)
              }
              onCancel={() => setEditingRequester(false)}
            />
          ) : (
            <div className="link-row">
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => setEditingRequester(true)}
              >
                Changer le demandeur
              </button>
            </div>
          ))}
      </section>
    ),
    sla:
      can("ticket:read:all") && ticket.status !== "CLOSED" ? (
        <SlaCard sla={ticket.sla} />
      ) : null,
    status: (
      <section className="card">
        <h2>Statut</h2>
        <StatusBadge status={ticket.status} />
        {ticket.fixedInVersion && (
          <p className="small">
            Corrigé dans la version <strong>{ticket.fixedInVersion}</strong>
          </p>
        )}
        <ErrorMessage error={transition.error} />
        {nextStatuses.length > 0 && (
          <div className="transitions">
            {nextStatuses.map((to) => (
              <button
                key={to}
                type="button"
                disabled={busy}
                onClick={() => transition.mutate(to)}
              >
                {transitionLabel(ticket.status, to)}
              </button>
            ))}
          </div>
        )}
      </section>
    ),
    qualification: (
      <section className="card">
        <h2>Qualification</h2>
        <ErrorMessage error={update.error} />
        <QualificationFields
          values={{ ...ticket, tagIds: ticket.tags.map((t) => t.id) }}
          onChange={(change) => update.mutate(change)}
          disabled={!canQualify || busy}
          supportFields={can("ticket:read:all")}
        />
        <CustomFieldInputs
          // Les valeurs sont remontées au serveur : la clé force la relecture après chaque enregistrement.
          key={ticket.updatedAt}
          fields={config.customFields}
          values={ticket.customValues ?? {}}
          live={false}
          disabled={!canQualify || busy}
          onChange={(key, value) =>
            update.mutate({ customValues: { [key]: value } })
          }
        />

        <div className="field">
          <span className="field-label">Priorité</span>
          <div className="priority-row">
            <PriorityBadge priority={ticket.priority} />
            <span className="muted small">
              {ticket.priorityOverridden
                ? "forcée manuellement"
                : "calculée (impact × urgence)"}
            </span>
          </div>
          {can("ticket:priority:override") && !closed && (
            <select
              aria-label="Forcer la priorité"
              disabled={busy}
              value={ticket.priorityOverridden ? ticket.priority : ""}
              onChange={(e) =>
                update.mutate({
                  priority: (e.target.value || null) as
                    Ticket["priority"] | null,
                })
              }
            >
              <option value="">Automatique (matrice)</option>
              {options(PRIORITIES, PRIORITY_LABELS)}
            </select>
          )}
        </div>
      </section>
    ),
    assignment: (
      <section className="card">
        <h2>Assignation</h2>
        <ErrorMessage error={route.error} />
        {canAssign ? (
          <>
            <Field label="Groupe">
              <select
                aria-label="Groupe"
                disabled={busy}
                value={ticket.group?.id ?? ""}
                onChange={(e) =>
                  update.mutate({ groupId: e.target.value || null })
                }
              >
                <option value="">Aucun groupe</option>
                {config.groups
                  .filter((g) => g.isActive || g.id === ticket.group?.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Agent">
              <select
                aria-label="Agent assigné"
                disabled={busy}
                value={ticket.assignee?.id ?? ""}
                onChange={(e) =>
                  update.mutate({ assigneeId: e.target.value || null })
                }
              >
                <option value="">Non assigné</option>
                {sortedAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {groupMembers.has(a.id) ? " (groupe)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <div className="link-row">
              {ticket.assignee?.id !== user.id && can("ticket:transition") && (
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() => update.mutate({ assigneeId: user.id })}
                >
                  M'assigner ce ticket
                </button>
              )}
              <button
                type="button"
                className="link"
                disabled={busy}
                onClick={() => route.mutate()}
              >
                Relancer le routage
              </button>
            </div>
          </>
        ) : (
          <p>
            {ticket.group && (
              <span className="muted">{ticket.group.name} · </span>
            )}
            {ticket.assignee?.name ?? (
              <span className="muted">Non assigné</span>
            )}
          </p>
        )}
      </section>
    ),
    devLinks: <DevLinksCard ticket={ticket} />,
    referent: <ReferentCard ticket={ticket} />,
    merge: <MergeCard ticket={ticket} />,
    dates: (
      <section className="card">
        <h2>Dates</h2>
        <dl className="dates">
          <dt>Création</dt>
          <dd>{formatDate(ticket.createdAt)}</dd>
          <dt>Première réponse</dt>
          <dd>{formatDate(ticket.firstResponseAt)}</dd>
          <dt>Résolution</dt>
          <dd>{formatDate(ticket.resolvedAt)}</dd>
          <dt>Clôture</dt>
          <dd>{formatDate(ticket.closedAt)}</dd>
        </dl>
      </section>
    ),
  };

  const keys = blocksOf(layout, column).filter((k) => blocks[k]);
  return (
    <div className={column === "side" ? "ticket-side" : "ticket-main"}>
      {keys.map((k) => (
        <Fragment key={k}>{blocks[k]}</Fragment>
      ))}
    </div>
  );
}
