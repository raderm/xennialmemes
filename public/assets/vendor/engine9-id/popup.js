/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
import { DelegateIdentityError, delegateReturnedError } from './errors.js';
import { LOG_PREFIX } from './log.js';
export const DELEGATE_IDENTITY_MESSAGE = 'delegate-identity';
export const DELEGATE_LOGOUT_MESSAGE = 'delegate-logout';
function isIdentityMessage(data) {
    return Boolean(data && typeof data === 'object' && 'type' in data);
}
export function listenForDelegateIdentity(opts) {
    const { expectedOrigin, popup, signal } = opts;
    const log = opts.log ?? (()=>{});
    return new Promise((resolve, reject)=>{
        if (signal?.aborted) {
            reject(new DelegateIdentityError('access_denied', 'Identity popup aborted'));
            return;
        }
        const cleanup = ()=>{
            window.removeEventListener('message', onMessage);
            signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = ()=>{
            cleanup();
            reject(new DelegateIdentityError('access_denied', 'Identity popup aborted'));
        };
        const onMessage = (event)=>{
            if (!isIdentityMessage(event.data)) return;
            if (event.data.type !== DELEGATE_IDENTITY_MESSAGE) return;
            if (event.origin !== expectedOrigin) {
                console.warn(LOG_PREFIX, `Ignored a ${DELEGATE_IDENTITY_MESSAGE} message from ${event.origin}; expected ${expectedOrigin}. Check delegateUrl.`);
                return;
            }
            if (popup && event.source && event.source !== popup) {
                log('popup:message_from_other_window_ignored', {
                    origin: event.origin
                });
                return;
            }
            if (typeof event.data.token !== 'string' || !event.data.token) {
                if (typeof event.data.error === 'string' && event.data.error) {
                    log('popup:error_received', {
                        error: event.data.error
                    });
                    cleanup();
                    reject(delegateReturnedError(event.data.error, {
                        step: 'popup',
                        state: event.data.state
                    }));
                }
                return;
            }
            log('popup:token_received', {
                tokenLength: event.data.token.length
            });
            cleanup();
            resolve({
                token: event.data.token,
                state: typeof event.data.state === 'string' ? event.data.state : undefined
            });
        };
        window.addEventListener('message', onMessage);
        signal?.addEventListener('abort', onAbort);
    });
}
export function openIdentityPopup(opts) {
    const log = opts.log ?? (()=>{});
    const popup = window.open(opts.url, opts.name ?? 'engine9-identity', opts.features ?? 'popup=yes,width=480,height=720');
    if (!popup) {
        log('popup:blocked', {
            url: opts.url
        });
        return Promise.resolve(null);
    }
    const openedAt = Date.now();
    log('popup:opened', {
        url: opts.url,
        expectedOrigin: opts.expectedOrigin
    });
    const controller = new AbortController();
    const closed = new Promise((_, reject)=>{
        const timer = window.setInterval(()=>{
            if (popup.closed) {
                window.clearInterval(timer);
                controller.abort();
                const openForMs = Date.now() - openedAt;
                log('popup:closed_without_message', {
                    openForMs
                });
                reject(new DelegateIdentityError('access_denied', `Identity popup closed after ${Math.round(openForMs / 1000)}s without sending an Identity Token. ` + 'Either it was closed by hand, or it lost its link to this page: a page shown in it sent ' + 'Cross-Origin-Opener-Policy (a Cloudflare bot check on Delegate does this), and the browser ' + "then reports the window as closed. If this repeats, use mode: 'redirect'.", {
                    step: 'popup',
                    reason: 'popup_closed',
                    openForMs,
                    url: opts.url
                }));
            }
        }, 300);
        controller.signal.addEventListener('abort', ()=>window.clearInterval(timer));
    });
    return Promise.race([
        listenForDelegateIdentity({
            expectedOrigin: opts.expectedOrigin,
            popup,
            signal: controller.signal,
            log
        }).finally(()=>{
            controller.abort();
            try {
                popup.close();
            } catch  {}
        }),
        closed
    ]);
}
export function openLogoutPopup(opts) {
    const log = opts.log ?? (()=>{});
    const popup = window.open(opts.url, 'engine9-logout', 'popup=yes,width=420,height=320');
    if (!popup) {
        log('logout_popup:blocked', {
            url: opts.url
        });
        return Promise.resolve(null);
    }
    log('logout_popup:opened', {
        url: opts.url
    });
    return new Promise((resolve)=>{
        const finish = (result)=>{
            window.clearInterval(timer);
            window.removeEventListener('message', onMessage);
            log(`logout_popup:${result}`, {});
            resolve(result);
        };
        const onMessage = (event)=>{
            const data = event.data;
            if (!data || typeof data !== 'object' || data.type !== DELEGATE_LOGOUT_MESSAGE) return;
            if (event.origin !== opts.expectedOrigin) return;
            if (event.source && event.source !== popup) return;
            finish('loggedOut');
        };
        const timer = window.setInterval(()=>{
            if (popup.closed) finish('closed');
        }, 300);
        window.addEventListener('message', onMessage);
    });
}


//# sourceURL=popup.ts