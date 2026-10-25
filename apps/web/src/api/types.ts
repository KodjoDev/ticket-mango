import type {
  Component,
  Environment,
  Impact,
  Priority,
  Role,
  TicketStatus,
  TicketType,
  Urgency,
} from '@ticketing/shared';

/** Formes renvoyées par l'API (les dates arrivent en chaînes ISO). */

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Agent {
  id: string;
  name: string;
  role: Role;
}

export interface Ticket {
  id: number;
  subject: string;
  description: string;
  type: TicketType;
  component: Component | null;
  environment: Environment | null;
  impact: Impact;
  urgency: Urgency;
  priority: Priority;
  priorityOverridden: boolean;
  status: TicketStatus;
  requester: { id: string; name: string; email: string };
  assignee: { id: string; name: string } | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Comment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; name: string };
}

export interface AuditEntry {
  id: string;
  action: string;
  changes: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface TicketFilters {
  status?: TicketStatus[];
  priority?: Priority[];
  type?: TicketType;
  component?: Component;
  assigneeId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export type TicketInput = Partial<{
  subject: string;
  description: string;
  type: TicketType;
  component: Component | null;
  environment: Environment | null;
  impact: Impact;
  urgency: Urgency;
  priority: Priority | null;
  assigneeId: string | null;
}>;
