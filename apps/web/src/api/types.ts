import type {
  Impact,
  LayoutItem,
  ListColumn,
  MacroActions,
  OptionField,
  Priority,
  PriorityMatrix,
  Role,
  TicketFormField,
  TicketStatus,
  Urgency,
  ViewFilters,
} from '@ticketing/shared';

/** Formes renvoyées par l'API (les dates arrivent en chaînes ISO). */

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface ManagedUser extends User {
  isActive: boolean;
  createdAt: string;
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
  /** Clés des listes administrables (voir FieldOption). */
  type: string;
  component: string | null;
  environment: string | null;
  impact: Impact;
  urgency: Urgency;
  priority: Priority;
  priorityOverridden: boolean;
  status: TicketStatus;
  requester: { id: string; name: string; email: string };
  assignee: { id: string; name: string } | null;
  tags: TagRef[];
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TagRef {
  id: string;
  name: string;
  color: string;
}

export interface Tag extends TagRef {
  isActive: boolean;
}

export interface FieldOption {
  id: string;
  field: OptionField;
  key: string;
  label: string;
  position: number;
  isActive: boolean;
  isSystem: boolean;
}

export interface AppConfig {
  options: FieldOption[];
  tags: Tag[];
  priorityMatrix: PriorityMatrix;
  ticketForm: LayoutItem<TicketFormField>[];
  listColumns: LayoutItem<ListColumn>[];
  features: { spellcheck: boolean; meetingProvider: string };
}

export type MeetingStatus = 'PROPOSED' | 'SCHEDULED' | 'CANCELLED';

export interface Meeting {
  id: string;
  ticketId: number;
  title: string;
  durationMinutes: number;
  status: MeetingStatus;
  startsAt: string | null;
  meetUrl: string | null;
  provider: string;
  bookingUrl: string | null;
  slots: { id: string; startsAt: string }[];
  organizer: { id: string; name: string };
  participants: { id: string; name: string }[];
  createdAt: string;
}

/** Vue publique d'une réservation (sans adresse email). */
export interface Booking {
  status: MeetingStatus;
  title: string;
  ticket: { id: number; subject: string };
  organizer: string;
  durationMinutes: number;
  participants: string[];
  slots: { id: string; startsAt: string }[];
  startsAt: string | null;
  meetUrl: string | null;
  provider: string;
}

export interface Macro {
  id: string;
  systemKey: string | null;
  name: string;
  body: string;
  isInternal: boolean;
  actions: MacroActions;
  position: number;
  isActive: boolean;
}

export interface SpellcheckIssue {
  offset: number;
  length: number;
  message: string;
  category: string;
  ruleId: string;
  replacements: string[];
}

export interface View {
  id: string;
  name: string;
  filters: ViewFilters;
  position: number;
  count: number;
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
  type?: string;
  component?: string;
  /** Identifiant d'agent ou « none » (non assigné). */
  assigneeId?: string;
  tagId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export type TicketInput = Partial<{
  subject: string;
  description: string;
  type: string;
  component: string | null;
  environment: string | null;
  impact: Impact;
  urgency: Urgency;
  priority: Priority | null;
  assigneeId: string | null;
  tagIds: string[];
}>;
