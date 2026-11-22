import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import { ipRateLimit } from './requestLimits.ts';

const digest = (value: string) => createHash('sha256').update(value).digest();

export function createPasscodeGuards(config: Config) {
  const admin = config.adminPasscode ? digest(config.adminPasscode) : undefined;
  const contributor = config.contributorPasscode ? digest(config.contributorPasscode) : undefined;
  const loopback = config.host === '127.0.0.1' || config.host === 'localhost';
  const pipelineAllowed = Boolean(admin) || loopback || config.allowUnauthenticatedDemo;
  const openPipeline = pipelineAllowed && !admin && !contributor;
  const failures = ipRateLimit(12, 60_000);

  function guard(scope: 'admin' | 'contributor', permitDemo = false) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (failures.blocked(request.ip)) return reply.code(429).send({ error: 'Too many authentication attempts' });
      const headers = scope === 'admin' ? [request.headers['x-admin-passcode']]
        : [request.headers['x-upload-passcode'], request.headers['x-admin-passcode']];
      const expected = scope === 'admin' ? [admin] : [admin, contributor];
      let matched = false;
      for (const header of headers) {
        if (typeof header !== 'string') continue;
        const provided = digest(header);
        for (const secret of expected) if (secret && timingSafeEqual(secret, provided)) matched = true;
      }
      if (scope === 'admin' ? matched : ((permitDemo && openPipeline) || (pipelineAllowed && matched))) return;
      failures.record(request.ip);
      return reply.code(401).send({ error: scope === 'admin' ? 'Valid admin passcode is required' : 'Valid upload passcode is required' });
    };
  }

  return { admin: guard('admin'), contributor: guard('contributor', true), uploadFile: guard('contributor') };
}

export type PasscodeGuards = ReturnType<typeof createPasscodeGuards>;
