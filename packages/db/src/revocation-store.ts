import { prisma } from './prisma.js';
import type { RevocationStore } from '@bharat/common';

export class PrismaRevocationStore implements RevocationStore {
  async isRevoked(jti: string): Promise<boolean> {
    const record = await prisma.revokedToken.findUnique({ where: { jti } });
    return Boolean(record);
  }

  async revoke(jti: string, reason?: string): Promise<void> {
    await prisma.revokedToken.upsert({
      where: { jti },
      create: { jti, reason },
      update: { reason },
    });
    await prisma.tokenRegistry.updateMany({
      where: { jti },
      data: { status: 'REVOKED' },
    });
  }
}
