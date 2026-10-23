import { newId } from "@session-relay/shared";
import { generateToken, hashToken } from "./auth.js";
import type { Sql } from "./db/client.js";

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "team";
}

export interface CreatedOrg {
  orgId: string;
  slug: string;
  userId: string;
  token: string;
}

/** Creates an org, its settings, its owner and the owner's first token, in one transaction. */
export async function createOrgWithOwner(
  tx: Sql,
  input: { org: string; slug?: string; email: string; name: string; tokenName?: string },
): Promise<CreatedOrg> {
  const base = input.slug ? slugify(input.slug) : slugify(input.org);
  let slug = base;
  for (let i = 2; (await tx`SELECT 1 FROM orgs WHERE slug = ${slug}`).length; i++) slug = `${base}-${i}`;

  const orgId = newId("org");
  const token = generateToken();
  await tx`INSERT INTO orgs (id, name, slug) VALUES (${orgId}, ${input.org}, ${slug})`;
  await tx`INSERT INTO org_settings (org_id) VALUES (${orgId})`;
  const [existing] = await tx`SELECT id FROM users WHERE email = ${input.email}`;
  const userId: string = existing?.id ?? newId("usr");
  if (!existing) await tx`INSERT INTO users (id, email, name) VALUES (${userId}, ${input.email}, ${input.name})`;
  await tx`INSERT INTO memberships (org_id, user_id, role) VALUES (${orgId}, ${userId}, 'owner')`;
  await tx`INSERT INTO api_tokens (id, org_id, user_id, token_hash, name)
           VALUES (${newId("tok")}, ${orgId}, ${userId}, ${hashToken(token)}, ${input.tokenName ?? "owner"})`;
  return { orgId, slug, userId, token };
}
