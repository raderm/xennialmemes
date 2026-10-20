/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
import { createEngine9Id } from './client.js';
import { mount, bindContent, gateFromElement, CONTENT_ATTRIBUTES } from './content.js';
import { isStateMismatch, STATE_MISMATCH } from './errors.js';
import { EMAIL_TYPES, PHONE_TYPES, PERSON_FORM_FIELDS, normalizePersonPayload, identityFieldsFromPersonPayload, createPersonForm } from './forms.js';
import { LEVELS, describeLevel, fieldsForLevel, meetsGate, meetsLevel } from './levels.js';
import { createDelegateProvider } from './provider.js';
import { meetsRequiredAuth, evaluateDeclaredRole, createRoleRegistry, visibleContent } from './roles.js';
import { verifyIdentityToken } from './verify.js';
import { loginWidget } from './widget.js';
const engine9Id = {
    mount,
    loginWidget,
    bindContent,
    gateFromElement,
    CONTENT_ATTRIBUTES,
    createEngine9Id,
    createDelegateProvider,
    LEVELS,
    describeLevel,
    meetsLevel,
    meetsGate,
    fieldsForLevel,
    verifyIdentityToken,
    meetsRequiredAuth,
    evaluateDeclaredRole,
    createRoleRegistry,
    visibleContent,
    EMAIL_TYPES,
    PHONE_TYPES,
    PERSON_FORM_FIELDS,
    normalizePersonPayload,
    identityFieldsFromPersonPayload,
    createPersonForm,
    isStateMismatch,
    STATE_MISMATCH
};
if (typeof window !== 'undefined') {
    window.engine9Id = engine9Id;
}
export default engine9Id;


//# sourceURL=iife.ts