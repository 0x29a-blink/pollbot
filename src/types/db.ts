export interface Poll {
    message_id: string;
    channel_id: string;
    guild_id: string;
    creator_id: string;
    title: string;
    description: string;
    options: string[];
    settings: {
        public: boolean;
        allow_thread: boolean;
        allow_close: boolean;
        max_votes: number;
        min_votes: number;
        allowed_roles: string[];
        vote_weights: Record<string, number>;
        allow_exports: boolean;
    };
    created_at: string;
    active: boolean;
}
