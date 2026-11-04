/**
 * Input validation utilities for API endpoints
 * Provides type-safe validation and sanitization for poll-related data
 */

import { validateEndsAt } from '../lib/durationUtils';

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
    /** Optional auto-close time (ISO 8601, future, ≤ 90 days out). */
    ends_at?: string;
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
    role_metadata?: Record<string, { name: string; color: number }>;
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
    ROLE_NAME_MAX: 100,
    SNOWFLAKE_REGEX: /^\d{17,20}$/,
};

/**
 * Validate a Discord snowflake ID
 */
function isValidSnowflake(id: string): boolean {
    return LIMITS.SNOWFLAKE_REGEX.test(id);
}

/**
 * Sanitize string input - trim whitespace and remove control characters.
 * When allowNewlines is true (e.g., poll descriptions), preserves \n line breaks.
 */
function sanitizeString(input: string, allowNewlines = false): string {
    if (allowNewlines) {
        return input
            .replace(/\r\n?/g, '\n')
            .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
            .trim();
    }
    return input
        .trim()
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\s+/g, ' '); // Normalize whitespace
}

function validateSettingsFields(
    settings: Record<string, unknown>,
    fieldPrefix: string,
    errors: ValidationError[]
): UpdatePollSettingsInput {
    const prefix = fieldPrefix ? `${fieldPrefix}.` : '';
    const sanitized: UpdatePollSettingsInput = {};

    // Boolean fields
    const booleanFields = ['public', 'allow_thread', 'allow_close', 'allow_exports'] as const;
    for (const field of booleanFields) {
        if (settings[field] !== undefined) {
            if (typeof settings[field] !== 'boolean') {
                errors.push({ field: `${prefix}${field}`, message: `${field} must be a boolean` });
            } else {
                sanitized[field] = settings[field] as boolean;
            }
        }
    }

    // Vote limits
    if (settings.max_votes !== undefined) {
        if (typeof settings.max_votes !== 'number' || !Number.isInteger(settings.max_votes)) {
            errors.push({ field: `${prefix}max_votes`, message: 'Max votes must be an integer' });
        } else if (settings.max_votes < LIMITS.MAX_VOTES_MIN || settings.max_votes > LIMITS.MAX_VOTES_MAX) {
            errors.push({ field: `${prefix}max_votes`, message: `Max votes must be between ${LIMITS.MAX_VOTES_MIN} and ${LIMITS.MAX_VOTES_MAX}` });
        } else {
            sanitized.max_votes = settings.max_votes;
        }
    }

    if (settings.min_votes !== undefined) {
        if (typeof settings.min_votes !== 'number' || !Number.isInteger(settings.min_votes)) {
            errors.push({ field: `${prefix}min_votes`, message: 'Min votes must be an integer' });
        } else if (settings.min_votes < LIMITS.MIN_VOTES_MIN || settings.min_votes > LIMITS.MIN_VOTES_MAX) {
            errors.push({ field: `${prefix}min_votes`, message: `Min votes must be between ${LIMITS.MIN_VOTES_MIN} and ${LIMITS.MIN_VOTES_MAX}` });
        } else {
            sanitized.min_votes = settings.min_votes;
        }
    }

    if (
        sanitized.min_votes !== undefined &&
        sanitized.max_votes !== undefined &&
        sanitized.min_votes > sanitized.max_votes
    ) {
        errors.push({ field: `${prefix}min_votes`, message: 'Min votes cannot exceed max votes' });
    }

    // Allowed roles
    if (settings.allowed_roles !== undefined) {
        if (!Array.isArray(settings.allowed_roles)) {
            errors.push({ field: `${prefix}allowed_roles`, message: 'Allowed roles must be an array' });
        } else {
            const deduped: string[] = [];
            for (const roleId of settings.allowed_roles) {
                if (typeof roleId !== 'string' || !isValidSnowflake(roleId)) {
                    errors.push({ field: `${prefix}allowed_roles`, message: 'Invalid role ID format' });
                    break;
                }
                if (!deduped.includes(roleId)) {
                    deduped.push(roleId);
                }
            }
            sanitized.allowed_roles = deduped;
        }
    }

    // Vote weights
    if (settings.vote_weights !== undefined) {
        if (typeof settings.vote_weights !== 'object' || settings.vote_weights === null || Array.isArray(settings.vote_weights)) {
            errors.push({ field: `${prefix}vote_weights`, message: 'Vote weights must be an object' });
        } else {
            const cleanWeights: Record<string, number> = {};
            for (const [roleId, weight] of Object.entries(settings.vote_weights)) {
                if (!isValidSnowflake(roleId)) {
                    errors.push({ field: `${prefix}vote_weights`, message: `Invalid role ID: ${roleId}` });
                    continue;
                }
                if (typeof weight !== 'number' || !Number.isInteger(weight) ||
                    weight < LIMITS.VOTE_WEIGHT_MIN || weight > LIMITS.VOTE_WEIGHT_MAX) {
                    errors.push({ field: `${prefix}vote_weights`, message: `Weight for role ${roleId} must be between ${LIMITS.VOTE_WEIGHT_MIN} and ${LIMITS.VOTE_WEIGHT_MAX}` });
                    continue;
                }
                cleanWeights[roleId] = weight;
            }
            sanitized.vote_weights = cleanWeights;
        }
    }

    // Role metadata (optional display cache for role names/colors)
    if (settings.role_metadata !== undefined) {
        if (typeof settings.role_metadata !== 'object' || settings.role_metadata === null || Array.isArray(settings.role_metadata)) {
            errors.push({ field: `${prefix}role_metadata`, message: 'Role metadata must be an object' });
        } else {
            const cleanMeta: Record<string, { name: string; color: number }> = {};
            for (const [roleId, meta] of Object.entries(settings.role_metadata)) {
                if (!isValidSnowflake(roleId) || !meta || typeof meta !== 'object') {
                    errors.push({ field: `${prefix}role_metadata`, message: `Invalid role metadata for ${roleId}` });
                    continue;
                }
                const m = meta as Record<string, unknown>;
                if (typeof m.name !== 'string' || typeof m.color !== 'number' || !Number.isFinite(m.color)) {
                    errors.push({ field: `${prefix}role_metadata`, message: `Invalid role metadata fields for ${roleId}` });
                    continue;
                }
                cleanMeta[roleId] = {
                    name: sanitizeString(m.name).slice(0, LIMITS.ROLE_NAME_MAX),
                    color: Math.max(0, Math.min(0xFFFFFF, Math.trunc(m.color))),
                };
            }
            sanitized.role_metadata = cleanMeta;
        }
    }

    return sanitized;
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

    // Optional description (preserve intentional line breaks)
    let description: string | undefined;
    if (body.description !== undefined && body.description !== null) {
        if (typeof body.description !== 'string') {
            errors.push({ field: 'description', message: 'Description must be a string' });
        } else {
            description = sanitizeString(body.description, true);
            if (description.length > LIMITS.DESCRIPTION_MAX) {
                errors.push({ field: 'description', message: `Description must be ${LIMITS.DESCRIPTION_MAX} characters or less` });
            }
        }
    }

    // Options validation (sanitize BEFORE checking lengths)
    let sanitizedOptions: string[] = [];
    if (!body.options || !Array.isArray(body.options)) {
        errors.push({ field: 'options', message: 'Options must be an array' });
    } else {
        if (body.options.some(opt => typeof opt !== 'string')) {
            errors.push({ field: 'options', message: 'All options must be strings' });
        }
        sanitizedOptions = body.options
            .filter((opt): opt is string => typeof opt === 'string')
            .map(opt => sanitizeString(opt))
            .filter(opt => opt.length > 0);

        if (sanitizedOptions.length < LIMITS.OPTIONS_MIN) {
            errors.push({ field: 'options', message: `At least ${LIMITS.OPTIONS_MIN} options are required` });
        } else if (sanitizedOptions.length > LIMITS.OPTIONS_MAX) {
            errors.push({ field: 'options', message: `Maximum ${LIMITS.OPTIONS_MAX} options allowed` });
        }

        for (let i = 0; i < sanitizedOptions.length; i++) {
            const opt = sanitizedOptions[i];
            if (opt && opt.length > LIMITS.OPTION_LENGTH_MAX) {
                errors.push({ field: `options[${i}]`, message: `Option must be ${LIMITS.OPTION_LENGTH_MAX} characters or less` });
            }
        }
    }

    // Settings validation
    let sanitizedSettings: UpdatePollSettingsInput | undefined;
    if (body.settings !== undefined && body.settings !== null) {
        if (typeof body.settings !== 'object' || Array.isArray(body.settings)) {
            errors.push({ field: 'settings', message: 'Settings must be an object' });
        } else {
            sanitizedSettings = validateSettingsFields(body.settings as Record<string, unknown>, 'settings', errors);
            const effectiveMin = sanitizedSettings.min_votes ?? 1;
            const effectiveMax = sanitizedSettings.max_votes ?? Math.max(1, effectiveMin);
            if (effectiveMin > effectiveMax) {
                errors.push({ field: 'settings.min_votes', message: 'Min votes cannot exceed max votes' });
            }
            if (sanitizedOptions.length >= LIMITS.OPTIONS_MIN) {
                if (sanitizedSettings.max_votes !== undefined && sanitizedSettings.max_votes > sanitizedOptions.length) {
                    errors.push({ field: 'settings.max_votes', message: `Max votes cannot exceed the number of options (${sanitizedOptions.length})` });
                }
                if (sanitizedSettings.min_votes !== undefined && sanitizedSettings.min_votes > sanitizedOptions.length) {
                    errors.push({ field: 'settings.min_votes', message: `Min votes cannot exceed the number of options (${sanitizedOptions.length})` });
                }
            }
        }
    }

    // Optional auto-close time
    if (body.ends_at !== undefined && body.ends_at !== null) {
        if (typeof body.ends_at !== 'string' || !validateEndsAt(body.ends_at)) {
            errors.push({ field: 'ends_at', message: 'ends_at must be a future ISO timestamp no more than 90 days out' });
        }
    }

    if (errors.length > 0) {
        return { success: false, errors };
    }

    const validated: CreatePollInput = {
        guild_id: body.guild_id as string,
        channel_id: body.channel_id as string,
        title: sanitizeString(body.title as string),
        options: sanitizedOptions,
    };
    if (description) {
        validated.description = description;
    }
    if (sanitizedSettings) {
        validated.settings = sanitizedSettings;
    }
    if (typeof body.ends_at === 'string') {
        validated.ends_at = body.ends_at;
    }

    return { success: true, data: validated };
}

/**
 * Validate poll settings update input
 */
export function validateUpdatePollSettings(input: unknown): ValidationResult<UpdatePollSettingsInput> {
    const errors: ValidationError[] = [];

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { success: false, errors: [{ field: 'settings', message: 'Settings must be an object' }] };
    }

    const sanitized = validateSettingsFields(input as Record<string, unknown>, '', errors);

    if (errors.length > 0) {
        return { success: false, errors };
    }

    return { success: true, data: sanitized };
}
