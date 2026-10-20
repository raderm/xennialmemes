/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export const STORAGE_KEYS = {
    token: 'delegate_token',
    domainUnid: 'delegate_domain_unid',
    identity: 'delegate_identity',
    nonce: 'delegate_nonce',
    state: 'delegate_state',
    coreSession: 'engine9_core_session'
};
class MemoryStore {
    map = new Map();
    get(key) {
        return this.map.get(key) ?? null;
    }
    set(key, value) {
        this.map.set(key, value);
    }
    remove(key) {
        this.map.delete(key);
    }
    clearIdentity() {
        for (const key of Object.values(STORAGE_KEYS))this.map.delete(key);
    }
}
class WebStore {
    area;
    constructor(area){
        this.area = area;
    }
    get(key) {
        try {
            return this.area.getItem(key);
        } catch  {
            return null;
        }
    }
    set(key, value) {
        try {
            this.area.setItem(key, value);
        } catch  {}
    }
    remove(key) {
        try {
            this.area.removeItem(key);
        } catch  {}
    }
    clearIdentity() {
        for (const key of Object.values(STORAGE_KEYS))this.remove(key);
    }
}
function webStorage(kind) {
    try {
        if (typeof globalThis === 'undefined') return null;
        return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    } catch  {
        return null;
    }
}
export function isPersistentStore(store) {
    return store instanceof WebStore;
}
export function createStorage(kind = 'session') {
    if (kind === 'memory') return new MemoryStore();
    const area = webStorage(kind);
    if (!area) return new MemoryStore();
    return new WebStore(area);
}


//# sourceURL=storage.ts