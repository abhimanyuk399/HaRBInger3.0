import pino from 'pino';
import pinoHttp from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'http';
import { Writable } from 'stream';

const defaultRedact = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.set-cookie',
  'req.headers.x-api-key',
  'req.body',
  'req.raw.body',
  'res.body',
  'payload',
  'token',
  'jwt',
  'pii',
];

function isEnabled(raw: string | undefined) {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolvedRedactPaths() {
  if (!isEnabled(process.env.LOG_INCLUDE_BODIES)) {
    return defaultRedact;
  }
  const bodyPaths = new Set(['req.body', 'req.raw.body', 'res.body', 'payload']);
  return defaultRedact.filter((path) => !bodyPaths.has(path));
}

function readHeader(headers: IncomingMessage['headers'], key: string): string | null {
  const raw = headers[key];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === 'string') {
      const trimmed = first.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

function createPrettyJsonStream() {
  return new Writable({
    write(chunk, _encoding, callback) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
        } catch {
          process.stdout.write(`${line}\n`);
        }
      }
      callback();
    },
  });
}

export function createLogger(serviceName?: string) {
  const options = {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: serviceName ?? process.env.SERVICE_NAME,
    },
    redact: {
      paths: resolvedRedactPaths(),
      remove: true,
    },
  };

  if (isEnabled(process.env.LOG_PRETTY_JSON)) {
    return pino(options, createPrettyJsonStream());
  }

  return pino(options);
}

function sanitizeHeaders(headers: IncomingMessage['headers']) {
  const masked: Record<string, string | string[] | undefined> = { ...headers };
  if (masked.authorization) masked.authorization = '***';
  if (masked.cookie) masked.cookie = '***';
  if (masked['set-cookie']) masked['set-cookie'] = '***';
  if (masked['x-api-key']) masked['x-api-key'] = '***';
  return masked;
}

function shouldSkipHttpLog(req: IncomingMessage) {
  if (!isEnabled(process.env.LOG_SKIP_HEALTHCHECKS)) {
    return false;
  }
  const url = typeof req.url === 'string' ? req.url : '';
  return url.startsWith('/v1/health');
}

export function httpLogger(serviceName?: string) {
  const logger = createLogger(serviceName);
  const includeHeaders = isEnabled(process.env.LOG_HTTP_INCLUDE_HEADERS);
  return pinoHttp({
    logger: logger as never,
    autoLogging: {
      ignore: shouldSkipHttpLog,
    },
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) {
        return 'error';
      }
      if (res.statusCode >= 400) {
        return 'warn';
      }
      if (res.statusCode === 304 || res.statusCode === 204) {
        return 'debug';
      }
      return process.env.LOG_HTTP_SUCCESS_LEVEL === 'debug' ? 'debug' : 'info';
    },
    customAttributeKeys: {
      req: 'request',
      res: 'response',
      err: 'error',
      responseTime: 'durationMs',
    },
    serializers: {
      req(req: IncomingMessage) {
        const serialized = {
          method: req.method,
          url: req.url,
          action: readHeader(req.headers, 'x-console-action'),
          traceId: readHeader(req.headers, 'x-console-trace-id'),
          referer: readHeader(req.headers, 'referer'),
        } as {
          method: string | undefined;
          url: string | undefined;
          action: string | null;
          traceId: string | null;
          referer: string | null;
          headers?: Record<string, string | string[] | undefined>;
        };
        if (includeHeaders) {
          serialized.headers = sanitizeHeaders(req.headers);
        }
        return {
          ...serialized,
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  });
}
