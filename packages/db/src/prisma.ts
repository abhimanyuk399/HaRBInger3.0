import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: (process.env.PRISMA_LOG?.split(',') ?? []) as Array<'query' | 'info' | 'warn' | 'error'>,
});

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}
