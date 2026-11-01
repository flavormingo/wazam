import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createAuthMiddleware } from '../middleware.js';
import { computePermissions } from '../permissions.js';
import { Permissions, hasPermission, ALL_PERMISSIONS } from '@wazam/shared';

export function roleRoutes(app: FastifyInstance, db: Kysely<Database>) {
  const requireAuth = createAuthMiddleware(db);

  app.get('/api/club/:clubId/roles', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', request.userId!)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!membership) return reply.status(403).send({ error: 'Not a member' });

    const roles = await db
      .selectFrom('roles')
      .selectAll()
      .where('club_id', '=', clubId)
      .orderBy('position')
      .execute();

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      permissions: r.permissions,
      position: r.position,
      is_default: r.is_default,
      color: r.color,
    }));
  });

  app.post('/api/club/:clubId/roles', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId } = request.params as { clubId: string };
    const { name, permissions = '0', color } = request.body as {
      name: string;
      permissions?: string;
      color?: string;
    };

    if (!name || !name.trim() || name.trim().length > 64) {
      return reply.status(400).send({ error: 'Role name is required (max 64 chars)' });
    }

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return reply.status(403).send({ error: 'Missing MANAGE_ROLES permission' });
    }

    const last = await db
      .selectFrom('roles')
      .select('position')
      .where('club_id', '=', clubId)
      .orderBy('position', 'desc')
      .executeTakeFirst();

    const position = (last?.position ?? -1) + 1;

    if (!hasPermission(perms, Permissions.ADMIN)) {
      try {
        const requested = BigInt(permissions);
        if ((requested & ~perms) !== 0n) {
          return reply.status(403).send({ error: 'Cannot grant permissions you do not have' });
        }
      } catch {
        return reply.status(400).send({ error: 'Invalid permissions value' });
      }
    }

    const role = await db
      .insertInto('roles')
      .values({
        club_id: clubId,
        name: name.trim(),
        permissions,
        position,
        color: color ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'role.create',
      target_type: 'role',
      target_id: role.id,
      metadata: JSON.stringify({ name }),
    }).execute();

    return reply.status(201).send({
      id: role.id,
      name: role.name,
      permissions: role.permissions,
      position: role.position,
      is_default: role.is_default,
      color: role.color,
    });
  });

  app.patch('/api/club/:clubId/roles/:roleId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, roleId } = request.params as { clubId: string; roleId: string };
    const body = request.body as { name?: string; permissions?: string; color?: string | null; position?: number };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return reply.status(403).send({ error: 'Missing MANAGE_ROLES permission' });
    }

    const existing = await db
      .selectFrom('roles')
      .select('permissions')
      .where('id', '=', roleId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!existing) return reply.status(404).send({ error: 'Role not found' });

    if (!hasPermission(perms, Permissions.ADMIN)) {
      let rolePerms: bigint;
      try {
        rolePerms = BigInt(existing.permissions);
      } catch {
        rolePerms = 0n;
      }
      if ((rolePerms & ~perms) !== 0n) {
        return reply.status(403).send({ error: 'Cannot edit a role granting permissions you do not have' });
      }
    }

    if (body.permissions !== undefined && !hasPermission(perms, Permissions.ADMIN)) {
      try {
        const requested = BigInt(body.permissions);
        if ((requested & ~perms) !== 0n) {
          return reply.status(403).send({ error: 'Cannot grant permissions you do not have' });
        }
      } catch {
        return reply.status(400).send({ error: 'Invalid permissions value' });
      }
    }

    const trimmedName = body.name?.trim();
    if (body.name !== undefined && !trimmedName) {
      return reply.status(400).send({ error: 'Name cannot be empty' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (trimmedName) updates.name = trimmedName;
    if (body.permissions !== undefined) updates.permissions = body.permissions;
    if (body.color !== undefined) updates.color = body.color;
    if (body.position !== undefined) updates.position = body.position;

    const role = await db
      .updateTable('roles')
      .set(updates)
      .where('id', '=', roleId)
      .where('club_id', '=', clubId)
      .returningAll()
      .executeTakeFirst();

    if (!role) return reply.status(404).send({ error: 'Role not found' });

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'role.update',
      target_type: 'role',
      target_id: roleId,
      metadata: JSON.stringify(body),
    }).execute();

    return {
      id: role.id,
      name: role.name,
      permissions: role.permissions,
      position: role.position,
      is_default: role.is_default,
      color: role.color,
    };
  });

  app.delete('/api/club/:clubId/roles/:roleId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, roleId } = request.params as { clubId: string; roleId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return reply.status(403).send({ error: 'Missing MANAGE_ROLES permission' });
    }

    const role = await db
      .selectFrom('roles')
      .select(['is_default', 'permissions'])
      .where('id', '=', roleId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!role) return reply.status(404).send({ error: 'Role not found' });
    if (role.is_default) return reply.status(400).send({ error: 'Cannot delete the default role' });

    if (!hasPermission(perms, Permissions.ADMIN)) {
      let rolePerms: bigint;
      try {
        rolePerms = BigInt(role.permissions);
      } catch {
        rolePerms = 0n;
      }
      if ((rolePerms & ~perms) !== 0n) {
        return reply.status(403).send({ error: 'Cannot delete a role granting permissions you do not have' });
      }
    }

    const deleted = await db.deleteFrom('roles').where('id', '=', roleId).where('club_id', '=', clubId).executeTakeFirst();
    if (!deleted.numDeletedRows) return reply.status(500).send({ error: 'Failed to delete role' });

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'role.delete',
      target_type: 'role',
      target_id: roleId,
    }).execute();

    return { ok: true };
  });

  app.post('/api/club/:clubId/members/:userId/roles', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, userId } = request.params as { clubId: string; userId: string };
    const { role_id } = request.body as { role_id: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return reply.status(403).send({ error: 'Missing MANAGE_ROLES permission' });
    }

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', userId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!membership) return reply.status(404).send({ error: 'Member not found' });

    const role = await db
      .selectFrom('roles')
      .select(['id', 'permissions'])
      .where('id', '=', role_id)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!role) return reply.status(404).send({ error: 'Role not found in this club' });

    if (!hasPermission(perms, Permissions.ADMIN)) {
      let rolePerms: bigint;
      try {
        rolePerms = BigInt(role.permissions);
      } catch {
        rolePerms = 0n;
      }
      if ((rolePerms & ~perms) !== 0n) {
        return reply.status(403).send({ error: 'Cannot assign a role granting permissions you do not have' });
      }
    }

    await db
      .insertInto('member_roles')
      .values({ membership_id: membership.id, role_id })
      .onConflict((oc) => oc.columns(['membership_id', 'role_id']).doNothing())
      .execute();

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'role.assign',
      target_type: 'user',
      target_id: userId,
      metadata: JSON.stringify({ role_id }),
    }).execute();

    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/club/:clubId/members/:userId/roles/:roleId', { preHandler: requireAuth }, async (request, reply) => {
    const { clubId, userId, roleId } = request.params as { clubId: string; userId: string; roleId: string };

    const perms = await computePermissions(db, request.userId!, clubId);
    if (!hasPermission(perms, Permissions.MANAGE_ROLES)) {
      return reply.status(403).send({ error: 'Missing MANAGE_ROLES permission' });
    }

    const membership = await db
      .selectFrom('memberships')
      .select('id')
      .where('user_id', '=', userId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!membership) return reply.status(404).send({ error: 'Member not found' });

    const role = await db
      .selectFrom('roles')
      .select('permissions')
      .where('id', '=', roleId)
      .where('club_id', '=', clubId)
      .executeTakeFirst();

    if (!role) return reply.status(404).send({ error: 'Role not found in this club' });

    if (!hasPermission(perms, Permissions.ADMIN)) {
      let rolePerms: bigint;
      try {
        rolePerms = BigInt(role.permissions);
      } catch {
        rolePerms = 0n;
      }
      if ((rolePerms & ~perms) !== 0n) {
        return reply.status(403).send({ error: 'Cannot remove a role granting permissions you do not have' });
      }
    }

    const removed = await db
      .deleteFrom('member_roles')
      .where('membership_id', '=', membership.id)
      .where('role_id', '=', roleId)
      .executeTakeFirst();

    if (!removed.numDeletedRows) return reply.status(404).send({ error: 'Member does not have this role' });

    await db.insertInto('audit_log').values({
      club_id: clubId,
      actor_id: request.userId!,
      action: 'role.remove',
      target_type: 'user',
      target_id: userId,
      metadata: JSON.stringify({ role_id: roleId }),
    }).execute();

    return { ok: true };
  });
}
