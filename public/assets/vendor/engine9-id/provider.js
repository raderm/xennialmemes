/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
import { defaultConfiguration, fetchDiscovery, fetchJwks } from './discovery.js';
import { DEFAULT_DELEGATE_URL } from './types.js';
import { authorizeUrl, bridgeUrl, logoutBridgeUrl, logoutUrl, trimSlash } from './url.js';
import { verifyIdentityToken } from './verify.js';
function defaultFetch(input, init) {
    if (typeof fetch !== 'function') {
        throw new Error('fetch is required');
    }
    return fetch(input, init);
}
export function createDelegateProvider(options = {}) {
    const delegateUrl = trimSlash(options.delegateUrl ?? DEFAULT_DELEGATE_URL);
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    return {
        id: 'delegate',
        async discover () {
            return fetchDiscovery(delegateUrl, fetchImpl);
        },
        async buildAuthorizeUrl (opts) {
            const discovery = await fetchDiscovery(delegateUrl, fetchImpl);
            return authorizeUrl({
                delegateUrl,
                domain: opts.domain,
                returnTo: opts.returnTo,
                minLevel: opts.minLevel,
                maxLevel: opts.maxLevel,
                fields: opts.fields,
                optionalFields: opts.optionalFields,
                prompt: opts.prompt,
                loginLevel: opts.loginLevel,
                brand: opts.brand,
                expiresIn: opts.expiresIn,
                nonce: opts.nonce,
                state: opts.state,
                responseMode: opts.responseMode,
                authorizeEndpoint: discovery.identity_authorize_endpoint
            });
        },
        async buildBridgeUrl (opts) {
            const discovery = await fetchDiscovery(delegateUrl, fetchImpl);
            return bridgeUrl({
                delegateUrl,
                domain: opts.domain,
                minLevel: opts.minLevel,
                maxLevel: opts.maxLevel,
                fields: opts.fields,
                optionalFields: opts.optionalFields,
                prompt: opts.prompt,
                loginLevel: opts.loginLevel,
                brand: opts.brand,
                expiresIn: opts.expiresIn,
                nonce: opts.nonce,
                state: opts.state,
                bridgeEndpoint: discovery.identity_bridge_endpoint
            });
        },
        buildLogoutUrl (opts) {
            const discovery = defaultConfiguration(delegateUrl);
            return logoutUrl({
                delegateUrl,
                domain: opts.domain,
                returnTo: opts.returnTo,
                logoutEndpoint: discovery.logout_endpoint
            });
        },
        buildLogoutBridgeUrl (opts) {
            const discovery = defaultConfiguration(delegateUrl);
            return logoutBridgeUrl({
                delegateUrl,
                domain: opts.domain,
                logoutBridgeEndpoint: discovery.logout_bridge_endpoint
            });
        },
        messageOrigin (config) {
            return new URL(config.issuer || delegateUrl).origin;
        },
        async verifyToken (token, opts) {
            const discovery = await fetchDiscovery(delegateUrl, fetchImpl);
            const jwks = await fetchJwks(discovery.jwks_uri, fetchImpl);
            return verifyIdentityToken({
                token,
                jwks,
                domain: opts.domain,
                issuer: discovery.issuer,
                nonce: opts.nonce
            });
        }
    };
}


//# sourceURL=provider.ts