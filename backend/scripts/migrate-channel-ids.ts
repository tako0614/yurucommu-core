/**
 * Migration script to fix channel IDs
 *
 * This script updates channels with problematic IDs (like "channel")
 * to use proper UUIDs to avoid URL routing conflicts.
 *
 * Usage:
 * npx tsx scripts/migrate-channel-ids.ts
 */

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log("Starting channel ID migration...");

    // Find all channels with the problematic "channel" ID
    const problematicChannels = await prisma.community_channels.findMany({
      where: {
        id: "channel"
      }
    });

    console.log(`Found ${problematicChannels.length} channels with ID "channel"`);

    for (const channel of problematicChannels) {
      const newId = `ch-${crypto.randomUUID().slice(0, 8)}`;

      console.log(`Migrating channel in community ${channel.community_id}: "channel" -> "${newId}"`);

      // Update the channel ID
      await prisma.community_channels.update({
        where: {
          community_id_id: {
            community_id: channel.community_id,
            id: channel.id
          }
        },
        data: {
          id: newId
        }
      });

      console.log(`✓ Successfully migrated channel to ${newId}`);
    }

    console.log("\n✓ Migration complete!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
