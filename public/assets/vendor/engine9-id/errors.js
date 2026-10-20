/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export class DelegateIdentityError extends Error {
    code;
    details;
    constructor(code, message, details){
        super(message ?? code);
        this.name = 'DelegateIdentityError';
        this.code = code;
        if (details) this.details = details;
    }
}
export const STATE_MISMATCH = 'state_mismatch';
export function isStateMismatch(error) {
    return error instanceof DelegateIdentityError && error.code === STATE_MISMATCH;
}
const DELEGATE_ERROR_TEXT = {
    interaction_required: 'Delegate needs the User to sign in or choose what to share, and prompt=none does not allow that.',
    login_required: 'The User is not signed in to Delegate, and this request did not allow a sign-in page.',
    level_unavailable: 'The User did not share the fields the requested Identity Level needs (min_level > 0).',
    access_denied: 'The User declined the request.',
    invalid_domain: 'Delegate does not accept this Domain. Add it to ALLOWED_DOMAINS or register it on Delegate, and check that return_to is on the same Domain.',
    insecure_domain: 'The page is plain http. Identity Tokens only go to https pages (or http://localhost for development).',
    invalid_request: 'Delegate rejected the request parameters (return_to, fields, levels, or the chosen email address).'
};
export function insecureDomainMessage(href) {
    const { origin, host } = new URL(href);
    return `Login is not available on ${origin} because the connection is not secure. Open https://${host} instead.`;
}
export function insecureDomainError(href) {
    return new DelegateIdentityError('insecure_domain', insecureDomainMessage(href), {
        step: 'request',
        url: href
    });
}
export function delegateReturnedError(code, details) {
    const why = DELEGATE_ERROR_TEXT[code];
    return new DelegateIdentityError(code, why ? `Delegate returned ${code}: ${why}` : `Delegate returned ${code}`, details);
}


//# sourceURL=errors.ts