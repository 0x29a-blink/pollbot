/**
 * Input validation utilities for API endpoints
 * Provides type-safe validation and sanitization for poll-related data
 */

// Validation error result
export interface ValidationError {
    field: string;
    message: string;
}

export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    errors?: ValidationError[];
}

// Poll creation input schema
export interface CreatePollInput {
    guild_id: string;
    channel_id: string;
    title: string;
    description?: string;
    options: string[];
    settings?: {
        public?: boolean;
        allow_thread?: boolean;
        allow_close?: boolean;
        allow_exports?: boolean;
        max_votes?: number;
        min_votes?: number;
        allowed_roles?: string[];
        vote_weights?: Record<string, number>;
        role_metadata?: Record<string, { name: string; color: number }>;
    };
}

// Poll settings update schema
export interface UpdatePollSettingsInput {
    public?: boolean;
    allow_thread?: boolean;
    allow_close?: boolean;
    allow_exports?: boolean;
    max_votes?: number;
    min_votes?: number;
    allowed_roles?: string[];
    vote_weights?: Record<string, number>;
}

// Validation limits
const LIMITS = {
    TITLE_MIN: 1,
    TITLE_MAX: 256,
    DESCRIPTION_MAX: 4096,
    OPTIONS_MIN: 2,
    OPTIONS_MAX: 25,
    OPTION_LENGTH_MAX: 100,
    MAX_VOTES_MIN: 1,
    MAX_VOTES_MAX: 25,
    MIN_VOTES_MIN: 1,
    MIN_VOTES_MAX: 25,
    VOTE_WEIGHT_MIN: 1,
    VOTE_WEIGHT_MAX: 100,
    SNOWFLAKE_REGEX: /^\d{17,20}$/,
};

/**
 * Validate a Discord snowflake ID
 */
function isValidSnowflake(id: string): boolean {
    return LIMITS.SNOWFLAKE_REGEX.test(id);
}

/**
 * Sanitize string input - trim whitespace and remove control characters
 */
function sanitizeString(input: string): string {
    return input
        .trim()
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Validate poll creation input
 */
export function validateCreatePoll(input: unknown): ValidationResult<CreatePollInput> {
    const errors: ValidationError[] = [];

    if (!input || typeof input !== 'object') {
        return { success: false, errors: [{ field: 'body', message: 'Request body must be an object' }] };
    }

    const body = input as Record<string, unknown>;

    // Required fields
    if (!body.guild_id || typeof body.guild_id !== 'string') {
        errors.push({ field: 'guild_id', message: 'Guild ID is required' });
    } else if (!isValidSnowflake(body.guild_id)) {
        errors.push({ field: 'guild_id', message: 'Invalid guild ID format' });
    }

    if (!body.channel_id || typeof body.channel_id !== 'string') {
        errors.push({ field: 'channel_id', message: 'Channel ID is required' });
    } else if (!isValidSnowflake(body.channel_id)) {
        errors.push({ field: 'channel_id', message: 'Invalid channel ID format' });
    }

    if (!body.title || typeof body.title !== 'string') {
        errors.push({ field: 'title', message: 'Title is required' });
    } else {
        const title = sanitizeString(body.title);
        if (title.length < LIMITS.TITLE_MIN) {
            errors.push({ field: 'title', message: 'Title cannot be empty' });
        } else if (title.length > LIMITS.TITLE_MAX) {
            errors.push({ field: 'title', message: `Title must be ${LIMITS.TITLE_MAX} characters or less` });
        }
    }

    // Optional description
    let description: string | undefined;
    if (body.description !== undefined) {
        if (typeof body.description !== 'string') {
            errors.push({ field: 'description', message: 'Description must be a string' });
        } else {
            description = sanitizeString(body.description);
            if (description.length > LIMITS.DESCRIPTION_MAX) {
                errors.push({ field: 'description', message: `Description must be ${LIMITS.DESCRIPTION_MAX} characters or less` });
            }
        }
    }

    // Options validation
    if (!body.options || !Array.isArray(body.options)) {
        errors.push({ field: 'options', message: 'Options must be an array' });
    } else {
        const validOptions = body.options.filter((opt): opt is string =>
            typeof opt === 'string' && sanitizeString(opt).length > 0
        );

        if (validOptions.length < LIMITS.OPTIONS_MIN) {
            errors.push({ field: 'options', message: `At least ${LIMITS.OPTIONS_MIN} options are required` });
        } else if (validOptions.length > LIMITS.OPTIONS_MAX) {
            errors.push({ field: 'options', message: `Maximum ${LIMITS.OPTIONS_MAX} options allowed` });
        }

        for (let i = 0; i < validOptions.length; i++) {
            const opt = validOptions[i]; if (opt && opt.length > LIMITS.OPTION_LENGTH_MAX) {
                errors.push({ field: `options[${i}]`, message: `Option must be ${LIMITS.OPTION_LENGTH_MAX} characters or less` });
            }
        }
    }

    // Settings validation
    if (body.settings !== undefined && body.settings !== null) {
        if (typeof body.settings !== 'object') {
            errors.push({ field: 'settings', message: 'Settings must be an object' });
        } else {
            const settings = body.settings as Record<string, unknown>;

            // Validate vote limits
            if (settings.max_votes !== undefined) {
                if (typeof settings.max_votes !== 'number' || !Number.isInteger(settings.max_votes)) {
                    errors.push({ field: 'settings.max_votes', message: 'Max votes must be an integer' });
                } else if (settings.max_votes < LIMITS.MAX_VOTES_MIN || settings.max_votes > LIMITS.MAX_VOTES_MAX) {
                    errors.push({ field: 'settings.max_votes', message: `Max votes must be between ${LIMITS.MAX_VOTES_MIN} and ${LIMITS.MAX_VOTES_MAX}` });
                }
            }

            if (settings.min_votes !== undefined) {
                if (typeof settings.min_votes !== 'number' || !Number.isInteger(settings.min_votes)) {
                    errors.push({ field: 'settings.min_votes', message: 'Min votes must be an integer' });
                } else if (settings.min_votes < LIMITS.MIN_VOTES_MIN || settings.min_votes > LIMITS.MIN_VOTES_MAX) {
                    errors.push({ field: 'settings.min_votes', message: `Min votes must be between ${LIMITS.MIN_VOTES_MIN} and ${LIMITS.MIN_VOTES_MAX}` });
                }
            }

            // Validate allowed_roles
            if (settings.allowed_roles !== undefined) {
                if (!Array.isArray(settings.allowed_roles)) {
                    errors.push({ field: 'settings.allowed_roles', message: 'Allowed roles must be an array' });
                } else {
                    for (const roleId of settings.allowed_roles) {
                        if (typeof roleId !== 'string' || !isValidSnowflake(roleId)) {
                            errors.push({ field: 'settings.allowed_roles', message: 'Invalid role ID format' });
                            break;
                        }
                    }
                }
            }

            // Validate vote_weights
            if (settings.vote_weights !== undefined) {
                if (typeof settings.vote_weights !== 'object' || settings.vote_weights === null) {
                    errors.push({ field: 'settings.vote_weights', message: 'Vote weights must be an object' });
                } else {
                    for (const [roleId, weight] of Object.entries(settings.vote_weights)) {
                        if (!isValidSnowflake(roleId)) {
                            errors.push({ field: 'settings.vote_weights', message: `Invalid role ID: ${roleId}` });
                        }
                        if (typeof weight !== 'number' || !Number.isInteger(weight) ||
                            weight < LIMITS.VOTE_WEIGHT_MIN || weight > LIMITS.VOTE_WEIGHT_MAX) {
                            errors.push({ field: 'settings.vote_weights', message: `Weight for role ${roleId} must be between ${LIMITS.VOTE_WEIGHT_MIN} and ${LIMITS.VOTE_WEIGHT_MAX}` });
                        }
                    }
                }
            }
        }
    }

    if (errors.length > 0) {
        return { success: false, errors };
    }

    // Build validated output
    const options = (body.options as string[])
        .map(opt => sanitizeString(opt))
        .filter(opt => opt.length > 0);

    const validated: CreatePollInput = {
        guild_id: body.guild_id as string,
        channel_id: body.channel_id as string,
        title: sanitizeString(body.title as string),
        options,
        
    };
    if (description) {
        validated.description = description;
    }
    if (body.settings) {
        (validated as any).settings = body.settings;
    }

    return { success: true, data: validated };
}

/**
 * Validate poll settings update input
 */
export function validateUpdatePollSettings(input: unknown): ValidationResult<UpdatePollSettingsInput> {
    const errors: ValidationError[] = [];

    if (!input || typeof input !== 'object') {
        return { success: false, errors: [{ field: 'settings', message: 'Settings must be an object' }] };
    }

    const settings = input as Record<string, unknown>;

    // Boolean validations
    const booleanFields = ['public', 'allow_thread', 'allow_close', 'allow_exports'];
    for (const field of booleanFields) {
        if (settings[field] !== undefined && typeof settings[field] !== 'boolean') {
            errors.push({ field, message: `${field} must be a boolean` });
        }
    }

    // Vote limits
    if (settings.max_votes !== undefined) {
        if (typeof settings.max_votes !== 'number' || !Number.isInteger(settings.max_votes)) {
            errors.push({ field: 'max_votes', message: 'Max votes must be an integer' });
        } else if (settings.max_votes < LIMITS.MAX_VOTES_MIN || settings.max_votes > LIMITS.MAX_VOTES_MAX) {
            errors.push({ field: 'max_votes', message: `Max votes must be between ${LIMITS.MAX_VOTES_MIN} and ${LIMITS.MAX_VOTES_MAX}` });
        }
    }

    if (settings.min_votes !== undefined) {
        if (typeof settings.min_votes !== 'number' || !Number.isInteger(settings.min_votes)) {
            errors.push({ field: 'min_votes', message: 'Min votes must be an integer' });
        } else if (settings.min_votes < LIMITS.MIN_VOTES_MIN || settings.min_votes > LIMITS.MIN_VOTES_MAX) {
            errors.push({ field: 'min_votes', message: `Min votes must be between ${LIMITS.MIN_VOTES_MIN} and ${LIMITS.MIN_VOTES_MAX}` });
        }
    }

    if (errors.length > 0) {
        return { success: false, errors };
    }

    return { success: true, data: settings as UpdatePollSettingsInput };
}
