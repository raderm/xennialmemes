/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export function base64UrlToBytes(input) {
    const pad = '='.repeat((4 - input.length % 4) % 4);
    const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i += 1)out[i] = bin.charCodeAt(i);
    return out;
}
export function bytesToBase64Url(bytes) {
    let bin = '';
    for(let i = 0; i < bytes.length; i += 1)bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function utf8ToBytes(text) {
    return new TextEncoder().encode(text);
}
export function bytesToUtf8(bytes) {
    return new TextDecoder().decode(bytes);
}
export function decodeJson(part) {
    return JSON.parse(bytesToUtf8(base64UrlToBytes(part)));
}


//# sourceURL=base64url.ts