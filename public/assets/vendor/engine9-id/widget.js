/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
import { createEngine9Id } from './client.js';
import { DelegateIdentityError, insecureDomainMessage, isStateMismatch } from './errors.js';
import { describeLevel } from './levels.js';
import { meetsRequiredAuth } from './roles.js';
import { DEFAULT_DELEGATE_URL } from './types.js';
import { isInsecureUrl, trimSlash } from './url.js';
const DEFAULT_LABELS = {
    login: 'Login',
    title: 'Log in to {site}',
    signedInTitle: 'Signed in to {site}',
    google: 'Log in with Google',
    googleOrEmail: 'Log in with Google or email',
    switchEmail: 'Switch email',
    role: 'Role',
    chooseRole: 'Choose a role',
    logout: 'Log out',
    logoutDelegate: 'Also sign out of Delegate in this browser'
};
const FIELD_NAMES = {
    display_name: 'name',
    given_name: 'first name',
    family_name: 'last name',
    email: 'email address',
    phone: 'phone number',
    attributes: 'profile attributes'
};
const GOOGLE_ICON = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';
const DELEGATE_MARK = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#1a73e8"/><path d="M8 6.5h3.6a5.5 5.5 0 0 1 0 11H8z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const CSS = `
:host {
  --e9-accent: #1a73e8; --e9-accent-fg: #fff;
  --e9-bg: #fff; --e9-fg: #1a1f36; --e9-muted: #5b6275;
  --e9-border: #e3e6ef; --e9-surface: #f3f5fa; --e9-danger: #b42318;
  --e9-font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: inline-block;
}
:host([data-theme="dark"]) {
  --e9-bg: #161a23; --e9-fg: #eef1f7; --e9-muted: #a3aabb;
  --e9-border: #2c3242; --e9-surface: #202533; --e9-danger: #f97066;
}
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) {
    --e9-bg: #161a23; --e9-fg: #eef1f7; --e9-muted: #a3aabb;
    --e9-border: #2c3242; --e9-surface: #202533; --e9-danger: #f97066;
  }
}
button { font: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: .55; }
.trigger {
  display: inline-flex; align-items: center; gap: .5em; max-width: 22em;
  padding: .45em 1em; border-radius: 999px; border: 1px solid var(--e9-border);
  background: var(--e9-bg); color: var(--e9-fg);
}
.trigger:hover { background: var(--e9-surface); }
.trigger .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill {
  flex: none; font-size: .72em; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  padding: .15em .55em; border-radius: 999px; background: var(--e9-surface); color: var(--e9-muted);
}
dialog {
  box-sizing: border-box; width: min(380px, calc(100vw - 32px)); padding: 18px 20px 16px;
  border: 1px solid var(--e9-border); border-radius: 16px;
  background: var(--e9-bg); color: var(--e9-fg); font: var(--e9-font);
  box-shadow: 0 24px 64px rgba(10, 14, 30, .28);
}
dialog::backdrop { background: rgba(10, 14, 30, .45); }
.top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; }
.x {
  margin-left: auto; width: 30px; height: 30px; border: 0; border-radius: 8px;
  background: transparent; color: var(--e9-muted); font-size: 20px; line-height: 1;
}
.x:hover { background: var(--e9-surface); }
h2 { margin: 4px 0 10px; font-size: 1.15em; }
h3 { margin: 0 0 6px; font-size: .78em; letter-spacing: .06em; text-transform: uppercase; color: var(--e9-muted); }
p { margin: 0 0 10px; }
.muted { color: var(--e9-muted); }
.fine { font-size: .85em; color: var(--e9-muted); margin: 6px 0 0; }
section { padding: 12px 0; border-top: 1px solid var(--e9-border); }
.card { padding: 12px 14px; border-radius: 12px; background: var(--e9-surface); margin-bottom: 12px; }
.card .email { font-weight: 600; overflow-wrap: anywhere; }
.btn {
  box-sizing: border-box; width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 10px 14px; border-radius: 10px; border: 1px solid var(--e9-border);
  background: var(--e9-bg); color: var(--e9-fg); font-weight: 600;
}
.btn:hover:not(:disabled) { background: var(--e9-surface); }
.btn.primary { background: var(--e9-accent); border-color: var(--e9-accent); color: var(--e9-accent-fg); }
.btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--e9-accent); }
.roles { display: grid; gap: 8px; }
.role {
  text-align: left; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--e9-border);
  background: var(--e9-bg); color: var(--e9-fg);
}
.role:hover:not(:disabled) { background: var(--e9-surface); }
.role[aria-pressed="true"] { border-color: var(--e9-accent); box-shadow: inset 0 0 0 1px var(--e9-accent); }
.role .name { font-weight: 600; }
.role .desc { display: block; font-size: .85em; color: var(--e9-muted); }
label.check { display: flex; gap: 8px; align-items: center; font-size: .9em; color: var(--e9-muted); margin-bottom: 10px; }
.status { margin: 10px 0 0; font-size: .9em; min-height: 0; }
.status:empty { display: none; }
.status.err { color: var(--e9-danger); }
.refused {
  padding: 12px 14px; border-radius: 12px; font-weight: 600; color: var(--e9-danger);
  border: 1px solid currentColor; background: var(--e9-surface); overflow-wrap: anywhere;
}
.foot { margin: 12px 0 0; font-size: .8em; color: var(--e9-muted); text-align: center; }
.foot a { color: inherit; }
`;
function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function listText(items) {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
function normalizeRoles(roles) {
    if (!roles) return [];
    if (Array.isArray(roles)) return roles;
    return Object.entries(roles).map(([key, role])=>({
            ...role,
            id: role.id || key
        }));
}
function resolveTarget(target) {
    if (target && typeof target !== 'string') return target;
    const found = document.querySelector(target ?? '[data-e9-login-widget]');
    if (found) return found;
    if (typeof target === 'string') {
        throw new DelegateIdentityError('invalid_request', `loginWidget target ${target} is not on the page`);
    }
    return document.body;
}
function defaultOnError(error) {
    if (typeof console !== 'undefined') console.warn('[engine9/id]', error);
}
function signInBrand(options) {
    return options.brand ?? (options.siteName ? {
        name: options.siteName
    } : undefined);
}
function pickConfig(options) {
    const { provider, delegateUrl, domain, storage, core, fetchImpl, debug, loginLevel } = options;
    return {
        provider,
        delegateUrl,
        domain,
        storage: storage ?? 'local',
        core,
        fetchImpl,
        debug,
        loginLevel,
        brand: signInBrand(options)
    };
}
export function loginWidget(options = {}) {
    const ownsClient = !options.id;
    const id = options.id ?? createEngine9Id(pickConfig(options));
    const labels = {
        ...DEFAULT_LABELS,
        ...options.labels
    };
    const roles = normalizeRoles(options.roles);
    const onError = options.onError ?? defaultOnError;
    const branding = options.branding !== false;
    const delegateBase = trimSlash(options.delegateUrl ?? DEFAULT_DELEGATE_URL);
    const siteName = options.siteName ?? (typeof location !== 'undefined' ? location.hostname : 'this site');
    const insecurePage = typeof location !== 'undefined' && isInsecureUrl(location.href) ? location.href : null;
    const minLevel = Math.max(1, options.minLevel ?? 1);
    const request = {
        minLevel,
        maxLevel: options.maxLevel,
        fields: options.fields,
        optionalFields: options.optionalFields,
        loginLevel: options.loginLevel,
        brand: signInBrand(options),
        mode: 'popup'
    };
    const state = {
        user: options.user,
        role: options.role ?? options.user?.role ?? null,
        busy: null,
        status: null,
        logoutDelegate: options.logoutDelegate === true
    };
    const host = document.createElement('span');
    host.className = 'e9-login-widget';
    host.dataset.theme = options.theme ?? 'auto';
    const shadow = host.attachShadow({
        mode: 'open'
    });
    shadow.innerHTML = `<style>${CSS}</style><button class="trigger" part="button" type="button" aria-haspopup="dialog"></button><dialog part="dialog" aria-labelledby="e9-title"></dialog>`;
    const trigger = shadow.querySelector('.trigger');
    const dialog = shadow.querySelector('dialog');
    resolveTarget(options.target).appendChild(host);
    const view = ()=>{
        const identity = id.getIdentity();
        if (state.user !== undefined) {
            const user = state.user;
            return {
                signedIn: Boolean(user),
                email: user?.email ?? user?.name ?? null,
                level: user?.level ?? identity?.level ?? 0,
                twoFactor: user?.twoFactor ?? identity?.auth?.two_factor === true
            };
        }
        const fields = identity?.fields;
        return {
            signedIn: (identity?.level ?? 0) >= 1,
            email: fields?.email ?? fields?.display_name ?? fields?.given_name ?? null,
            level: identity?.level ?? 0,
            twoFactor: identity?.auth?.two_factor === true
        };
    };
    const currentRole = ()=>state.role ? roles.find((role)=>role.id === state.role) : undefined;
    const context = ()=>({
            identity: id.getIdentity(),
            user: state.user ?? null
        });
    const site = (text)=>text.replace(/\{site\}/g, siteName);
    const renderTrigger = (v)=>{
        host.dataset.state = v.signedIn ? 'signed-in' : 'signed-out';
        host.dataset.role = v.signedIn ? state.role ?? '' : '';
        if (!v.signedIn) {
            trigger.innerHTML = esc(labels.login);
            trigger.title = '';
            return;
        }
        const role = currentRole();
        const roleName = role?.name ?? state.role;
        trigger.innerHTML = `<span class="who" part="email">${esc(v.email ?? 'Signed in')}</span>` + (roleName ? `<span class="pill" part="role">${esc(roleName)}</span>` : '');
        trigger.title = [
            v.email,
            roleName,
            `Level ${v.level}`
        ].filter(Boolean).join(' · ');
    };
    const signedOutBody = ()=>{
        if (insecurePage) {
            return `<p class="refused" role="alert">${esc(insecureDomainMessage(insecurePage))}</p>`;
        }
        const asked = (options.fields ?? [
            'display_name',
            'email'
        ]).map((f)=>FIELD_NAMES[f] ?? f);
        const level = describeLevel(minLevel);
        const loginText = options.loginLevel === 2 ? labels.googleOrEmail : labels.google;
        return `<p class="muted">${esc(siteName)} asks Delegate for your ${esc(listText(asked))}` + (minLevel >= 2 ? ` at Level ${minLevel} (${esc(level.name)})` : '') + `.</p>` + `<button class="btn primary" type="button" data-action="login">${options.loginLevel === 2 ? '' : GOOGLE_ICON}<span>${esc(loginText)}</span></button>` + `<p class="fine">Delegate opens a window to sign you in, then brings you back here.</p>`;
    };
    const rolesSection = (v)=>{
        if (!roles.length) return '';
        const items = roles.map((role)=>{
            const allowed = meetsRequiredAuth(role.requiredAuth, {
                level: v.level,
                auth: {
                    two_factor: v.twoFactor
                }
            });
            const needs = role.requiredAuth?.minLevel;
            const note = allowed ? role.description : `Needs Level ${needs ?? '?'}${role.requiredAuth?.twoFactor ? ' with two-factor sign-in' : ''}`;
            const pressed = role.id === state.role;
            return `<button class="role" type="button" data-action="role" data-role="${esc(role.id)}" aria-pressed="${pressed}"${allowed ? '' : ' disabled'}>` + `<span class="name">${esc(role.name)}</span>` + (note ? `<span class="desc">${esc(note)}</span>` : '') + `</button>`;
        }).join('');
        return `<section><h3>${esc(state.role ? labels.role : labels.chooseRole)}</h3><div class="roles">${items}</div></section>`;
    };
    const signedInBody = (v)=>{
        const level = describeLevel(v.level);
        const role = currentRole();
        const below = v.level < minLevel;
        const ask = options.logoutDelegate === 'ask';
        return `<div class="card"><div class="email">${esc(v.email ?? 'Signed in')}</div>` + `<div class="fine">Level ${v.level} · ${esc(level.name)}${role ? ` · ${esc(role.name)}` : ''}</div></div>` + (below ? `<p class="muted">${esc(siteName)} needs Level ${minLevel} (${esc(describeLevel(minLevel).name)}).</p>` + `<button class="btn primary" type="button" data-action="login"><span>Confirm with Delegate</span></button>` : '') + `<section><h3>Email</h3>` + `<button class="btn" type="button" data-action="switch-email">${esc(labels.switchEmail)}</button>` + `<p class="fine">Pick another address, add one, or use a different Google account.</p></section>` + rolesSection(v) + `<section>` + (ask ? `<label class="check"><input type="checkbox" data-action="logout-delegate"${state.logoutDelegate ? ' checked' : ''}> ${esc(labels.logoutDelegate)}</label>` : '') + `<button class="btn" type="button" data-action="logout">${esc(labels.logout)}</button></section>`;
    };
    const render = ()=>{
        const v = view();
        renderTrigger(v);
        const title = site(v.signedIn ? labels.signedInTitle : labels.title);
        const top = branding ? `<span class="brand">${DELEGATE_MARK}<span>Delegate</span></span>` : '';
        const foot = branding ? `<p class="foot">Sign-in by <a href="${esc(delegateBase)}" target="_blank" rel="noreferrer">Delegate</a></p>` : '';
        dialog.innerHTML = `<div class="top">${top}<button class="x" type="button" data-action="close" aria-label="Close">×</button></div>` + `<h2 id="e9-title">${esc(title)}</h2>` + (v.signedIn ? signedInBody(v) : signedOutBody()) + `<p class="status${state.status?.kind === 'err' ? ' err' : ''}" role="status">${esc(state.busy ?? state.status?.text ?? '')}</p>` + foot;
        if (state.busy) {
            for (const el of Array.from(dialog.querySelectorAll('button, input'))){
                if (el.dataset.action !== 'close') el.disabled = true;
            }
        }
    };
    const describeError = (error)=>{
        const code = error instanceof DelegateIdentityError ? error.code : undefined;
        if (code === 'insecure_domain') {
            const href = insecurePage ?? (typeof location !== 'undefined' ? location.href : '');
            return href ? insecureDomainMessage(href) : 'Login is not available because the connection is not secure.';
        }
        if (code === 'access_denied') return 'The Delegate window closed before it finished. Try again when you are ready.';
        if (code === 'level_unavailable') return `Delegate did not share what ${siteName} needs, so you are not logged in.`;
        if (code === 'invalid_domain') return `Delegate does not accept ${siteName} yet. The site operator needs to register it.`;
        if (isStateMismatch(error)) return 'That sign-in belonged to an earlier attempt. Log in again.';
        return error instanceof Error ? error.message : String(error);
    };
    const run = (busy, action)=>{
        if (state.busy) return Promise.resolve();
        state.busy = busy;
        state.status = null;
        render();
        let pending;
        try {
            pending = action();
        } catch (error) {
            pending = Promise.reject(error);
        }
        return pending.catch((error)=>{
            state.status = {
                text: describeError(error),
                kind: 'err'
            };
            onError(error);
        }).finally(()=>{
            state.busy = null;
            render();
        });
    };
    const afterIdentity = async (identity)=>{
        const user = await options.onLogin?.(identity, id.getToken());
        if (user && typeof user === 'object') {
            state.user = user;
            if (user.role !== undefined) state.role = user.role ?? null;
        } else if (state.user !== undefined) {
            state.user = {
                email: identity.fields?.email ?? identity.fields?.display_name ?? null,
                level: identity.level,
                twoFactor: identity.auth?.two_factor === true,
                role: state.role
            };
        }
    };
    const login = ()=>run('Waiting for Delegate…', async ()=>{
            const identity = await id.requestIdentity(request);
            if (!identity) return;
            await afterIdentity(identity);
            if (!roles.length || state.role) close();
        });
    const switchEmail = ()=>run('Waiting for Delegate…', async ()=>{
            const identity = await id.changeDelegateInfo(request);
            if (!identity) return;
            await afterIdentity(identity);
            const email = view().email;
            state.status = {
                text: email ? `${siteName} now sees ${email}.` : 'Updated.',
                kind: 'ok'
            };
        });
    const changeRole = (roleId)=>{
        if (roleId === state.role) return Promise.resolve();
        const role = roles.find((r)=>r.id === roleId);
        return run(`Switching to ${role?.name ?? roleId}…`, async ()=>{
            await options.onRoleChange?.(roleId, context());
            state.role = roleId;
            if (state.user) state.user = {
                ...state.user,
                role: roleId
            };
        });
    };
    const logout = ()=>{
        const delegate = options.logoutDelegate === true || options.logoutDelegate === 'ask' && state.logoutDelegate;
        return run('Logging out…', async ()=>{
            if (state.user !== undefined) state.user = null;
            state.role = null;
            const site = Promise.resolve(options.onLogout?.());
            const ended = id.logout({
                delegate,
                mode: 'popup'
            });
            await Promise.all([
                site,
                ended
            ]);
            close();
        });
    };
    const isOpen = ()=>dialog.open || dialog.hasAttribute('open');
    const open = ()=>{
        render();
        if (isOpen()) return;
        if (typeof dialog.showModal === 'function') {
            try {
                dialog.showModal();
                return;
            } catch  {}
        }
        dialog.setAttribute('open', '');
    };
    function close() {
        if (!isOpen()) return;
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
        state.status = null;
    }
    const onDialogClick = (event)=>{
        if (event.target === dialog) {
            const box = dialog.getBoundingClientRect();
            const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
            if (!inside) close();
            return;
        }
        const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
        if (!(target instanceof HTMLElement) || target.matches(':disabled')) return;
        switch(target.dataset.action){
            case 'close':
                close();
                break;
            case 'login':
                void login();
                break;
            case 'switch-email':
                void switchEmail();
                break;
            case 'role':
                if (target.dataset.role) void changeRole(target.dataset.role);
                break;
            case 'logout':
                void logout();
                break;
        }
    };
    const onDialogChange = (event)=>{
        const target = event.target;
        if (target instanceof HTMLInputElement && target.dataset.action === 'logout-delegate') {
            state.logoutDelegate = target.checked;
        }
    };
    trigger.addEventListener('click', open);
    dialog.addEventListener('click', onDialogClick);
    dialog.addEventListener('change', onDialogChange);
    const unsubscribe = id.onChange(()=>{
        if (!state.busy) render();
    });
    if (ownsClient) {
        void id.handleCallback().then((identity)=>identity ? afterIdentity(identity) : undefined).catch((error)=>{
            if (!isStateMismatch(error)) onError(error);
        }).finally(render);
    }
    render();
    return {
        element: host,
        id,
        open,
        close,
        update (next) {
            if (next.user !== undefined) {
                state.user = next.user;
                if (next.user?.role !== undefined) state.role = next.user.role ?? null;
            }
            if (next.role !== undefined) state.role = next.role;
            render();
        },
        destroy () {
            unsubscribe();
            trigger.removeEventListener('click', open);
            dialog.removeEventListener('click', onDialogClick);
            dialog.removeEventListener('change', onDialogChange);
            host.remove();
        }
    };
}


//# sourceURL=widget.ts