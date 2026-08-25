import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sessionId: string; role: 'student' | 'admin' };
    user: { sub: string; sessionId: string; role: 'student' | 'admin' };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
