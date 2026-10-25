import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export interface NewNotification {
  ticketId?: number;
  kind: string;
  message: string;
}

/** Notifications affichées dans la cloche de l'interface. */
export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  async notify(db: Db, userIds: Iterable<string>, n: NewNotification) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    await db.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
  }

  async list(userId: string) {
    const [items, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, id?: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(id && { id }) },
      data: { readAt: new Date() },
    });
  }
}
