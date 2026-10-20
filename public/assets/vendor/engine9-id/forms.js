/* @engine9/id 1.11.0 (7e2964f), MIT license, see LICENSE. Built by scripts/build-id.js; do not edit. */
export const EMAIL_TYPES = [
    'Personal',
    'Work',
    'Other'
];
export const PHONE_TYPES = [
    'Personal',
    'Cell',
    'Home',
    'Work',
    'Fax',
    'Other'
];
export const PERSON_FORM_FIELDS = [
    'given_name',
    'family_name',
    'email',
    'email_type',
    'phone',
    'phone_type',
    'display_name'
];
function asTrimmedString(value) {
    if (value == null) return undefined;
    const s = String(value).trim();
    return s || undefined;
}
function normalizeEmailType(value) {
    const s = asTrimmedString(value);
    if (!s) return undefined;
    const found = EMAIL_TYPES.find((t)=>t.toLowerCase() === s.toLowerCase());
    return found;
}
function normalizePhoneType(value) {
    const s = asTrimmedString(value);
    if (!s) return undefined;
    const found = PHONE_TYPES.find((t)=>t.toLowerCase() === s.toLowerCase());
    return found;
}
export function normalizePersonPayload(input, opts = {}) {
    const raw = {};
    if (typeof FormData !== 'undefined' && input instanceof FormData) {
        input.forEach((value, key)=>{
            if (typeof value === 'string') raw[key] = value;
        });
    } else if (input && typeof input === 'object') {
        Object.assign(raw, input);
    }
    const given_name = asTrimmedString(raw.given_name);
    const family_name = asTrimmedString(raw.family_name);
    const email = asTrimmedString(raw.email)?.toLowerCase();
    const phone = asTrimmedString(raw.phone);
    const display_name = asTrimmedString(raw.display_name);
    const source_code = asTrimmedString(raw.source_code);
    const payload = {};
    if (given_name) payload.given_name = given_name;
    if (family_name) payload.family_name = family_name;
    if (email) {
        payload.email = email;
        payload.email_type = normalizeEmailType(raw.email_type) ?? opts.defaultEmailType ?? 'Personal';
    }
    if (phone) {
        payload.phone = phone;
        payload.phone_type = normalizePhoneType(raw.phone_type) ?? opts.defaultPhoneType ?? 'Personal';
    }
    if (display_name) payload.display_name = display_name;
    if (source_code) payload.source_code = source_code;
    return payload;
}
export function identityFieldsFromPersonPayload(payload) {
    const fields = [];
    for (const key of [
        'given_name',
        'family_name',
        'email',
        'phone',
        'display_name'
    ]){
        if (payload[key]) fields.push(key);
    }
    return fields;
}
function resolveEl(target, root = document) {
    if (!target) return null;
    if (typeof target === 'string') return root.querySelector(target);
    return target;
}
function defaultFetch(input, init) {
    if (typeof fetch !== 'function') {
        throw new Error('fetch is required');
    }
    return fetch(input, init);
}
function buildField(name, label, input) {
    const wrap = document.createElement('div');
    wrap.className = 'e9-person-field';
    const lab = document.createElement('label');
    lab.htmlFor = `e9-${name}`;
    lab.textContent = label;
    input.id = `e9-${name}`;
    if ('name' in input) input.name = name;
    wrap.append(lab, input);
    return wrap;
}
function createInput(name, type, attrs = {}) {
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    for (const [k, v] of Object.entries(attrs))input.setAttribute(k, v);
    return input;
}
function createSelect(name, options) {
    const select = document.createElement('select');
    select.name = name;
    for (const value of options){
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.append(opt);
    }
    return select;
}
export function createPersonForm(options = {}) {
    if (typeof document === 'undefined') {
        throw new Error('createPersonForm requires a DOM');
    }
    let form = resolveEl(options.form);
    let generated = false;
    if (!form) {
        generated = true;
        form = document.createElement('form');
        form.className = 'e9-person-form';
        const fields = options.fields ?? [
            'given_name',
            'family_name',
            'email',
            'email_type'
        ];
        for (const field of fields){
            if (field === 'given_name') {
                form.append(buildField(field, 'Given name', createInput(field, 'text', {
                    autocomplete: 'given-name',
                    required: 'true'
                })));
            } else if (field === 'family_name') {
                form.append(buildField(field, 'Family name', createInput(field, 'text', {
                    autocomplete: 'family-name'
                })));
            } else if (field === 'email') {
                form.append(buildField(field, 'Email', createInput(field, 'email', {
                    autocomplete: 'email',
                    required: 'true'
                })));
            } else if (field === 'email_type') {
                form.append(buildField(field, 'Email type', createSelect(field, EMAIL_TYPES)));
            } else if (field === 'phone') {
                form.append(buildField(field, 'Phone', createInput(field, 'tel', {
                    autocomplete: 'tel'
                })));
            } else if (field === 'phone_type') {
                form.append(buildField(field, 'Phone type', createSelect(field, PHONE_TYPES)));
            } else if (field === 'display_name') {
                form.append(buildField(field, 'Display name', createInput(field, 'text', {
                    autocomplete: 'nickname'
                })));
            }
        }
        const button = document.createElement('button');
        button.type = 'submit';
        button.textContent = 'Continue';
        form.append(button);
        const mount = resolveEl(options.mount) ?? document.body;
        mount.append(form);
    }
    const getPayload = ()=>{
        const payload = normalizePersonPayload(new FormData(form));
        if (options.source_code && !payload.source_code) {
            payload.source_code = options.source_code;
        }
        return payload;
    };
    const onSubmit = async (event)=>{
        event.preventDefault();
        const payload = getPayload();
        try {
            if (options.onSubmit) {
                await options.onSubmit(payload, event);
                return;
            }
            if (!options.endpoint) {
                throw new Error('createPersonForm requires endpoint or onSubmit');
            }
            const fetchImpl = options.fetchImpl ?? defaultFetch;
            const response = await fetchImpl(options.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers ?? {}
                },
                body: JSON.stringify({
                    people: [
                        payload
                    ]
                })
            });
            if (!response.ok) {
                throw new Error(`Person form submit failed (${response.status})`);
            }
            await options.onSuccess?.(response, payload);
        } catch (err) {
            await options.onError?.(err, payload);
            if (!options.onError) throw err;
        }
    };
    form.addEventListener('submit', onSubmit);
    return {
        form,
        getPayload,
        destroy: ()=>{
            form.removeEventListener('submit', onSubmit);
            if (generated) form.remove();
        }
    };
}


//# sourceURL=forms.ts