import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Use lowercase letters, digits and dashes.');
export const name = z.string().trim().min(1, 'Give it a name.').max(120);
export const uuid = z.uuid();
export const idParam = z.object({ tenant: slug, id: uuid });
export const tenantParam = z.object({ tenant: slug });

/** A slug from a name: "Customer Portal" → "customer-portal". */
export function slugify(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return s || 'item';
}

export const newPublicKey = () => `pk_${randomBytes(18).toString('base64url')}`;
export const newSigningSecret = () => `sk_${randomBytes(32).toString('base64url')}`;
/** A publish key: lets another system post News to this one. Stored only as a hash. */
export const newPublishKey = () => `ak_${randomBytes(30).toString('base64url')}`;

/** An http(s) URL, without a trailing slash. */
export const baseUrl = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href.replace(/\/$/, '');
    } catch {
      // Falls through to the issue below.
    }
    ctx.addIssue({ code: 'custom', message: `"${value}" isn’t a URL like https://versions.example.com.` });
    return z.NEVER;
  });
