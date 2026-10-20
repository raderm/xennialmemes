/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export function meetsRequiredAuth(requiredAuth, identity) {
    if (!requiredAuth || typeof requiredAuth !== 'object') return true;
    if (requiredAuth.twoFactor === true && !identity?.auth?.two_factor) return false;
    if (typeof requiredAuth.minLevel === 'number') {
        const level = Number(identity?.level);
        if (!Number.isFinite(level) || level < requiredAuth.minLevel) return false;
    }
    return true;
}
function attributesMatch(expected, actual) {
    if (!expected || typeof expected !== 'object') return true;
    if (!actual || typeof actual !== 'object') return false;
    for (const [key, value] of Object.entries(expected)){
        if (actual[key] !== value) return false;
    }
    return true;
}
function isClaimed(roleId, claimedIds) {
    if (!claimedIds) return false;
    for (const id of claimedIds){
        if (id === roleId) return true;
    }
    return false;
}
export function evaluateDeclaredRole(role, ctx) {
    const claimed = isClaimed(role.id, ctx.claimedIds);
    const attrOk = attributesMatch(role.match?.attributes, ctx.identity?.fields?.attributes);
    const hasMatchRule = Boolean(role.match?.attributes && Object.keys(role.match.attributes).length > 0);
    const matches = claimed || hasMatchRule && attrOk;
    const meetsAuth = meetsRequiredAuth(role.requiredAuth, ctx.identity);
    return {
        role,
        matches,
        meetsAuth,
        visible: matches && meetsAuth
    };
}
export function createRoleRegistry(roles) {
    if (Array.isArray(roles)) {
        const out = {};
        for (const role of roles){
            out[role.id] = role;
        }
        return out;
    }
    return {
        ...roles
    };
}
export function visibleContent(registry, ctx) {
    const out = {};
    for (const [id, role] of Object.entries(registry)){
        out[id] = evaluateDeclaredRole(role.id ? role : {
            ...role,
            id
        }, ctx);
    }
    return out;
}


//# sourceURL=roles.ts