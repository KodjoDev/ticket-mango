import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

/** Crée le premier administrateur. Idempotent : ne modifie pas un compte existant. */
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD (12 caractères minimum) sont requis');
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Administrateur ${email} déjà présent, rien à faire.`);
      return;
    }
    await prisma.user.create({
      data: { email, name: 'Administrateur', role: 'ADMIN', passwordHash: await hashPassword(password) },
    });
    console.log(`Administrateur ${email} créé.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
