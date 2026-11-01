import type { FastifyInstance } from 'fastify';
import { auth } from '../auth.js';
import { fromNodeHeaders } from 'better-auth/node';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { Resend } from 'resend';
import { config } from '../config.js';

const resend = new Resend(config.resendApiKey);

export function reportRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.post('/api/reports', async (request, reply) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) return reply.status(401).send({ error: 'Not authenticated' });

    const { type, message } = request.body as { type?: string; message?: string };

    if (!type || (type !== 'bug' && type !== 'actor')) {
      return reply.status(400).send({ error: 'type must be "bug" or "actor"' });
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return reply.status(400).send({ error: 'message is required' });
    }
    if (message.length > 4000) {
      return reply.status(400).send({ error: 'message too long' });
    }

    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'username'])
      .where('id', '=', session.user.id)
      .executeTakeFirst();

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const subject = type === 'bug' ? 'Bug Report' : 'Bad Actor Report';
    const html = [
      `<h2>${subject}</h2>`,
      `<p><strong>From:</strong> ${esc(user?.username || 'unknown')} (${esc(user?.email || 'unknown')})</p>`,
      `<p><strong>User ID:</strong> ${esc(session.user.id)}</p>`,
      `<hr>`,
      `<p>${esc(message.trim()).replace(/\n/g, '<br>')}</p>`,
    ].join('');

    const { error } = await resend.emails.send({
      from: 'wazam <noreply@wazup.chat>',
      to: 'yo@wazup.chat',
      subject: `[wazam] ${subject}`,
      html,
    });

    if (error) {
      app.log.error('Failed to send report email: %s', JSON.stringify(error));
      return reply.status(500).send({ error: 'Failed to send report' });
    }

    return reply.status(204).send();
  });
}
