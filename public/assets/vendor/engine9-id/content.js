/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
import { createEngine9Id } from './client.js';
import { isStateMismatch } from './errors.js';
import { describeLevel, meetsGate, meetsLevel } from './levels.js';
export const CONTENT_ATTRIBUTES = {
    minLevel: 'data-e9-min-level',
    maxLevel: 'data-e9-max-level',
    twoFactor: 'data-e9-two-factor',
    login: 'data-e9-login',
    logout: 'data-e9-logout',
    changeDelegate: 'data-e9-change-delegate',
    fields: 'data-e9-fields',
    optionalFields: 'data-e9-optional-fields',
    prompt: 'data-e9-prompt',
    loginLevel: 'data-e9-login-level',
    field: 'data-e9-field',
    level: 'data-e9-level',
    state: 'data-e9-state'
};
const GATE_SELECTOR = [
    `[${CONTENT_ATTRIBUTES.minLevel}]`,
    `[${CONTENT_ATTRIBUTES.maxLevel}]`,
    `[${CONTENT_ATTRIBUTES.twoFactor}]`
].join(',');
function parseLevel(raw) {
    if (raw === null || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
}
function parseFields(raw) {
    if (raw === null || raw.trim() === '') return undefined;
    const fields = raw.split(',').map((s)=>s.trim()).filter(Boolean);
    return fields.length ? fields : undefined;
}
function parseLoginLevel(raw) {
    const n = Number(raw);
    return raw !== null && (n === 2 || n === 3 || n === 4) ? n : undefined;
}
function parsePrompt(raw) {
    if (raw === 'none' || raw === 'select' || raw === 'consent' || raw === 'login') {
        return raw;
    }
    return undefined;
}
export function gateFromElement(el) {
    const gate = {};
    let any = false;
    const min = parseLevel(el.getAttribute(CONTENT_ATTRIBUTES.minLevel));
    if (min !== undefined) {
        gate.minLevel = min;
        any = true;
    }
    const max = parseLevel(el.getAttribute(CONTENT_ATTRIBUTES.maxLevel));
    if (max !== undefined) {
        gate.maxLevel = max;
        any = true;
    }
    if (el.hasAttribute(CONTENT_ATTRIBUTES.twoFactor)) {
        gate.twoFactor = el.getAttribute(CONTENT_ATTRIBUTES.twoFactor) !== 'false';
        any = true;
    }
    return any ? gate : null;
}
function setVisible(el, allowed) {
    if (el instanceof HTMLElement) el.hidden = !allowed;
    el.setAttribute(CONTENT_ATTRIBUTES.state, allowed ? 'allowed' : 'blocked');
}
function defaultOnError(error) {
    if (typeof console !== 'undefined') console.warn('[engine9/id]', error);
}
export function bindContent(id, options = {}) {
    const root = options.root ?? (typeof document !== 'undefined' ? document : undefined);
    const onError = options.onError ?? defaultOnError;
    const originalText = new WeakMap();
    const apply = ()=>{
        if (!root) return;
        const identity = id.getIdentity();
        for (const el of Array.from(root.querySelectorAll(GATE_SELECTOR))){
            setVisible(el, meetsGate(gateFromElement(el), identity));
        }
        for (const el of Array.from(root.querySelectorAll(`[${CONTENT_ATTRIBUTES.login}]`))){
            if (gateFromElement(el)) continue;
            const level = parseLevel(el.getAttribute(CONTENT_ATTRIBUTES.login)) ?? options.minLevel ?? 1;
            setVisible(el, !meetsLevel(identity, level));
        }
        for (const el of Array.from(root.querySelectorAll(`[${CONTENT_ATTRIBUTES.logout}], [${CONTENT_ATTRIBUTES.changeDelegate}]`))){
            if (gateFromElement(el)) continue;
            setVisible(el, !id.isAnonymous);
        }
        for (const el of Array.from(root.querySelectorAll(`[${CONTENT_ATTRIBUTES.field}]`))){
            const field = el.getAttribute(CONTENT_ATTRIBUTES.field) ?? '';
            if (!originalText.has(el)) originalText.set(el, el.textContent ?? '');
            const value = identity?.fields?.[field];
            el.textContent = typeof value === 'string' || typeof value === 'number' ? String(value) : originalText.get(el) ?? '';
        }
        for (const el of Array.from(root.querySelectorAll(`[${CONTENT_ATTRIBUTES.level}]`))){
            const level = identity?.level ?? 0;
            el.textContent = el.getAttribute(CONTENT_ATTRIBUTES.level) === 'name' ? describeLevel(level).name : String(level);
        }
    };
    const onClick = (event)=>{
        const target = event.target;
        if (!(target instanceof Element)) return;
        const loginEl = target.closest(`[${CONTENT_ATTRIBUTES.login}]`);
        if (loginEl) {
            event.preventDefault();
            const minLevel = parseLevel(loginEl.getAttribute(CONTENT_ATTRIBUTES.login)) ?? options.minLevel ?? 1;
            const fields = parseFields(loginEl.getAttribute(CONTENT_ATTRIBUTES.fields)) ?? options.fields;
            const optionalFields = parseFields(loginEl.getAttribute(CONTENT_ATTRIBUTES.optionalFields)) ?? options.optionalFields;
            const prompt = parsePrompt(loginEl.getAttribute(CONTENT_ATTRIBUTES.prompt)) ?? options.prompt;
            id.requestIdentity({
                minLevel,
                fields,
                optionalFields,
                prompt,
                loginLevel: parseLoginLevel(loginEl.getAttribute(CONTENT_ATTRIBUTES.loginLevel)),
                mode: options.mode ?? 'popup'
            }).catch(onError);
            return;
        }
        const changeEl = target.closest(`[${CONTENT_ATTRIBUTES.changeDelegate}]`);
        if (changeEl) {
            event.preventDefault();
            id.changeDelegateInfo({
                minLevel: parseLevel(changeEl.getAttribute(CONTENT_ATTRIBUTES.changeDelegate)),
                fields: parseFields(changeEl.getAttribute(CONTENT_ATTRIBUTES.fields)),
                optionalFields: parseFields(changeEl.getAttribute(CONTENT_ATTRIBUTES.optionalFields)),
                loginLevel: parseLoginLevel(changeEl.getAttribute(CONTENT_ATTRIBUTES.loginLevel)),
                mode: options.mode ?? 'popup'
            }).catch(onError);
            return;
        }
        const logoutEl = target.closest(`[${CONTENT_ATTRIBUTES.logout}]`);
        if (logoutEl) {
            event.preventDefault();
            id.logout({
                delegate: logoutEl.getAttribute(CONTENT_ATTRIBUTES.logout) === 'delegate'
            }).catch(onError);
        }
    };
    root?.addEventListener('click', onClick);
    const unsubscribe = id.onChange(apply);
    let onReady;
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
        onReady = ()=>apply();
        document.addEventListener('DOMContentLoaded', onReady, {
            once: true
        });
    }
    apply();
    return {
        apply,
        unbind () {
            root?.removeEventListener('click', onClick);
            unsubscribe();
            if (onReady) document.removeEventListener('DOMContentLoaded', onReady);
        }
    };
}
export function mount(options = {}) {
    const { root, minLevel, fields, optionalFields, mode, prompt, onError, ...config } = options;
    const id = createEngine9Id({
        storage: 'local',
        ...config
    });
    const binding = bindContent(id, {
        root,
        minLevel,
        fields,
        optionalFields,
        mode,
        prompt,
        onError
    });
    const report = onError ?? defaultOnError;
    const ready = id.handleCallback().catch((error)=>{
        if (!isStateMismatch(error)) report(error);
        return null;
    }).then((identity)=>{
        binding.apply();
        return identity;
    });
    return {
        getDomainUnid: ()=>id.getDomainUnid(),
        getIdentity: ()=>id.getIdentity(),
        getToken: ()=>id.getToken(),
        requestIdentity: (opts)=>id.requestIdentity(opts),
        handleCallback: ()=>id.handleCallback(),
        ensureLevel: (n, opts)=>id.ensureLevel(n, opts),
        changeDelegateInfo: (opts)=>id.changeDelegateInfo(opts),
        logout: (opts)=>id.logout(opts),
        onChange: (cb)=>id.onChange(cb),
        gate: (opts)=>id.gate(opts),
        get level () {
            return id.level;
        },
        get isAnonymous () {
            return id.isAnonymous;
        },
        core: id.core,
        ready,
        apply: binding.apply,
        unmount: binding.unbind
    };
}


//# sourceURL=content.ts