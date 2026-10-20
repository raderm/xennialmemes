/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
import { DelegateIdentityError } from './errors.js';
import { trimSlash } from './url.js';
function defaultFetch(input, init) {
    if (typeof fetch !== 'function') {
        throw new DelegateIdentityError('crypto_unavailable', 'fetch is required for core');
    }
    return fetch(input, init);
}
function asJson(res) {
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) return res.json();
    return res.text();
}
function loginResult(body, fallbackToken) {
    if (!body || typeof body !== 'object') {
        if (fallbackToken) return {
            token: fallbackToken,
            session: {}
        };
        throw new DelegateIdentityError('invalid_request', 'core login returned an empty body');
    }
    const rec = body;
    const token = typeof rec.token === 'string' && rec.token || typeof rec.session_token === 'string' && rec.session_token || fallbackToken;
    if (!token) {
        throw new DelegateIdentityError('invalid_request', 'core login did not return a session token');
    }
    const session = rec.session && typeof rec.session === 'object' ? rec.session : rec;
    return {
        token,
        session
    };
}
function applyCoreHeaders(headers, publicApiKey, sessionToken) {
    headers.set('Authorization', `Bearer ${publicApiKey}`);
    headers.set('X-API-Key', publicApiKey);
    if (sessionToken) headers.set('X-Engine9-Session', sessionToken);
}
export function createCoreClient(opts) {
    const apiUrl = trimSlash(opts.apiUrl);
    const fetchImpl = opts.fetchImpl ?? defaultFetch;
    const sessionToken = ()=>opts.getSessionToken?.() ?? null;
    const request = async (path, init = {})=>{
        const url = path.startsWith('http') ? path : `${apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
        const headers = new Headers(init.headers);
        applyCoreHeaders(headers, opts.publicApiKey, sessionToken());
        if (init.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        return fetchImpl(url, {
            ...init,
            headers
        });
    };
    return {
        async login () {
            const delegateToken = opts.getDelegateToken();
            if (!delegateToken) {
                throw new DelegateIdentityError('login_required', 'No Identity Token. Call requestIdentity() first.');
            }
            const res = await request('/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    delegate_token: delegateToken
                })
            });
            const body = await asJson(res);
            if (!res.ok) {
                const message = body && typeof body === 'object' && 'error' in body ? String(body.error) : `core login failed (${res.status})`;
                throw new DelegateIdentityError('invalid_request', message);
            }
            const result = loginResult(body);
            opts.setSessionToken?.(result.token);
            return result;
        },
        async me () {
            const res = await request('/auth/me', {
                method: 'GET'
            });
            const body = await asJson(res);
            if (!res.ok) {
                throw new DelegateIdentityError('login_required', 'core /auth/me failed');
            }
            return body && typeof body === 'object' ? body : {};
        },
        async changeRole (roleId) {
            const res = await request('/auth/role', {
                method: 'POST',
                body: JSON.stringify({
                    role_id: roleId
                })
            });
            const body = await asJson(res);
            if (!res.ok) {
                throw new DelegateIdentityError('access_denied', 'core changeRole failed');
            }
            const result = loginResult(body, sessionToken() ?? undefined);
            if (result.token) opts.setSessionToken?.(result.token);
            return result;
        },
        fetch (path, init) {
            return request(path, init);
        }
    };
}


//# sourceURL=core.ts