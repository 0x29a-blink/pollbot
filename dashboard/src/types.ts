export interface Poll {
    message_id: string;
    title: string;
    description: string;
    options: any[];
    settings: any;
    created_at: string;
    active: boolean;
    guild_id: string; // Added for global view context
}

export interface GuildData {
    id: string;
    name: string;
    member_count: number;
    icon_url: string | null;
    joined_at: string;
}
