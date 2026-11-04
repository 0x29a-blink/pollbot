import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { validateCsrfToken } from './csrf';

function makeReqRes(
    method: string,
    path: string,
    cookies: Record<string, string> = {},
    headers: Record<string, string | string[]> = {}
) {
    const req = { method, path, cookies, headers } as unknown as Request;
    let statusCode = 200;
    let jsonBody: unknown = null;
    const res = {
        status(code: number) {
            statusCode = code;
            return this;
        },
        json(body: unknown) {
            jsonBody = body;
            return this;
        },
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    return { req, res, next, getStatus: () => statusCode, getJson: () => jsonBody };
}

describe('validateCsrfToken', () => {
    it('allows non-mutating GET requests without CSRF tokens', () => {
        const { req, res, next } = makeReqRes('GET', '/api/user/guilds');
        validateCsrfToken(req, res, next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('exempts external POST /vote webhook', () => {
        const { req, res, next } = makeReqRes('POST', '/vote');
        validateCsrfToken(req, res, next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('enforces CSRF validation on POST /api/auth/logout', () => {
        const missing = makeReqRes('POST', '/api/auth/logout');
        validateCsrfToken(missing.req, missing.res, missing.next);
        expect(missing.next).not.toHaveBeenCalled();
        expect(missing.getStatus()).toBe(403);

        const valid = makeReqRes(
            'POST',
            '/api/auth/logout',
            { csrf_token: 'a'.repeat(64) },
            { 'x-csrf-token': 'a'.repeat(64) }
        );
        validateCsrfToken(valid.req, valid.res, valid.next);
        expect(valid.next).toHaveBeenCalledOnce();
    });

    it('rejects mismatched tokens of both different and equal byte lengths', () => {
        const diffLen = makeReqRes(
            'POST',
            '/api/user/polls',
            { csrf_token: 'short' },
            { 'x-csrf-token': 'longer-token' }
        );
        validateCsrfToken(diffLen.req, diffLen.res, diffLen.next);
        expect(diffLen.next).not.toHaveBeenCalled();
        expect(diffLen.getStatus()).toBe(403);

        const sameLen = makeReqRes(
            'DELETE',
            '/api/user/polls/123456789012345678',
            { csrf_token: 'a'.repeat(64) },
            { 'x-csrf-token': 'b'.repeat(64) }
        );
        validateCsrfToken(sameLen.req, sameLen.res, sameLen.next);
        expect(sameLen.next).not.toHaveBeenCalled();
        expect(sameLen.getStatus()).toBe(403);
    });
});
