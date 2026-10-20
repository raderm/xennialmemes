/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export const LEVELS = {
    0: 'Inferred',
    1: 'Provided',
    2: 'Contact Confirmed',
    3: 'Trusted Provider Confirmed',
    4: 'Trusted Provider Strongly Confirmed',
    5: 'Identity Checked',
    6: 'Identity Verified',
    7: 'High-Assurance Identity'
};
const MEANINGS = {
    0: 'We inferred information about this visitor, but the visitor has not confirmed it.',
    1: 'The visitor supplied identity or contact information, but it has not been confirmed.',
    2: 'The visitor demonstrated control of a contact method.',
    3: 'A trusted identity provider authenticated the visitor and confirmed a stable digital identity.',
    4: 'A trusted identity provider authenticated the visitor using a strong authentication method.',
    5: 'The claimed real-world identity has been checked against trusted evidence or records.',
    6: 'Strong evidence establishes that the visitor is the real-world person they claim to be.',
    7: 'The person\'s real-world identity was established with a highest-assurance proofing process.'
};
const SHAREABLE_FIELDS = [
    'display_name',
    'given_name',
    'family_name',
    'email',
    'phone',
    'attributes'
];
export function describeLevel(level) {
    if (!Number.isInteger(level) || level < 0 || level > 7) {
        return {
            level,
            name: 'Unknown',
            meaning: 'Not a defined engine9 Identity Level.',
            category: 'unknown'
        };
    }
    const n = level;
    return {
        level,
        name: LEVELS[n],
        meaning: MEANINGS[n],
        category: level <= 4 ? 'digital' : 'real-world'
    };
}
export function meetsLevel(identity, minLevel) {
    if (!identity || typeof identity.level !== 'number') return false;
    return identity.level >= minLevel;
}
export function meetsGate(gate, identity) {
    if (!gate) return true;
    const level = typeof identity?.level === 'number' ? identity.level : 0;
    if (typeof gate.minLevel === 'number' && level < gate.minLevel) return false;
    if (typeof gate.maxLevel === 'number' && level > gate.maxLevel) return false;
    if (gate.twoFactor === true && identity?.auth?.two_factor !== true) return false;
    return true;
}
export function fieldsForLevel(level) {
    if (level <= 0) return [];
    const fields = [
        ...SHAREABLE_FIELDS
    ];
    if (level >= 2) fields.push('email_verified', 'phone_verified');
    if (level >= 5) fields.push('verified_claims');
    return fields;
}


//# sourceURL=levels.ts