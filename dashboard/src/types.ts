/**
 * Shared type definitions for the dashboard
 * This file centralizes types to maintain consistency across all components
 */

// ============================================================================
// Poll Settings
// ============================================================================

export interface PollSettings {
    public?: boolean;
    allow_thread?: boolean;
    allow_close?: boolean;
    allow_exports?: boolean;
    max_votes?: number;
    min_votes?: number;
    allowed_roles?: string[];
    vote_weights?: Record<string, number>;
    /** Role metadata for dashboard display (name, color) */
    role_metadata?: Record<string, { name: string; color: number }>;
    // Legacy/alternate property names used in some components
    private?: boolean;
    allow_multivote?: boolean;
    hide_results?: boolean;
    weights?: Record<string, number>;
}

// ============================================================================
// Poll
// ============================================================================

export interface Poll {
    message_id: string;
    guild_id: string;
    channel_id: string;
    creator_id: string;
    title: string;
    description: string;
    options: string[];
    settings: PollSettings;
    created_at: string;
    active: boolean;
    /** Computed vote counts per option index */
    vote_counts?: Record<number, number>;
    /** Computed total votes */
    total_votes?: number;
    /** Set when Discord message no longer exists */
    discord_deleted?: boolean;
}

// ============================================================================
// Guild Data
// ============================================================================

export interface GuildData {
    id: string;
    name: string;
    member_count: number;
    icon_url: string | null;
    joined_at: string;
}

export interface GuildInfo {
    id: string;
    name: string;
    icon_url: string | null;
    member_count: number;
}

// ============================================================================
// Channel & Role (for guild management)
// ============================================================================

export interface Channel {
    id: string;
    name: string;
    type: number;
    position: number;
    parent_id: string | null;
    bot_can_post: boolean;
}

export interface Role {
    id: string;
    name: string;
    color: number;
    position: number;
    managed?: boolean;
}
