import { PrismaClient } from "@prisma/client";
import { webcrypto } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeParticipants,
  computeParticipantsHash,
  getActorUri,
} from "@takos/platform/server";

type SeedUser = {
  id: string;
  displayName: string;
  password: string;
  avatarUrl?: string;
};

type SeedPost = {
  id: string;
  authorId: string;
  text: string;
  createdAt: Date;
  communityId?: string | null;
  broadcastAll?: boolean;
  visibleToFriends?: boolean;
};

type CliArgs = {
  databaseUrl?: string;
  instanceDomain?: string;
  password?: string;
  help?: boolean;
};

const encoder = new TextEncoder();

function usage() {
  console.log(
    [
      "Seed the local dev database with sample users, posts, community, and DM data.",
      "",
      "Options:",
      "  --db <url>           Override DATABASE_URL (e.g. file:.wrangler/state/.../db.sqlite)",
      "  --domain <domain>    Instance domain for ActivityPub actor URIs (default: INSTANCE_DOMAIN or yourdomain.com)",
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

async function upsertUser(prisma: PrismaClient, user: SeedUser, completedAt: Date) {
  const existing = await prisma.users.findUnique({ where: { id: user.id } });
  if (existing) {
    await prisma.users.update({
      where: { id: user.id },
      data: {
        display_name: user.displayName,
        avatar_url: user.avatarUrl ?? existing.avatar_url ?? "",
        is_private: 0,
        profile_completed_at: existing.profile_completed_at ?? completedAt,
      },
    });
  } else {
    await prisma.users.create({
      data: {
        id: user.id,
        display_name: user.displayName,
        avatar_url: user.avatarUrl ?? "",
        created_at: completedAt,
        is_private: 0,
        profile_completed_at: completedAt,
      },
    });
  }

  const hashed = await hashPassword(user.password);
  const account = await prisma.user_accounts.findFirst({
    where: { provider: "password", user_id: user.id },
  });
  if (account) {
    await prisma.user_accounts.update({
      where: { id: account.id },
      data: {
        provider_account_id: hashed,
        updated_at: new Date(),
      },
    });
  } else {
    await prisma.user_accounts.create({
      data: {
        id: `acct-${user.id}`,
        user_id: user.id,
        provider: "password",
        provider_account_id: hashed,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }
}

async function upsertFollow(
  prisma: PrismaClient,
  followerId: string,
  targetId: string,
  instanceDomain: string,
) {
  if (followerId === targetId) return;
  const now = new Date();
  const followerActor = getActorUri(followerId, instanceDomain);
  const targetActor = getActorUri(targetId, instanceDomain);
  const followId = `follow-${followerId}-to-${targetId}`;
  const followActivity = `https://${instanceDomain}/ap/follows/${followId}`;
  const followerActivity = `${followActivity}-as-follower`;

  await prisma.ap_follows.upsert({
    where: {
      local_user_id_remote_actor_id: {
        local_user_id: followerId,
        remote_actor_id: targetActor,
      },
    },
    update: {
      status: "accepted",
      activity_id: followActivity,
      accepted_at: now,
    },
    create: {
      id: followId,
      local_user_id: followerId,
      remote_actor_id: targetActor,
      activity_id: followActivity,
      status: "accepted",
      created_at: now,
      accepted_at: now,
    },
  });

  await prisma.ap_followers.upsert({
    where: {
      local_user_id_remote_actor_id: {
        local_user_id: targetId,
        remote_actor_id: followerActor,
      },
    },
    update: {
      status: "accepted",
      activity_id: followerActivity,
      accepted_at: now,
    },
    create: {
      id: `follower-${targetId}-from-${followerId}`,
      local_user_id: targetId,
      remote_actor_id: followerActor,
      activity_id: followerActivity,
      status: "accepted",
      created_at: now,
      accepted_at: now,
    },
  });
}

async function upsertCommunity(
  prisma: PrismaClient,
  communityId: string,
  creatorId: string,
  instanceDomain: string,
  createdAt: Date,
) {
  const apId = `https://${instanceDomain}/ap/groups/${communityId}`;
  await prisma.communities.upsert({
    where: { id: communityId },
    update: {
      name: "Dev Community",
      description: "Sample community for local development fixtures",
      icon_url: "",
      visibility: "public",
      invite_policy: "owner_mod",
      created_by: creatorId,
      ap_id: apId,
    },
    create: {
      id: communityId,
      name: "Dev Community",
      description: "Sample community for local development fixtures",
      visibility: "public",
      invite_policy: "owner_mod",
      icon_url: "",
      created_by: creatorId,
      created_at: createdAt,
      ap_id: apId,
    },
  });
}

async function upsertMembership(
  prisma: PrismaClient,
  communityId: string,
  userId: string,
  role: "Owner" | "Moderator" | "Member",
  joinedAt: Date,
) {
  await prisma.memberships.upsert({
    where: {
      community_id_user_id: {
        community_id: communityId,
        user_id: userId,
      },
    },
    update: {
      role,
      status: "active",
    },
    create: {
      community_id: communityId,
      user_id: userId,
      role,
      nickname: "",
      joined_at: joinedAt,
      status: "active",
    },
  });
}

async function upsertChannel(
  prisma: PrismaClient,
  communityId: string,
  channelId: string,
  name: string,
  createdAt: Date,
) {
  await prisma.channels.upsert({
    where: {
      id_community_id: {
        id: channelId,
        community_id: communityId,
      },
    },
    update: { name },
    create: {
      id: channelId,
      community_id: communityId,
      name,
      created_at: createdAt,
    },
  });
}

async function upsertPost(prisma: PrismaClient, post: SeedPost) {
  const broadcastAll = post.broadcastAll ?? true;
  const visibleToFriends = post.visibleToFriends ?? true;
  await prisma.posts.upsert({
    where: { id: post.id },
    update: {
      text: post.text,
      author_id: post.authorId,
      community_id: post.communityId ?? null,
      attributed_community_id: post.communityId ?? null,
      content_warning: null,
      sensitive: 0,
      media_json: "[]",
      broadcast_all: broadcastAll ? 1 : 0,
      visible_to_friends: visibleToFriends ? 1 : 0,
    },
    create: {
      id: post.id,
      community_id: post.communityId ?? null,
      author_id: post.authorId,
      type: "text",
      text: post.text,
      content_warning: null,
      sensitive: 0,
      media_json: "[]",
      created_at: post.createdAt,
      pinned: 0,
      broadcast_all: broadcastAll ? 1 : 0,
      visible_to_friends: visibleToFriends ? 1 : 0,
      edit_count: 0,
      attributed_community_id: post.communityId ?? null,
      ap_object_id: null,
      ap_activity_id: null,
    },
  });
}

async function upsertDm(
  prisma: PrismaClient,
  userA: string,
  userB: string,
  instanceDomain: string,
  createdAt: Date,
) {
  const participants = canonicalizeParticipants([
    getActorUri(userA, instanceDomain),
    getActorUri(userB, instanceDomain),
  ]);
  const threadId = computeParticipantsHash(participants);
  await prisma.chat_dm_threads.upsert({
    where: { id: threadId },
    update: {
      participants_hash: threadId,
      participants_json: JSON.stringify(participants),
    },
    create: {
      id: threadId,
      participants_hash: threadId,
      participants_json: JSON.stringify(participants),
      created_at: createdAt,
    },
  });

  const authorActor = getActorUri(userA, instanceDomain);
  await prisma.chat_dm_messages.upsert({
    where: { id: `dm-${userA}-to-${userB}` },
    update: {
      author_id: authorActor,
      content_html: `<p>Hey ${userB}! 👋</p>`,
      raw_activity_json: JSON.stringify({
        type: "Note",
        seeded: true,
        from: userA,
        to: userB,
      }),
    },
    create: {
      id: `dm-${userA}-to-${userB}`,
      thread_id: threadId,
      author_id: authorActor,
      content_html: `<p>Hey ${userB}! 👋</p>`,
      raw_activity_json: JSON.stringify({
        type: "Note",
        seeded: true,
        from: userA,
        to: userB,
      }),
      created_at: createdAt,
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
    { id: adminHandle, displayName: "Admin", password: adminPassword },
    { id: "alice", displayName: "Alice Doe", password: defaultPassword },
    { id: "bob", displayName: "Bob Roe", password: defaultPassword },
  ];

  const communityId = "dev-community";
  const posts: SeedPost[] = [
    {
      id: "dev-welcome-admin",
      authorId: adminHandle,
      text: "Welcome to the takos dev workspace 👋",
      createdAt: minutesAgo(45),
      broadcastAll: true,
      visibleToFriends: true,
    },
    {
      id: "dev-alice-home",
      authorId: "alice",
      text: "Alice here—testing the timeline with seeded data.",
      createdAt: minutesAgo(35),
      broadcastAll: true,
      visibleToFriends: true,
    },
    {
      id: "dev-bob-home",
      authorId: "bob",
      text: "Bob dropping a note so everyone has something to read.",
      createdAt: minutesAgo(25),
      broadcastAll: true,
      visibleToFriends: true,
    },
    {
      id: "dev-community-welcome",
      authorId: adminHandle,
      text: "Dev Community is live—say hi in #general!",
      createdAt: minutesAgo(15),
      communityId,
      broadcastAll: false,
      visibleToFriends: true,
    },
    {
      id: "dev-community-alice",
      authorId: "alice",
      text: "Kicking off our first community thread.",
      createdAt: minutesAgo(10),
      communityId,
      broadcastAll: false,
      visibleToFriends: true,
    },
  ];

  console.log(`[seed] Target database: ${databaseUrl}`);
  console.log(`[seed] Instance domain: ${instanceDomain}`);
  console.log("[seed] ActivityPub side effects disabled (dev context)");

  const prisma = new PrismaClient();
  try {
    for (const user of users) {
      await upsertUser(prisma, user, profileCompletedAt);
    }

    await upsertCommunity(prisma, communityId, adminHandle, instanceDomain, profileCompletedAt);
    await upsertMembership(prisma, communityId, adminHandle, "Owner", profileCompletedAt);
    await upsertMembership(prisma, communityId, "alice", "Moderator", profileCompletedAt);
    await upsertMembership(prisma, communityId, "bob", "Member", profileCompletedAt);
    await upsertChannel(prisma, communityId, "general", "general", profileCompletedAt);
    await upsertChannel(prisma, communityId, "random", "random", profileCompletedAt);

    const followPairs: Array<[string, string]> = [
      [adminHandle, "alice"],
      [adminHandle, "bob"],
      ["alice", "bob"],
    ];
    for (const [a, b] of followPairs) {
      await upsertFollow(prisma, a, b, instanceDomain);
      await upsertFollow(prisma, b, a, instanceDomain);
    }

    for (const post of posts) {
      await upsertPost(prisma, post);
    }

    await upsertDm(prisma, "alice", "bob", instanceDomain, profileCompletedAt);

    console.log(
      `[seed] Complete. Users=${users.length}, posts=${posts.length}, community=${communityId}, dmThreads=1`,
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
