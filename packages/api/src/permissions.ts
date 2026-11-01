import type { Kysely } from 'kysely';
import type { Database } from './db/database.js';
import { ALL_PERMISSIONS, hasPermission } from '@wazam/shared';
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function computePermissions(
  db: Kysely<Database>,
  userId: string,
  clubId: string,
): Promise<bigint> {
  const club = await db
    .selectFrom('clubs')
    .select('owner_id')
    .where('id', '=', clubId)
    .executeTakeFirst();

  if (!club) return 0n;
  if (club.owner_id === userId) return ALL_PERMISSIONS;

  const membership = await db
    .selectFrom('memberships')
    .select('id')
    .where('user_id', '=', userId)
    .where('club_id', '=', clubId)
    .executeTakeFirst();

  if (!membership) return 0n;

  const roles = await db
    .selectFrom('member_roles')
    .innerJoin('roles', 'roles.id', 'member_roles.role_id')
    .select('roles.permissions')
    .where('member_roles.membership_id', '=', membership.id)
    .execute();

  const defaultRole = await db
    .selectFrom('roles')
    .select('permissions')
    .where('club_id', '=', clubId)
    .where('is_default', '=', true)
    .executeTakeFirst();

  let perms = defaultRole ? BigInt(defaultRole.permissions) : 0n;
  for (const role of roles) {
    perms |= BigInt(role.permissions);
  }
  return perms;
}

export function requirePermission(db: Kysely<Database>, permission: bigint) {
  return async function checkPermission(request: FastifyRequest, reply: FastifyReply) {
    const clubId = (request.params as { clubId?: string }).clubId;
    if (!clubId || !request.userId) {
      return reply.status(400).send({ error: 'Missing club context' });
    }

    const perms = await computePermissions(db, request.userId, clubId);
    if (!hasPermission(perms, permission)) {
      return reply.status(403).send({ error: 'Missing permissions' });
    }
  };
}
