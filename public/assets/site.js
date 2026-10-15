/* xennialmemes.com browser code: mosaic layout, infinite scroll, login, favorites, comments. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const page = document.body.dataset.page;

  /* ---- Mosaic ----------------------------------------------------------
     Tiles are placed shortest-column-first so the grid stays balanced and
     tiles added by infinite scroll never reshuffle the ones above them. */

  const MIN_COLUMN = 230;

  function tileRatio(tile) {
    const img = tile.querySelector('img');
    const w = Number(img?.getAttribute('width')) || 1;
    const h = Number(img?.getAttribute('height')) || 1;
    return h / w;
  }

  function createMosaic(container) {
    const tiles = $$('.tile', container);
    let columns = [];
    let heights = [];

    function columnCount() {
      const width = container.clientWidth || window.innerWidth;
      return Math.max(2, Math.min(6, Math.floor(width / MIN_COLUMN)));
    }

    function place(tile) {
      let shortest = 0;
      for (let i = 1; i < heights.length; i++) if (heights[i] < heights[shortest] - 0.01) shortest = i;
      columns[shortest].appendChild(tile);
      heights[shortest] += tileRatio(tile) + 0.04;
    }

    function layout() {
      const count = columnCount();
      if (count === columns.length) return;
      container.classList.add('is-js');
      container.replaceChildren();
      columns = Array.from({ length: count }, () => {
        const col = document.createElement('div');
        col.className = 'mosaic-col';
        container.appendChild(col);
        return col;
      });
      heights = new Array(count).fill(0);
      tiles.forEach(place);
    }

    function add(newTiles) {
      newTiles.forEach((tile) => {
        tiles.push(tile);
        place(tile);
      });
    }

    function clear() {
      tiles.length = 0;
      columns = [];
      layout();
    }

    layout();
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(layout, 120);
    });
    return { add, clear };
  }

  function tilesFromHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return $$('.tile', tpl.content);
  }

  function infiniteScroll(container, mosaic) {
    const more = $('[data-load-more]');
    if (!more || !container.dataset.feed) return;
    let next = container.dataset.next;
    let loading = false;

    async function load() {
      if (loading || !next) return;
      loading = true;
      more.textContent = 'Loading…';
      try {
        const url = new URL(container.dataset.feed, location.origin);
        url.searchParams.set('before', next);
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        mosaic.add(tilesFromHtml(body.html));
        next = body.next ? String(body.next) : '';
      } catch {
        more.textContent = 'Couldn’t load more. Try again';
        loading = false;
        return;
      }
      loading = false;
      if (next) {
        more.textContent = 'Show more memes';
        more.href = `?before=${next}`;
      } else {
        more.closest('.more')?.remove();
        observer.disconnect();
      }
    }

    more.addEventListener('click', (event) => {
      event.preventDefault();
      load();
    });
    const observer = new IntersectionObserver((entries) => entries.some((x) => x.isIntersecting) && load(), {
      rootMargin: '1200px 0px'
    });
    observer.observe(more);
  }

  const mosaicEl = $('.mosaic[data-feed]');
  if (mosaicEl) infiniteScroll(mosaicEl, createMosaic(mosaicEl));
  // Other server-rendered grids (More like this) get the same balanced layout.
  $$('.mosaic:not([data-feed]):not([data-favorites-grid])').forEach((el) => el.children.length && createMosaic(el));

  /* ---- Topics filter ---------------------------------------------------- */

  const filter = $('[data-topic-filter]');
  if (filter) {
    const items = $$('[data-topic]');
    const groups = $$('.topic-group');
    const count = $('[data-topic-count]');
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      items.forEach((li) => {
        const hit = !q || li.dataset.topic.includes(q);
        li.hidden = !hit;
        if (hit) shown++;
      });
      groups.forEach((g) => (g.hidden = !g.querySelector('[data-topic]:not([hidden])')));
      count.textContent = q ? (shown ? `${shown} topic${shown === 1 ? '' : 's'}` : 'No topics match. Try a shorter word.') : '';
    });
  }

  /* ---- Accounts ----------------------------------------------------------
     @engine9/id logs the visitor in with delegate; engine9 core's
     /api/auth/login turns that into a session, which id.core.fetch sends
     with every /api/site call. */

  const cfg = window.XM || {};
  const state = { me: null, id: null, widget: null };

  function siteFetch(path, init) {
    return state.id.core.fetch(`/site${path}`, init);
  }

  async function refreshMe({ retryLogin = true } = {}) {
    if (!state.id || !state.id.getIdentity()) {
      state.me = null;
      return render();
    }
    let res = await siteFetch('/me');
    if (res.status === 401 && retryLogin) {
      // The Identity Token is still good but the core session lapsed: renew it.
      await state.id.core.login();
      res = await siteFetch('/me');
    }
    state.me = res.ok ? await res.json() : null;
    render();
  }

  function promptLogin() {
    if (state.widget?.open) state.widget.open();
    else $('[data-e9-login-widget] button, [data-e9-login-widget]')?.click();
  }

  function render() {
    const me = state.me;
    $$('.nav-favs').forEach((a) => (a.hidden = !me));
    if (page === 'post') renderPost(me);
    if (page === 'favorites') renderFavorites(me);
  }

  /* ---- Post page ---------------------------------------------------------- */

  const article = $('.post[data-post-id]');
  const postId = article ? Number(article.dataset.postId) : null;

  function renderPost(me) {
    const fav = $('[data-fav]');
    const on = !!me && me.favorites.includes(postId);
    fav.setAttribute('aria-pressed', String(on));
    $('[data-fav-label]').textContent = on ? 'Favorited' : 'Favorite';
    $('[data-comment-form]').hidden = !me;
    $('[data-comment-gate]').hidden = !!me;
    $('[data-handle]').textContent = me?.handle || 'you';
    $$('.admin-only').forEach((el) => (el.hidden = !me?.isAdmin));
    if (me) markComments();
    else $$('[data-delete-comment]').forEach((b) => (b.hidden = true));
  }

  async function markComments() {
    const res = await siteFetch(`/comments?post_id=${postId}`);
    if (!res.ok) return;
    const { comments } = await res.json();
    const mine = new Set(comments.filter((c) => c.mine).map((c) => String(c.id)));
    $$('.comment').forEach((li) => {
      const button = $('[data-delete-comment]', li);
      if (button) button.hidden = !(mine.has(li.dataset.commentId) || state.me?.isAdmin);
    });
  }

  function commentHtml(c) {
    const li = document.createElement('li');
    li.className = 'comment';
    li.dataset.commentId = c.id;
    const meta = document.createElement('p');
    meta.className = 'comment-meta';
    const who = document.createElement('strong');
    who.textContent = c.handle;
    const when = document.createElement('time');
    when.dateTime = c.created_at;
    when.textContent = 'just now';
    meta.append(who, ' ', when);
    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = c.body;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link-button';
    del.dataset.deleteComment = '';
    del.textContent = 'Delete';
    li.append(meta, body, del);
    return li;
  }

  function askForHandle() {
    const dialog = $('[data-handle-dialog]');
    const form = $('[data-handle-form]');
    const input = $('#handle-input');
    const msg = $('[data-handle-msg]');
    msg.textContent = '';
    const suggested = (state.id.getIdentity()?.fields?.display_name || '').split(/\s+/)[0] || '';
    input.value = suggested.replace(/[^A-Za-z0-9_]/g, '').slice(0, 24);
    dialog.showModal();
    input.focus();
    return new Promise((resolve) => {
      const done = (value) => {
        form.removeEventListener('submit', onSubmit);
        $('[data-handle-cancel]').removeEventListener('click', onCancel);
        dialog.close();
        resolve(value);
      };
      const onCancel = () => done(null);
      const onSubmit = async (event) => {
        event.preventDefault();
        const res = await siteFetch('/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle: input.value.trim() })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          msg.textContent = body.error || 'Could not save that handle.';
          return;
        }
        state.me.handle = body.handle;
        $('[data-handle]').textContent = body.handle;
        done(body.handle);
      };
      form.addEventListener('submit', onSubmit);
      $('[data-handle-cancel]').addEventListener('click', onCancel);
    });
  }

  if (article) {
    $('[data-fav]').addEventListener('click', async () => {
      if (!state.me) return promptLogin();
      const res = await siteFetch('/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: postId })
      });
      if (!res.ok) return;
      const { favorited, count } = await res.json();
      state.me.favorites = favorited
        ? [...state.me.favorites, postId]
        : state.me.favorites.filter((x) => x !== postId);
      $('[data-fav-count]').textContent = count;
      renderPost(state.me);
    });

    $('[data-share]').addEventListener('click', async (event) => {
      try {
        await navigator.clipboard.writeText(location.href.split('?')[0]);
        event.currentTarget.textContent = 'Link copied';
      } catch {
        event.currentTarget.textContent = 'Copy failed';
      }
    });

    $('[data-hide-post]')?.addEventListener('click', async (event) => {
      if (!confirm('Hide this meme from the site? You can bring it back from the admin API.')) return;
      const res = await siteFetch(`/admin/posts/${postId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'hidden' })
      });
      event.currentTarget.textContent = res.ok ? 'Hidden' : 'Could not hide';
    });

    $('[data-comment-form]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const msg = $('[data-comment-msg]');
      const textarea = form.elements.body;
      if (!state.me) return promptLogin();
      if (!state.me.handle && !(await askForHandle())) return;
      const button = form.querySelector('button[type=submit]');
      button.disabled = true;
      msg.textContent = '';
      try {
        const res = await siteFetch('/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ post_id: postId, body: textarea.value })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          msg.textContent = body.error || 'Could not post that comment.';
          return;
        }
        $('[data-no-comments]')?.remove();
        $('[data-comments]').appendChild(commentHtml(body.comment));
        textarea.value = '';
        msg.textContent = 'Posted.';
      } finally {
        button.disabled = false;
      }
    });

    $('[data-comments]').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-delete-comment]');
      if (!button) return;
      const li = button.closest('.comment');
      if (!confirm('Delete this comment?')) return;
      const res = await siteFetch(`/comments/${li.dataset.commentId}`, { method: 'DELETE' });
      if (res.ok) li.remove();
    });
  }

  /* ---- Favorites page ---------------------------------------------------- */

  let favMosaic = null;
  async function renderFavorites(me) {
    const msg = $('[data-favorites-msg]');
    const grid = $('[data-favorites-grid]');
    if (!me) {
      msg.hidden = false;
      msg.textContent = 'Log in to see the memes you’ve saved.';
      grid.hidden = true;
      return;
    }
    const res = await siteFetch('/favorites');
    const body = res.ok ? await res.json() : { html: '', count: 0 };
    if (!body.count) {
      msg.hidden = false;
      msg.textContent = 'Nothing saved yet. Open any meme and press Favorite to keep it here.';
      grid.hidden = true;
      return;
    }
    msg.hidden = true;
    grid.hidden = false;
    if (!favMosaic) favMosaic = createMosaic(grid);
    favMosaic.clear();
    favMosaic.add(tilesFromHtml(body.html));
  }

  /* ---- Start login ------------------------------------------------------- */

  if (!window.engine9Id || !cfg.publicKey) {
    // Login is unavailable (library blocked or site not set up yet). Browsing still works.
    $$('[data-comment-gate] p').forEach((p) => (p.textContent = 'Comments and favorites need login, which is not available right now.'));
    render();
    return;
  }

  state.id = window.engine9Id.mount({ core: { apiUrl: '/api', publicApiKey: cfg.publicKey } });
  state.widget = window.engine9Id.loginWidget({
    id: state.id,
    siteName: cfg.siteName,
    labels: { login: 'Log in' },
    async onLogin() {
      await state.id.core.login();
      await refreshMe({ retryLogin: false });
      return undefined; // let the widget show what delegate shared
    },
    onLogout() {
      state.me = null;
      render();
    }
  });
  Promise.resolve(state.id.ready)
    .then(() => refreshMe())
    .catch(() => render());
})();
