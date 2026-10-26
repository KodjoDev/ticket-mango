import type {
  Impact,
  LayoutItem,
  ListColumn,
  MacroActions,
  OptionField,
  Priority,
  PriorityMatrix,
  Role,
  SlaCalendar,
  SlaMetricState,
  SlaPolicy,
  SlaState,
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
  group: { id: string; name: string } | null;
  tags: TagRef[];
  sla: SlaStatusDto;
  slaState: SlaState;
  slaDueAt: string | null;
  parent: { id: number; subject: string; status: TicketStatus } | null;
  channel: 'WEB' | 'EMAIL';
  mailboxId: string | null;
  /** Doublon fusionné : ticket qui le remplace. */
  mergedInto: { id: number; subject: string } | null;
  /** Pièces jointes de la demande initiale. */
  attachments: AttachmentRef[];
  childCount: number;
  /** Le demandeur s'est exprimé après la dernière réponse publique du support. */
  awaitingAgent: boolean;
  lastRequesterReplyAt: string | null;
  lastAgentReplyAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SlaMetricDto {
  state: SlaMetricState;
  targetMinutes: number;
  elapsedMinutes: number;
  remainingMinutes: number;
  dueAt: string | null;
}

export interface SlaStatusDto {
  calendar: SlaCalendar;
  firstResponse: SlaMetricDto;
  resolution: SlaMetricDto;
  state: SlaState;
  dueAt: string | null;
}

/** Détail d'un ticket : avec les tickets rattachés s'il est référent. */
export interface TicketDetail extends Ticket {
  children: { id: number; subject: string; status: TicketStatus; priority: Priority; requester: { id: string; name: string } }[];
}

export interface Notification {
  id: string;
  ticketId: number | null;
  kind: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface GroupRef {
  id: string;
  name: string;
  isActive: boolean;
  memberIds: string[];
}

export type Distribution = 'ROUND_ROBIN' | 'LOAD' | 'MANUAL';

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  distribution: Distribution;
  managerId: string | null;
  manager: { id: string; name: string } | null;
  isActive: boolean;
  position: number;
  members: { id: string; name: string; role: Role; isActive: boolean }[];
  ticketCount: number;
}

export interface RuleConditions {
  type?: string[];
  component?: string[];
  environment?: string[];
  priority?: Priority[];
}

export interface RoutingRule {
  id: string;
  name: string;
  conditions: RuleConditions;
  groupId: string;
  group: { id: string; name: string };
  position: number;
  isActive: boolean;
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
  slaPolicy: SlaPolicy;
  groups: GroupRef[];
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

export interface AttachmentRef {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface OutboundStatusRef {
  /** SKIPPED : aucun SMTP configuré, message seulement journalisé. */
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  toAddress: string;
  sentAt: string | null;
  lastError: string | null;
}

export interface Comment {
  id: string;
  body: string;
  isInternal: boolean;
  channel: 'WEB' | 'EMAIL';
  createdAt: string;
  author: { id: string; name: string };
  attachments: AttachmentRef[];
  /** État de l'envoi par e-mail (visible du support). */
  outbound?: OutboundStatusRef[];
}

export interface Mailbox {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean;
  imapUser: string | null;
  imapFolder: string;
  hasPassword: boolean;
  defaultType: string | null;
  defaultGroupId: string | null;
  webhookUrl: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastUid: number | null;
}

export type InboundStatus = 'PROCESSED' | 'DUPLICATE' | 'AUTO_REPLY' | 'BULK' | 'SPAM' | 'LOOP' | 'ERROR';

export interface InboundLog {
  id: string;
  messageId: string;
  fromAddress: string;
  subject: string;
  status: InboundStatus;
  reason: string | null;
  ticketId: number | null;
  receivedAt: string;
  size: number;
  canRetry: boolean;
  mailbox: { address: string } | null;
}

export interface OutboundLog {
  id: string;
  ticketId: number;
  toAddress: string;
  subject: string;
  status: OutboundStatusRef['status'];
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface EmailSettings {
  acknowledge: boolean;
  blocklist: string[];
  maxPerSenderPerHour: number;
  ignoreBulk: boolean;
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
  groupId?: string;
  slaState?: SlaState[];
  awaitingAgent?: boolean;
  sort?: 'created' | 'sla';
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
  requesterId: string;
  assigneeId: string | null;
  groupId: string | null;
  tagIds: string[];
}>;
