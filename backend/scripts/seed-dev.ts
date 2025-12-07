import { PrismaClient } from "@prisma/client";
import { webcrypto } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeParticipantsHash } from "@takos/platform/server";

type SeedUser = {
  handle: string;
  displayName: string;
  password: string;
  avatarUrl?: string;
};

type SeedPost = {
  id: string;
  authorHandle: string;
  text: string;
  createdAt: Date;
  communityHandle?: string | null;
  visibility?: "public" | "community" | "followers";
};

type SeedDm = {
  id: string;
  fromHandle: string;
  toHandle: string;
  text: string;
  createdAt: Date;
};

type CliArgs = {
  databaseUrl?: string;
  instanceDomain?: string;
  password?: string;
  help?: boolean;
};

const encoder = new TextEncoder();
const AS_PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

function usage() {
  console.log(
    [
      "Seed the local dev database with sample actors, objects, community, and DM data (v1.8 schema).",
      "",
      "Options:",
      "  --db <url>           Override DATABASE_URL (e.g. file:.wrangler/state/.../db.sqlite)",
      "  --domain <domain>    Instance domain for ActivityPub actor/object URIs (default: INSTANCE_DOMAIN or yourdomain.com)",
      "  --password <text>    Password for seed users (default: SEED_PASSWORD or password123)",
      "  -h, --help           Show this help",
      "",
      "Examples:",
      "  npm --workspace backend exec tsx scripts/seed-dev.ts",
      "  npm --workspace backend exec tsx scripts/seed-dev.ts -- --db file:.wrangler/state/v3/d1/miniflare-D1DatabaseObject/dev.sqlite",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  const input = [...argv];
  while (input.length) {
    const current = input.shift();
    switch (current) {
      case "--db":
      case "--database":
      case "--database-url":
        args.databaseUrl = input.shift();
        break;
      case "--domain":
      case "--instance-domain":
        args.instanceDomain = input.shift();
        break;
      case "--password":
        args.password = input.shift();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

function generateSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const hash = await sha256Hex(`${salt}:${password}`);
  return `${salt}$${hash}`;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function resolvePaths() {
  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const backendDir = path.resolve(scriptDir, "..");
  const d1Dir = path.join(
    backendDir,
    ".wrangler",
    "state",
    "v3",
    "d1",
    "miniflare-D1DatabaseObject",
  );
  const devDb = path.join(backendDir, "prisma", "dev.db");
  return { backendDir, d1Dir, devDb };
}

function resolveDatabaseUrl(cliUrl?: string): string {
  if (cliUrl) return cliUrl;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const { d1Dir, devDb } = resolvePaths();
  if (existsSync(d1Dir)) {
    const candidates = readdirSync(d1Dir)
      .filter((file) => file.endsWith(".sqlite"))
      .map((file) => path.join(d1Dir, file))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (candidates.length) {
      const chosen = candidates[0];
      console.log(`[seed] Using local D1 sqlite: ${chosen}`);
      return `file:${chosen}`;
    }
  }

  console.warn(
    `[seed] No D1 sqlite found under .wrangler/state; falling back to ${devDb}. Set --db or DATABASE_URL to override.`,
  );
  return `file:${devDb}`;
}

function userActorUri(handle: string, domain: string): string {
  return `https://${domain}/ap/users/${handle}`;
}

function groupActorUri(handle: string, domain: string): string {
  return `https://${domain}/ap/groups/${handle}`;
}

function objectUri(id: string, domain: string): string {
  return `https://${domain}/ap/objects/${id}`;
}

async function upsertActor(
  prisma: PrismaClient,
  params: {
    handle: string;
    displayName: string;
    type: "Person" | "Group";
    domain: string;
    ownerId?: string | null;
    metadata?: Record<string, unknown>;
    profileCompletedAt: Date;
    avatarUrl?: string;
  },
) {
  const { handle, displayName, type, domain, ownerId, metadata, profileCompletedAt, avatarUrl } =
    params;
  const id = type === "Group" ? groupActorUri(handle, domain) : userActorUri(handle, domain);
  const basePath = type === "Group" ? `/ap/groups/${handle}` : `/ap/users/${handle}`;
  await prisma.actors.upsert({
    where: { id },
    update: {
      handle,
      type,
      display_name: displayName,
      avatar_url: avatarUrl ?? "",
      owner_id: ownerId ?? null,
      visibility: "public",
      profile_completed_at: profileCompletedAt,
      is_local: 1,
      inbox: `https://${domain}${basePath}/inbox`,
      outbox: `https://${domain}${basePath}/outbox`,
      followers: `https://${domain}${basePath}/followers`,
      following: `https://${domain}${basePath}/following`,
      metadata_json: metadata ? JSON.stringify(metadata) : null,
      updated_at: new Date(),
    },
    create: {
      id,
      local_id: handle,
      handle,
      type,
      display_name: displayName,
      avatar_url: avatarUrl ?? "",
      owner_id: ownerId ?? null,
      visibility: "public",
      profile_completed_at: profileCompletedAt,
      is_local: 1,
      is_bot: 0,
      manually_approves_followers: 0,
      inbox: `https://${domain}${basePath}/inbox`,
      outbox: `https://${domain}${basePath}/outbox`,
      followers: `https://${domain}${basePath}/followers`,
      following: `https://${domain}${basePath}/following`,
      metadata_json: metadata ? JSON.stringify(metadata) : null,
      created_at: profileCompletedAt,
    },
  });
  return id;
}

async function upsertOwnerPassword(prisma: PrismaClient, password: string) {
  const hash = await hashPassword(password);
  await prisma.owner_password.upsert({
    where: { id: 1 },
    update: { password_hash: hash, updated_at: new Date() },
    create: { id: 1, password_hash: hash, updated_at: new Date() },
  });
}

async function upsertUserAccount(prisma: PrismaClient, actorId: string, password: string) {
  const hashed = await hashPassword(password);
  const existing = await prisma.user_accounts.findFirst({
    where: { provider: "password", actor_id: actorId },
  });
  if (existing) {
    await prisma.user_accounts.update({
      where: { id: existing.id },
      data: {
        provider_account_id: actorId,
        password_hash: hashed,
        updated_at: new Date(),
      },
    });
  } else {
    await prisma.user_accounts.create({
      data: {
        id: `acct-${actorId}`,
        actor_id: actorId,
        provider: "password",
        provider_account_id: actorId,
        password_hash: hashed,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }
}

async function upsertMembership(
  prisma: PrismaClient,
  communityActorId: string,
  actorId: string,
  role: "owner" | "admin" | "moderator" | "member",
  joinedAt: Date,
) {
  await prisma.memberships.upsert({
    where: {
      community_id_actor_id: {
        community_id: communityActorId,
        actor_id: actorId,
      },
    },
    update: { role, status: "active" },
    create: {
      community_id: communityActorId,
      actor_id: actorId,
      role,
      status: "active",
      joined_at: joinedAt,
    },
  });
}

async function upsertChannel(
  prisma: PrismaClient,
  communityActorId: string,
  channelId: string,
  name: string,
  createdAt: Date,
) {
  await prisma.channels.upsert({
    where: { id: channelId },
    update: { name, actor_id: communityActorId },
    create: {
      id: channelId,
      actor_id: communityActorId,
      name,
      position: 0,
      created_at: createdAt,
    },
  });
}

async function upsertFollow(prisma: PrismaClient, follower: string, following: string) {
  if (follower === following) return;
  await prisma.follows.upsert({
    where: { follower_id_following_id: { follower_id: follower, following_id: following } },
    update: { status: "accepted" },
    create: {
      id: `follow-${follower}-to-${following}`,
      follower_id: follower,
      following_id: following,
      status: "accepted",
      created_at: new Date(),
    },
  });
}

async function upsertPost(
  prisma: PrismaClient,
  post: SeedPost,
  instanceDomain: string,
  actorIdMap: Record<string, string>,
) {
  const actorId = actorIdMap[post.authorHandle];
  const communityActorId = post.communityHandle ? actorIdMap[post.communityHandle] : null;
  const id = objectUri(post.id, instanceDomain);
  const visibility = post.visibility ?? (communityActorId ? "community" : "public");
  const to = visibility === "public" ? [AS_PUBLIC] : [];
  const cc = communityActorId ? [communityActorId] : [];
  await prisma.objects.upsert({
    where: { id },
    update: {
      actor: actorId,
      type: "Note",
      published: post.createdAt.toISOString(),
      to,
      cc,
      context: communityActorId ?? null,
      visibility,
      content: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id,
        type: "Note",
        actor: actorId,
        content: post.text,
        published: post.createdAt.toISOString(),
        to,
        cc,
        context: communityActorId ?? undefined,
      },
      updated: new Date().toISOString(),
    },
    create: {
      id,
      local_id: post.id,
      actor: actorId,
      type: "Note",
      published: post.createdAt.toISOString(),
      to,
      cc,
      context: communityActorId ?? null,
      visibility,
      is_local: 1,
      content: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id,
        type: "Note",
        actor: actorId,
        content: post.text,
        published: post.createdAt.toISOString(),
        to,
        cc,
        context: communityActorId ?? undefined,
      },
    },
  });
}

async function upsertDm(
  prisma: PrismaClient,
  dm: SeedDm,
  instanceDomain: string,
  actorIdMap: Record<string, string>,
) {
  const fromActor = actorIdMap[dm.fromHandle];
  const toActor = actorIdMap[dm.toHandle];
  const participants = [fromActor, toActor].sort();
  const context = computeParticipantsHash(participants);
  const id = objectUri(dm.id, instanceDomain);
  const to = [toActor];
  await prisma.objects.upsert({
    where: { id },
    update: {
      actor: fromActor,
      type: "Note",
      published: dm.createdAt.toISOString(),
      to,
      visibility: "direct",
      context,
      content: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id,
        type: "Note",
        actor: fromActor,
        content: dm.text,
        to,
        context,
      },
    },
    create: {
      id,
      local_id: dm.id,
      actor: fromActor,
      type: "Note",
      published: dm.createdAt.toISOString(),
      to,
      visibility: "direct",
      is_local: 1,
      context,
      content: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id,
        type: "Note",
        actor: fromActor,
        content: dm.text,
        to,
        context,
      },
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const databaseUrl = resolveDatabaseUrl(args.databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.TAKOS_CONTEXT = process.env.TAKOS_CONTEXT || "dev";
  process.env.ACTIVITYPUB_ENABLED = process.env.ACTIVITYPUB_ENABLED || "false";

  const instanceDomain = (args.instanceDomain || process.env.INSTANCE_DOMAIN || "yourdomain.com")
    .trim()
    .toLowerCase();
  const defaultPassword = args.password || process.env.SEED_PASSWORD || "password123";
  const adminHandle = (process.env.AUTH_USERNAME || "admin").trim().toLowerCase();
  const adminPassword = process.env.AUTH_PASSWORD || defaultPassword;
  const profileCompletedAt = new Date();

  const users: SeedUser[] = [
    { handle: adminHandle, displayName: "Admin", password: adminPassword },
    { handle: "alice", displayName: "Alice Doe", password: defaultPassword },
    { handle: "bob", displayName: "Bob Roe", password: defaultPassword },
  ];

  const communityHandle = "dev-community";
  const posts: SeedPost[] = [
    {
      id: "dev-welcome-admin",
      authorHandle: adminHandle,
      text: "Welcome to the takos dev workspace 👋",
      createdAt: minutesAgo(45),
      visibility: "public",
    },
    {
      id: "dev-alice-home",
      authorHandle: "alice",
      text: "Alice here—testing the timeline with seeded data.",
      createdAt: minutesAgo(35),
      visibility: "public",
    },
    {
      id: "dev-bob-home",
      authorHandle: "bob",
      text: "Bob dropping a note so everyone has something to read.",
      createdAt: minutesAgo(25),
      visibility: "public",
    },
    {
      id: "dev-community-welcome",
      authorHandle: adminHandle,
      text: "Dev Community is live—say hi in #general!",
      createdAt: minutesAgo(15),
      communityHandle,
      visibility: "community",
    },
    {
      id: "dev-community-alice",
      authorHandle: "alice",
      text: "Kicking off our first community thread.",
      createdAt: minutesAgo(10),
      communityHandle,
      visibility: "community",
    },
  ];

  const dms: SeedDm[] = [
    {
      id: "dm-alice-to-bob",
      fromHandle: "alice",
      toHandle: "bob",
      text: "Hey Bob! 👋",
      createdAt: minutesAgo(5),
    },
  ];

  console.log(`[seed] Target database: ${databaseUrl}`);
  console.log(`[seed] Instance domain: ${instanceDomain}`);
  console.log("[seed] ActivityPub side effects disabled (dev context)");

  const prisma = new PrismaClient();
  try {
    const actorIdMap: Record<string, string> = {};

    for (const user of users) {
      const actorId = await upsertActor(prisma, {
        handle: user.handle,
        displayName: user.displayName,
        type: "Person",
        domain: instanceDomain,
        profileCompletedAt,
        avatarUrl: user.avatarUrl,
      });
      actorIdMap[user.handle] = actorId;
      await upsertUserAccount(prisma, actorId, user.password);
    }

    await upsertOwnerPassword(prisma, adminPassword);

    // Community as Group Actor
    const communityActorId = await upsertActor(prisma, {
      handle: communityHandle,
      displayName: "Dev Community",
      type: "Group",
      domain: instanceDomain,
      ownerId: actorIdMap[adminHandle],
      profileCompletedAt,
      metadata: { description: "Sample community for local development fixtures" },
    });
    actorIdMap[communityHandle] = communityActorId;

    await upsertMembership(prisma, communityActorId, actorIdMap[adminHandle], "owner", profileCompletedAt);
    await upsertMembership(prisma, communityActorId, actorIdMap["alice"], "moderator", profileCompletedAt);
    await upsertMembership(prisma, communityActorId, actorIdMap["bob"], "member", profileCompletedAt);
    await upsertChannel(prisma, communityActorId, "general", "general", profileCompletedAt);
    await upsertChannel(prisma, communityActorId, "random", "random", profileCompletedAt);

    // Mutual follows (stored in follows table)
    const followPairs: Array<[string, string]> = [
      [actorIdMap[adminHandle], actorIdMap["alice"]],
      [actorIdMap[adminHandle], actorIdMap["bob"]],
      [actorIdMap["alice"], actorIdMap["bob"]],
    ];
    for (const [a, b] of followPairs) {
      await upsertFollow(prisma, a, b);
      await upsertFollow(prisma, b, a);
    }

    for (const post of posts) {
      await upsertPost(prisma, post, instanceDomain, actorIdMap);
    }

    for (const dm of dms) {
      await upsertDm(prisma, dm, instanceDomain, actorIdMap);
    }

    console.log(
      `[seed] Complete. Actors=${Object.keys(actorIdMap).length}, posts=${posts.length}, community=${communityHandle}, dmObjects=${dms.length}`,
    );
    console.log(
      `[seed] Passwords: ${defaultPassword} (users) / ${adminPassword} (admin if AUTH_PASSWORD is set)`,
    );
  } catch (error) {
    console.error("[seed] Failed to seed data:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
