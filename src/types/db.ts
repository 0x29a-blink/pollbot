export interface Poll {
    message_id: string;
    channel_id: string;
    guild_id: string;
    creator_id: string;
    title: string;
    description: string;
    options: any[]; // JSONB
    settings: {
        public: boolean;
        allow_thread: boolean;
    };
    created_at: string;
    active: boolean;
}
