import type Redis from 'ioredis';

export interface ReplayProtector {
  consume(key: string, ttlSeconds: number): Promise<boolean>;
}

export class RedisReplayProtector implements ReplayProtector {
  constructor(private readonly redis: Redis, private readonly prefix = 'replay') {}

  async consume(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(`${this.prefix}:${key}`, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}

export class InMemoryReplayProtector implements ReplayProtector {
  private readonly entries = new Map<string, number>();

  async consume(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.entries.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }
    this.entries.set(key, now + ttlSeconds * 1000);
    return true;
  }
}
