/**
 * Discord's sharding formula: which shard a guild belongs to.
 * guildId is a snowflake (numeric string), so use BigInt.
 */
export function shardIdForGuild(guildId: string, shardCount: number): number {
    return Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
}
