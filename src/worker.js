/*
  xennialmemes.com — one Cloudflare Worker for the whole site.

    /assets/*      static files from ./public (served by Workers Static Assets)
    /i/*           meme images from the MEDIA R2 bucket
    /api/site/*    favorites, comments, handles, feed, admin  (src/site/api.js)
    /api/*         engine9 core: people, login (/api/auth/*), health (/api/ok)
    everything else  server-rendered pages (src/site/routes.js)

  The cron trigger in wrangler.jsonc runs the Google Drive ingest.

  The engine9 part follows @engine9/core's cloudflare/worker.js: same
  PersonWorker, key store and createApi config. `npx e9core setup` fills in
  the D1 id, E9_ACCOUNT_ID and E9_PLUGIN_ID in wrangler.jsonc, and writes
  E9_PUBLIC_API_KEY, E9_ADMIN_API_KEY and SESSION_SECRET to .env.
*/
import PersonWorker from '@engine9/core/PersonWorker';
import pluginEntries, { packageVersions } from '@engine9/core/plugins/site';
import { createPluginRegistry } from '@engine9/core/pluginRegistry';
import { SqlApiKeyStore } from '@engine9/core/auth';
import { verifySessionToken } from '@engine9/core/auth/delegate';
import { BatchLogger, NullLogger, r2Sink } from '@engine9/core/logging';
import { createApi } from '@engine9/core/api';
import { PersonIdentifierDO } from '@engine9/core/id';
import { handleSite, notFound } from './site/routes.js';
import { runIngest } from './ingest/index.js';

export { PersonIdentifierDO };

const plugins = pluginEntries
  ? createPluginRegistry(pluginEntries, { packageVersions: packageVersions || {} })
  : null;

function engine9Api(env, ctx) {
  const worker = new PersonWorker({
    accountId: env.E9_ACCOUNT_ID || 'xennialmemes',
    d1: env.DB,
    personIds: env.PERSON_IDS,
    plugins
  });
  return createApi({
    worker,
    keyStore: new SqlApiKeyStore({ worker }),
    logger: env.LOG_BUCKET ? new BatchLogger({ sink: r2Sink(env.LOG_BUCKET) }) : new NullLogger(),
    delegate: env.SESSION_SECRET
      ? { sessionSecret: env.SESSION_SECRET, delegateUrl: env.DELEGATE_URL, domain: env.E9_DOMAIN }
      : null,
    config: {
      pluginId: env.E9_PLUGIN_ID,
      defaultRemoteInputId: 'website',
      upsertTables: ['person_name', 'person_email', 'person_phone', 'person_address', 'person_segment'],
      allowedOrigins: env.E9_ALLOWED_ORIGINS || ''
    }
  });
}

function deps(env) {
  return {
    verifySession: (token) => (env.SESSION_SECRET ? verifySessionToken(token, { secret: env.SESSION_SECRET }) : null),
    runIngest
  };
}

export default {
  async fetch(request, env, ctx) {
    const site = await handleSite(request, env, deps(env));
    if (site) return site;

    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return engine9Api(env, ctx).handleFetch(request, { basePath: '/api', ctx });
    }
    return notFound(env);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runIngest(env).then(
        (summary) => console.log('ingest', JSON.stringify(summary)),
        (err) => console.error('ingest failed', err?.message || err)
      )
    );
  }
};
