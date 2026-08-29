import '@fastify/jwt';
import 'fastify';
import type { RealtimeHub } from '../realtime.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sessionId: string; role: 'student' | 'admin'; mustChangePassword?: boolean };
    user: { sub: string; sessionId: string; role: 'student' | 'admin'; mustChangePassword?: boolean };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    realtime: RealtimeHub;
  }
}
