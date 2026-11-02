import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { displays, kinds, resolveDisplay, severities } from '@openstuff-dev/announce';
import type { Message, MessageInput, MessagesPage } from '@open-announce/contracts';
import { tenantAccess } from '../auth.js';
import { type Client, type Pool, withScope } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { idParam, tenantParam, uuid } from './shared.js';

const time = z.iso.datetime({ offset: true }).nullable().optional();

export const messageInput = z
  .object({
    kind: z.enum(kinds),
    display: z.enum(displays),
    severity: z.enum(severities).default('info'),
    title: z.string().trim().min(1, 'Give the message a title.').max(200),
    body: z.string().max(10000).default(''),
    closeable: z.boolean().optional(),
    linkUrl: z.url({ protocol: /^https?$/ }).nullable().optional(),
    linkLabel: z.string().trim().max(80).nullable().optional(),
    status: z.enum(['draft', 'published', 'archived']).default('draft'),
    startsAt: time,
    endsAt: time,
    systemIds: z.array(uuid).max(200).default([]),
    groupIds: z.array(uuid).max(200).default([]),
  })
  .superRefine((m, ctx) => {
    if (m.startsAt && m.endsAt && m.endsAt <= m.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'The end has to be after the start.' });
    }
  }) satisfies z.ZodType<MessageInput>;

const BASE_COLUMNS = `m.id, m.kind, m.display, m.severity, m.title, m.body, m.closeable,
  m.link_url AS "linkUrl", m.link_label AS "linkLabel", m.status, m.starts_at AS "startsAt",
  m.ends_at AS "endsAt", m.created_at AS "createdAt", m.updated_at AS "updatedAt"`;

export const MESSAGE_COLUMNS = `${BASE_COLUMNS},
  coalesce((SELECT json_agg(s.system_id) FROM message_systems s WHERE s.message_id = m.id), '[]')
    AS "systemIds",
  coalesce((SELECT json_agg(g.group_id) FROM message_groups g WHERE g.message_id = m.id), '[]')
    AS "groupIds"`;

export function registerMessageRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/t/:tenant/messages', async (request): Promise<MessagesPage> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin', 'developer']);
    return withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<{ page: MessagesPage }>(
        `SELECT json_build_object(
          'messages', coalesce((SELECT json_agg(x ORDER BY x."updatedAt" DESC) FROM
             (SELECT ${MESSAGE_COLUMNS} FROM messages m) x), '[]'),
          'systems', coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name) FROM systems), '[]'),
          'groups', coalesce((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY name) FROM groups), '[]')
        ) AS page`,
      );
      return rows[0].page;
    });
  });

  app.post('/api/t/:tenant/messages', async (request, reply): Promise<Message> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const input = messageInput.parse(request.body);
    const message = await withScope(pool, { tenantId }, (db) =>
      saveMessage(db, tenantId, null, input),
    );
    void reply.code(201);
    return message;
  });

  app.put('/api/t/:tenant/messages/:id', async (request): Promise<Message> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const input = messageInput.parse(request.body);
    return withScope(pool, { tenantId }, (db) => saveMessage(db, tenantId, id, input));
  });

  app.delete('/api/t/:tenant/messages/:id', async (request): Promise<{ ok: true }> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    await withScope(pool, { tenantId }, (db) => db.query('DELETE FROM messages WHERE id = $1', [id]));
    return { ok: true };
  });
}

/** Creates (id null) or replaces a message and its targets, after checking the display rules. */
export async function saveMessage(
  db: Client,
  tenantId: string,
  id: string | null,
  input: MessageInput,
  times?: { createdAt: string; updatedAt: string },
): Promise<Message> {
  const display = resolveDisplay(input.kind, input.display, input.closeable);
  if (!display.ok) throw new HttpError(400, display.error);
  const values = [
    tenantId,
    input.kind,
    display.display,
    input.severity,
    input.title,
    input.body,
    display.closeable,
    input.linkUrl ?? null,
    input.linkUrl ? (input.linkLabel ?? null) : null,
    input.status,
    input.startsAt ?? null,
    input.endsAt ?? null,
  ];
  const saved = id
    ? await db.query<{ id: string }>(
        `UPDATE messages SET kind = $2, display = $3, severity = $4, title = $5, body = $6, closeable = $7,
           link_url = $8, link_label = $9, status = $10, starts_at = $11, ends_at = $12, updated_at = now()
         WHERE id = $13 AND tenant_id = $1 RETURNING id`,
        [...values, id],
      )
    : await db.query<{ id: string }>(
        `INSERT INTO messages (tenant_id, kind, display, severity, title, body, closeable, link_url, link_label,
           status, starts_at, ends_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13, now()), coalesce($14, now()))
         RETURNING id`,
        [...values, times?.createdAt ?? null, times?.updatedAt ?? null],
      );
  const messageId = saved.rows.at(0)?.id;
  if (!messageId) throw notFound('That message');
  // Targets: replaced in full. Only ids this tenant can see are kept (foreign keys skip
  // row-level security). Then the saved message, all in one round trip.
  const { rows } = await db.query<Message>(
    `WITH s0 AS (DELETE FROM message_systems WHERE message_id = $2),
          g0 AS (DELETE FROM message_groups WHERE message_id = $2),
          s1 AS (INSERT INTO message_systems (tenant_id, message_id, system_id)
                 SELECT $1, $2, id FROM systems WHERE id = ANY($3::uuid[]) RETURNING system_id),
          g1 AS (INSERT INTO message_groups (tenant_id, message_id, group_id)
                 SELECT $1, $2, id FROM groups WHERE id = ANY($4::uuid[]) RETURNING group_id)
     SELECT ${BASE_COLUMNS},
       coalesce((SELECT json_agg(system_id) FROM s1), '[]') AS "systemIds",
       coalesce((SELECT json_agg(group_id) FROM g1), '[]') AS "groupIds"
     FROM messages m WHERE m.id = $2`,
    [tenantId, messageId, input.systemIds, input.groupIds],
  );
  return rows[0];
}
