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

// ============================================================================
// Voter & Premium Types (for View/Export feature)
// ============================================================================

export interface VoterInfo {
    user_id: string;
    username: string;
    display_name: string;
    nickname: string | null;
    avatar_url: string | null;
}

export interface VoterResponse {
    option_index: number;
    option_name: string;
    total_voters: number;
    voters: VoterInfo[];
}

export interface PremiumStatus {
    isPremium: boolean;
    expiresAt?: string;
    voteUrl: string;
}

export interface ExportResponse {
    csv: string;
    filename: string;
    total_votes: number;
}

// ============================================================================
// Realtime Updates
// ============================================================================

export interface VoteUpdate {
    poll_id: string;
    option_index: number;
    user_id: string;
    created_at?: string;
    timestamp: number;
}

// ============================================================================
// Permission Errors
// ============================================================================

export interface PermissionError {
    pollId: string;
    pollTitle: string;
    channelId: string;
    missingPermissions: string[];
    timestamp: number;
}
