/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export function trimSlash(url) {
    return url.replace(/\/+$/, '');
}
export function domainFromUrl(urlOrOrigin) {
    try {
        const u = new URL(urlOrOrigin);
        const hostname = u.hostname.toLowerCase();
        if (!hostname) return null;
        return u.port ? `${hostname}:${u.port}` : hostname;
    } catch  {
        return null;
    }
}
export function isInsecureUrl(href) {
    try {
        const u = new URL(href);
        if (u.protocol !== 'http:') return false;
        const host = u.hostname.toLowerCase();
        return host !== 'localhost' && host !== '127.0.0.1';
    } catch  {
        return false;
    }
}
function setOptional(params, key, value) {
    if (value === undefined || value === '') return;
    params.set(key, String(value));
}
function setBrand(params, brand) {
    if (!brand) return;
    setOptional(params, 'brand_name', brand.name?.trim());
    setOptional(params, 'brand_color', brand.color?.trim());
    setOptional(params, 'brand_logo', brand.logo?.trim());
    setOptional(params, 'brand_wordmark', brand.wordmark?.trim());
    setOptional(params, 'brand_background', brand.background?.trim());
    setOptional(params, 'brand_text', brand.text?.trim());
    setOptional(params, 'brand_card', brand.card?.trim());
    setOptional(params, 'brand_card_text', brand.cardText?.trim());
    setOptional(params, 'brand_font', brand.font?.trim());
    setOptional(params, 'brand_google', brand.google);
}
function fieldsParam(fields) {
    if (!fields) return undefined;
    return Array.isArray(fields) ? fields.join(',') : fields;
}
export function authorizeUrl(opts) {
    const base = opts.authorizeEndpoint ?? `${trimSlash(opts.delegateUrl)}/identity/authorize`;
    const url = new URL(base);
    url.searchParams.set('domain', opts.domain);
    url.searchParams.set('return_to', opts.returnTo);
    setOptional(url.searchParams, 'min_level', opts.minLevel);
    setOptional(url.searchParams, 'max_level', opts.maxLevel);
    setOptional(url.searchParams, 'fields', fieldsParam(opts.fields));
    setOptional(url.searchParams, 'optional_fields', fieldsParam(opts.optionalFields));
    setOptional(url.searchParams, 'prompt', opts.prompt);
    setOptional(url.searchParams, 'login_level', opts.loginLevel);
    setBrand(url.searchParams, opts.brand);
    setOptional(url.searchParams, 'expires_in', opts.expiresIn);
    setOptional(url.searchParams, 'nonce', opts.nonce);
    setOptional(url.searchParams, 'state', opts.state);
    setOptional(url.searchParams, 'response_mode', opts.responseMode);
    return url.toString();
}
export function bridgeUrl(opts) {
    const base = opts.bridgeEndpoint ?? `${trimSlash(opts.delegateUrl)}/identity/bridge`;
    const url = new URL(base);
    url.searchParams.set('domain', opts.domain);
    setOptional(url.searchParams, 'min_level', opts.minLevel);
    setOptional(url.searchParams, 'max_level', opts.maxLevel);
    setOptional(url.searchParams, 'fields', fieldsParam(opts.fields));
    setOptional(url.searchParams, 'optional_fields', fieldsParam(opts.optionalFields));
    setOptional(url.searchParams, 'prompt', opts.prompt);
    setOptional(url.searchParams, 'login_level', opts.loginLevel);
    setBrand(url.searchParams, opts.brand);
    setOptional(url.searchParams, 'expires_in', opts.expiresIn);
    setOptional(url.searchParams, 'nonce', opts.nonce);
    setOptional(url.searchParams, 'state', opts.state);
    return url.toString();
}
export function logoutUrl(opts) {
    const base = opts.logoutEndpoint ?? `${trimSlash(opts.delegateUrl)}/identity/logout`;
    const url = new URL(base);
    url.searchParams.set('domain', opts.domain);
    setOptional(url.searchParams, 'return_to', opts.returnTo);
    return url.toString();
}
export function logoutBridgeUrl(opts) {
    const base = opts.logoutBridgeEndpoint ?? `${trimSlash(opts.delegateUrl)}/identity/logout/bridge`;
    const url = new URL(base);
    url.searchParams.set('domain', opts.domain);
    return url.toString();
}
function paramsFrom(part, strip) {
    const raw = part.startsWith(strip) ? part.slice(1) : part;
    return new URLSearchParams(raw);
}
export function parseDelegateCallback(source) {
    let hash = '';
    let search = '';
    if (typeof source === 'string') {
        try {
            const url = new URL(source);
            hash = url.hash;
            search = url.search;
        } catch  {
            return null;
        }
    } else if (source) {
        if (source.href && !source.hash && !source.search) {
            try {
                const url = new URL(source.href);
                hash = url.hash;
                search = url.search;
            } catch  {
                hash = source.hash ?? '';
                search = source.search ?? '';
            }
        } else {
            hash = source.hash ?? '';
            search = source.search ?? '';
        }
    } else if (typeof location !== 'undefined') {
        hash = location.hash ?? '';
        search = location.search ?? '';
    }
    const fromHash = paramsFrom(hash, '#');
    const fromSearch = paramsFrom(search, '?');
    const token = fromHash.get('delegate_token') || fromSearch.get('delegate_token') || undefined;
    const error = fromSearch.get('error') || fromHash.get('error') || undefined;
    const state = fromHash.get('state') || fromSearch.get('state') || undefined;
    if (!token && !error) return null;
    return {
        token,
        error,
        state
    };
}
export function stripCallbackParams(href) {
    const url = new URL(href);
    url.searchParams.delete('delegate_token');
    url.searchParams.delete('state');
    url.searchParams.delete('error');
    if (url.hash) {
        const hashParams = paramsFrom(url.hash, '#');
        if (hashParams.has('delegate_token') || hashParams.has('state') || hashParams.has('error')) {
            hashParams.delete('delegate_token');
            hashParams.delete('state');
            hashParams.delete('error');
            const leftover = hashParams.toString();
            url.hash = leftover ? leftover : '';
        }
    }
    return `${url.pathname}${url.search}${url.hash}`;
}


//# sourceURL=url.ts