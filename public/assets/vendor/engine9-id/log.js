/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export const LOG_PREFIX = '[engine9-id]';
export function createDebugLog(enabled) {
    if (!enabled || typeof console === 'undefined') return ()=>{};
    return (step, detail)=>{
        if (detail === undefined) console.info(LOG_PREFIX, step);
        else console.info(LOG_PREFIX, step, detail);
    };
}


//# sourceURL=log.ts