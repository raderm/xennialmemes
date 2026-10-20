/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
import { createCoreClient } from './core.js';
import { DelegateIdentityError, delegateReturnedError, insecureDomainError, STATE_MISMATCH } from './errors.js';
import { meetsGate, meetsLevel } from './levels.js';
import { createDebugLog } from './log.js';
import { defaultConfiguration } from './discovery.js';
import { openIdentityPopup, openLogoutPopup } from './popup.js';
import { createDelegateProvider } from './provider.js';
import { randomId } from './random.js';
import { createStorage, isPersistentStore, STORAGE_KEYS } from './storage.js';
import { DEFAULT_DELEGATE_URL } from './types.js';
import { domainFromUrl, isInsecureUrl, parseDelegateCallback, stripCallbackParams, trimSlash } from './url.js';
import { CLOCK_SKEW_SECONDS } from './verify.js';
function defaultFetch(input, init) {
    if (typeof fetch !== 'function') {
        throw new DelegateIdentityError('invalid_request', 'fetch is required');
    }
    return fetch(input, init);
}
function currentDomain() {
    if (typeof location === 'undefined') return '';
    return domainFromUrl(location.href) ?? '';
}
function currentHref() {
    return typeof location !== 'undefined' ? location.href : '';
}
function isUnexpired(identity, now = Date.now() / 1000) {
    return typeof identity.exp === 'number' && now <= identity.exp + CLOCK_SKEW_SECONDS;
}
function readStoredIdentity(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.sub !== 'string') return null;
        if (!isUnexpired(parsed)) return null;
        return parsed;
    } catch  {
        return null;
    }
}
function assignLocation(url) {
    if (typeof location === 'undefined' || typeof location.assign !== 'function') {
        throw new DelegateIdentityError('invalid_request', 'location.assign is not available');
    }
    location.assign(url);
}
function resolveProvider(config, fetchImpl) {
    if (config.provider) return config.provider;
    return createDelegateProvider({
        delegateUrl: trimSlash(config.delegateUrl ?? DEFAULT_DELEGATE_URL),
        fetchImpl
    });
}
export function createEngine9Id(config = {}) {
    const domain = config.domain ?? currentDomain();
    const storage = createStorage(config.storage ?? 'session');
    const fetchImpl = config.fetchImpl ?? defaultFetch;
    const provider = resolveProvider(config, fetchImpl);
    const log = createDebugLog(config.debug);
    const listeners = new Set();
    const notify = (identity)=>{
        for (const cb of listeners)cb(identity);
    };
    const persist = (identity, token)=>{
        storage.set(STORAGE_KEYS.token, token);
        storage.set(STORAGE_KEYS.identity, JSON.stringify(identity));
        storage.set(STORAGE_KEYS.domainUnid, identity.sub);
        notify(identity);
    };
    const getIdentity = ()=>readStoredIdentity(storage.get(STORAGE_KEYS.identity));
    const verifyAndStore = async (token, nonce)=>{
        log('verify', {
            domain,
            tokenLength: token.length,
            nonce: Boolean(nonce)
        });
        let identity;
        try {
            identity = await provider.verifyToken(token, {
                domain,
                nonce
            });
        } catch (err) {
            log('verify:failed', {
                code: err instanceof DelegateIdentityError ? err.code : undefined,
                message: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
        log('verify:ok', {
            level: identity.level,
            exp: identity.exp
        });
        persist(identity, token);
        return identity;
    };
    const stateMismatch = (expected, received)=>new DelegateIdentityError(STATE_MISMATCH, 'This login answers a request this browser did not start or no longer has (another tab, an older popup or redirect, or an email link opened in another browser). Nothing expired; sign in again.', {
            step: 'state',
            expected: expected ?? null,
            received: received ?? null
        });
    const beginRequest = ()=>{
        const nonce = randomId();
        const state = randomId();
        storage.set(STORAGE_KEYS.nonce, nonce);
        storage.set(STORAGE_KEYS.state, state);
        return {
            nonce,
            state
        };
    };
    const requestIdentity = async (opts)=>{
        if (!domain) {
            throw new DelegateIdentityError('invalid_domain', 'createEngine9Id requires domain');
        }
        const returnTo = opts.returnTo ?? currentHref();
        const insecure = [
            currentHref(),
            returnTo
        ].find(isInsecureUrl);
        if (insecure) {
            log('request:insecure', {
                url: insecure
            });
            throw insecureDomainError(insecure);
        }
        const { nonce, state } = beginRequest();
        const loginLevel = opts.loginLevel ?? config.loginLevel;
        const brand = opts.brand ?? config.brand;
        const expiresIn = opts.expiresIn ?? config.expiresIn;
        log('request', {
            mode: opts.mode,
            domain,
            minLevel: opts.minLevel,
            maxLevel: opts.maxLevel,
            prompt: opts.prompt,
            loginLevel,
            expiresIn,
            fields: opts.fields
        });
        const shared = {
            domain,
            minLevel: opts.minLevel,
            maxLevel: opts.maxLevel,
            fields: opts.fields,
            optionalFields: opts.optionalFields,
            prompt: opts.prompt,
            loginLevel,
            brand,
            expiresIn,
            nonce,
            state
        };
        if (opts.mode === 'redirect') {
            log('redirect', {
                returnTo
            });
            assignLocation(await provider.buildAuthorizeUrl({
                ...shared,
                returnTo,
                responseMode: opts.responseMode
            }));
            return;
        }
        if (!provider.buildBridgeUrl) {
            assignLocation(await provider.buildAuthorizeUrl({
                ...shared,
                returnTo,
                responseMode: opts.responseMode
            }));
            return;
        }
        let discovery;
        try {
            discovery = await provider.discover();
        } catch (err) {
            log('discovery:failed', {
                message: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
        const popupUrl = await provider.buildBridgeUrl(shared);
        const expectedOrigin = provider.messageOrigin ? provider.messageOrigin(discovery) : new URL(discovery.issuer).origin;
        log('discovery', {
            issuer: discovery.issuer,
            expectedOrigin
        });
        const message = await openIdentityPopup({
            url: popupUrl,
            expectedOrigin,
            log
        });
        if (!message) {
            log('popup:fallback_to_redirect', {
                returnTo
            });
            assignLocation(await provider.buildAuthorizeUrl({
                ...shared,
                returnTo,
                responseMode: opts.responseMode
            }));
            return;
        }
        if (message.state && message.state !== state) {
            throw stateMismatch(state, message.state);
        }
        storage.remove(STORAGE_KEYS.nonce);
        storage.remove(STORAGE_KEYS.state);
        return verifyAndStore(message.token, nonce);
    };
    const handleCallback = async ()=>{
        const loc = typeof location !== 'undefined' ? {
            href: location.href,
            hash: location.hash,
            search: location.search
        } : undefined;
        const parsed = parseDelegateCallback(loc);
        if (!parsed) return null;
        log('callback', {
            error: parsed.error,
            token: Boolean(parsed.token),
            state: Boolean(parsed.state)
        });
        const clean = ()=>{
            if (typeof location === 'undefined' || typeof history === 'undefined') return;
            history.replaceState(history.state, '', stripCallbackParams(location.href));
        };
        try {
            if (parsed.error) {
                throw delegateReturnedError(parsed.error, {
                    step: 'callback',
                    state: parsed.state
                });
            }
            if (!parsed.token) return null;
            const expectedState = storage.get(STORAGE_KEYS.state);
            const unrecognized = expectedState ? parsed.state !== expectedState : Boolean(parsed.state) && isPersistentStore(storage);
            if (unrecognized) {
                log('callback:state_mismatch', {
                    pending: Boolean(expectedState)
                });
                throw stateMismatch(expectedState, parsed.state);
            }
            const nonce = storage.get(STORAGE_KEYS.nonce) ?? undefined;
            const identity = await verifyAndStore(parsed.token, nonce);
            storage.remove(STORAGE_KEYS.nonce);
            storage.remove(STORAGE_KEYS.state);
            return identity;
        } finally{
            clean();
        }
    };
    const ensureLevel = async (n, opts = {})=>{
        const current = getIdentity();
        if (meetsLevel(current, n)) return current ?? undefined;
        const mode = opts.mode ?? 'popup';
        if (!current) {
            try {
                const silent = await requestIdentity({
                    minLevel: n,
                    maxLevel: opts.maxLevel,
                    fields: opts.fields,
                    optionalFields: opts.optionalFields,
                    mode,
                    returnTo: opts.returnTo,
                    responseMode: opts.responseMode,
                    prompt: 'none',
                    loginLevel: opts.loginLevel,
                    expiresIn: opts.expiresIn
                });
                if (silent && meetsLevel(silent, n)) return silent;
            } catch (err) {
                log('silent:failed', {
                    code: err instanceof DelegateIdentityError ? err.code : undefined,
                    message: err instanceof Error ? err.message : String(err)
                });
            }
        }
        return requestIdentity({
            minLevel: n,
            maxLevel: opts.maxLevel,
            fields: opts.fields,
            optionalFields: opts.optionalFields,
            mode,
            returnTo: opts.returnTo,
            responseMode: opts.responseMode,
            prompt: opts.prompt,
            loginLevel: opts.loginLevel,
            expiresIn: opts.expiresIn
        });
    };
    const changeDelegateInfo = (opts = {})=>{
        const grant = getIdentity()?.grant;
        const required = grant?.required?.length ? grant.required : undefined;
        const optional = grant?.requested?.filter((name)=>!grant.required?.includes(name));
        return requestIdentity({
            minLevel: opts.minLevel ?? 1,
            maxLevel: opts.maxLevel,
            fields: opts.fields ?? required,
            optionalFields: opts.optionalFields ?? (optional?.length ? optional : undefined),
            mode: opts.mode ?? 'popup',
            returnTo: opts.returnTo,
            responseMode: opts.responseMode,
            prompt: 'select',
            loginLevel: opts.loginLevel,
            expiresIn: opts.expiresIn
        });
    };
    const logout = async (opts = {})=>{
        storage.clearIdentity();
        notify(null);
        if (!opts.delegate) return;
        if (opts.mode === 'popup' && provider.buildLogoutBridgeUrl) {
            const delegateBase = trimSlash(config.delegateUrl ?? DEFAULT_DELEGATE_URL);
            const result = await openLogoutPopup({
                url: provider.buildLogoutBridgeUrl({
                    domain
                }),
                expectedOrigin: provider.messageOrigin?.(defaultConfiguration(delegateBase)) ?? new URL(delegateBase).origin,
                log
            });
            if (result) return;
            log('logout_popup:fallback_to_redirect', {});
        }
        const built = provider.buildLogoutUrl?.({
            domain,
            returnTo: currentHref()
        });
        if (built !== undefined) assignLocation(await built);
    };
    const core = config.core ? createCoreClient({
        ...config.core,
        fetchImpl,
        getDelegateToken: ()=>storage.get(STORAGE_KEYS.token),
        getSessionToken: ()=>storage.get(STORAGE_KEYS.coreSession),
        setSessionToken: (token)=>{
            if (token) storage.set(STORAGE_KEYS.coreSession, token);
            else storage.remove(STORAGE_KEYS.coreSession);
        }
    }) : undefined;
    return {
        async getDomainUnid () {
            const identity = getIdentity();
            if (identity?.sub) return identity.sub;
            const stored = storage.get(STORAGE_KEYS.domainUnid);
            if (stored) return stored;
            throw new DelegateIdentityError('login_required', 'No Domain UNID available. Call requestIdentity() first.');
        },
        getIdentity,
        getToken: ()=>getIdentity() ? storage.get(STORAGE_KEYS.token) : null,
        requestIdentity,
        handleCallback,
        ensureLevel,
        changeDelegateInfo,
        logout,
        onChange (cb) {
            listeners.add(cb);
            return ()=>{
                listeners.delete(cb);
            };
        },
        gate (opts) {
            const evaluate = (identity)=>{
                const allowed = meetsGate(opts, identity);
                if (allowed) opts.onAllow?.(identity);
                else opts.onBlock?.(identity);
                opts.onChange?.(allowed, identity);
            };
            evaluate(getIdentity());
            listeners.add(evaluate);
            return ()=>{
                listeners.delete(evaluate);
            };
        },
        get level () {
            return getIdentity()?.level ?? 0;
        },
        get isAnonymous () {
            const identity = getIdentity();
            return !identity || identity.level === 0;
        },
        core
    };
}


//# sourceURL=client.ts