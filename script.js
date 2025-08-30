// Constantes y estado global
const LS_BACKGROUND = 'openmusic_background_v1';
// Helper: detectar versión móvil (breakpoint consistente con el CSS)
function isMobile() {
    try {
        const mq = window.matchMedia('(min-width:900px)');
        return !(mq && mq.matches);
    } catch(_) {
        // Fallback por si matchMedia no existe
        return (window.innerWidth || 0) < 900;
    }
}
// === ensureBGAutoplay: reintenta play() cuando la pantalla está apagada (sólo móvil + background) ===
function ensureBGAutoplay(maxMs = 20000){
    try{
        if (!(state && state.background && typeof isMobile === 'function' && isMobile())) return;
    }catch(e){ return; }
    const getEls = () => {
        try { return [activeEl(), inactiveEl()].filter(Boolean); } catch(_) { return []; }
    };
    if (!document.hidden) return; // Sólo aplica cuando la pantalla está apagada
    let elapsed = 0, done = false;
    let els = getEls();
    if (!els.length) return;
    const cleanup = () => {
        if (done) return;
        done = true;
        for (const el of els) {
            try{ el.removeEventListener('playing', onPlay); }catch(_){}
            try{ el.removeEventListener('timeupdate', onTU); }catch(_){}
        }
        if (iv) clearInterval(iv);
    };
    const onOK = () => { cleanup(); };
    const onPlay = () => onOK();
    const onTU = () => {
        for (const el of els) {
            if (!el.paused && el.currentTime > 0.15) { onOK(); return; }
        }
    };
    // Bind listeners and set tiny volume guard
    for (const el of els) {
        try{ el.addEventListener('playing', onPlay); }catch(_){}
        try{ el.addEventListener('timeupdate', onTU); }catch(_){}
        try{
            const volCtl = document.getElementById('volume');
            const vol = (volCtl && typeof volCtl.valueAsNumber==='number') ? volCtl.valueAsNumber : 1;
            el.volume = Math.max(0.001, Math.min(vol, vol));
            el.muted = false;
        }catch(_){}
    }
    const iv = setInterval(()=>{
        if (done) return;
        elapsed += 700;
        // Refresh elements in case swap happened
        els = getEls();
        for (const el of els) {
            try{ el.play().catch(()=>{}); }catch(_){}
        }
        if (elapsed >= maxMs){ cleanup(); }
    },700);
}

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const fmtTime = s => !isFinite(s) ? '0:00' : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const debounce = (fn, w = 500) => {
    let t;
    function d(...a) {
        clearTimeout(t);
        t = setTimeout(() => fn(...a), w);
    }
    d.flush = () => {
        clearTimeout(t);
        fn();
    };
    return d;
};
const toast = m => {
    const n = document.createElement('div');
    n.textContent = m;
    Object.assign(n.style, {
        position: 'fixed',
        bottom: '86px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#101018',
        color: '#e9f1ff',
        padding: '10px 14px',
        border: '1px solid rgba(255,255,255,.1)',
        borderRadius: '10px',
        zIndex: 9999
    });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1800);
};
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '');

/*
 * === Storage wrapper ===
 * Algunos navegadores o contextos (p. ej. Brave con ciertas políticas, iframes sin permisos o archivos abiertos via file://) pueden bloquear
 * el acceso a window.localStorage, lanzando un SecurityError. Para evitar errores en consola y mantener la funcionalidad de
 * persistencia, definimos un wrapper que detecta si localStorage está disponible. Si no lo está, se utiliza un almacenamiento
 * en memoria que expone las mismas funciones básicas (getItem, setItem, removeItem) y nunca arroja excepciones.
 */
const __hasLS = (() => {
    try {
        const __k = '__ls_test__' + Math.random().toString(36).slice(2);
        const ls = window.localStorage;
        ls.setItem(__k, '1');
        ls.removeItem(__k);
        return true;
    } catch (e) {
        return false;
    }
})();
const LS_FALLBACK = (() => {
    const mem = Object.create(null);
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; }
    };
})();
const LS_SAFE = (() => {
    if (__hasLS) {
        try {
            return window.localStorage;
        } catch (e) {
            return LS_FALLBACK;
        }
    }
    return LS_FALLBACK;
})();

// === Helpers de nombre seguro para pistas (playlists/visualización) ===
function getSafeName(t = {}) {

    try {
        // Primero intenta con name/title directos
        const nm = t && (t.name || t.title) ? String(t.name || t.title).trim() : '';
        if (nm && nm !== 'Pista sin nombre') return nm;

        // Si no hay nombre, intenta extraer del URL
        const u = t && (t.url || t.src) ? String(t.url || t.src) : '';
        if (u) {
            try {
                const filename = decodeURIComponent(u.split('/').pop().split('?')[0] || '');
                // Remueve extensión y caracteres especiales
                let base = filename.replace(/\.[a-z0-9]{2,5}$/i, '')
                                  .replace(/[_\-]+/g, ' ')
                                  .trim();
                
                // Remueve números iniciales seguidos de espacio o guión
                base = base.replace(/^\d+\s*[-_]?\s*/, '');
                
                // Capitaliza palabras
                base = base.replace(/\b\w/g, l => l.toUpperCase());
                
                if (base) return base;
            } catch(e) {
                console.warn('Error parsing filename from URL:', e);
            }
        }
    
} catch (e) {
    console.warn('getSafeName error:', e);
}
return 'Pista sin nombre';
}

function normalizeNameOnly(t = {}) {

    const safeName = getSafeName(t);
    return { 
        ...t, 
        name: safeName,
        // Asegura que siempre tenga un título también
        title: t.title || safeName
    };

};

// --- Fallback de ilustración (siempre hay algo que mostrar) ---
const NOTFOUND_IMG = 'https://archive.org/images/notfound.png';

function hashColor(str = '') {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    const r = (h >> 0) & 255, g = (h >> 8) & 255, b = (h >> 16) & 255;
    // Suavizamos colores para que nunca sean muy oscuros
    return `rgb(${(r % 128) + 64}, ${(g % 128) + 64}, ${(b % 128) + 64})`;
}

function makeCoverPlaceholder(text = 'Música') {
    const initials = (text || '')
        .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '♪';
    const bg = hashColor(text || '');
    const svg = `
<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='${bg}'/>
      <stop offset='1' stop-color='#101018'/>
    </linearGradient>
  </defs>
  <rect width='100%' height='100%' fill='url(#g)'/>
  <text x='50%' y='52%' dominant-baseline='middle' text-anchor='middle'
        font-family='system-ui,Segoe UI,Roboto,sans-serif' font-size='220'
        fill='rgba(255,255,255,.92)'>${initials}</text>
</svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg.trim());
}

function isWeakCover(url) {
    if (!url) return true;
    const u = String(url);
    return /Openverse_logo\.svg|images\/notfound\.png$/i.test(u);
}

function bestCoverOrPlaceholder(textForPh, ...urls) {
    for (const u of urls) {
        if (u && !isWeakCover(u)) return u;
    }
    return makeCoverPlaceholder(textForPh);
}

// Sello para refrescar imágenes del shelf (evitar caché móvil)
let __homeShelfStamp = Date.now();
function __stamp(u) { return u ? (u + (u.includes('?') ? '&' : '?') + 'v=' + __homeShelfStamp) : u; }

// === Home shelf: últimos álbumes de Alquimix (capa no intrusiva) ===
const ALQ_ACCOUNT = '@ignacio_carrizo664';
const ALQ_CREATOR = 'Alquimix';
let __homeShelfData = [];

async function fetchRecentFromAlquimix(limit = 12) {
    // Intento 1: por account (uploader)
    const url1 = `https://archive.org/advancedsearch.php?q=account:${encodeURIComponent(ALQ_ACCOUNT)}+AND+mediatype:audio&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=downloads&fl[]=publicdate&sort[]=publicdate+desc&rows=${limit}&page=1&output=json`;
    // Intento 2: por creator como respaldo
    const url2 = `https://archive.org/advancedsearch.php?q=creator:%22${encodeURIComponent(ALQ_CREATOR)}%22+AND+mediatype:audio&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=downloads&fl[]=publicdate&sort[]=publicdate+desc&rows=${limit}&page=1&output=json`;
    try {
        const res1 = await fetch(url1, { mode: 'cors' }).then(r => r.json()).catch(()=>null);
        const docs = (res1 && res1.response && res1.response.docs) ? res1.response.docs : null;
        if (docs && docs.length) return docs;
        const res2 = await fetch(url2, { mode: 'cors' }).then(r => r.json()).catch(()=>null);
        return (res2 && res2.response && res2.response.docs) ? res2.response.docs : [];
    } catch(e) {
        console.warn('HomeShelf fetch failed:', e);
        return [];
    }
}

function toAlbumFromDoc(doc) {
    const id = doc.identifier;
    const title = doc.title || 'Sin título';
    const artist = doc.creator || '—';
    const cover = `https://archive.org/services/img/${encodeURIComponent(id)}`;
    const year = (doc.publicdate||'').slice(0,4) || '';
    const downloads = doc.downloads || 0;
    return {
        id: 'ia:' + id,
        provider: 'archive',
        identifier: id,
        title,
        artist,
        cover: `https://archive.org/download/${id}/__ia_thumb.jpg`,
        year,
        downloads,
        link: `https://archive.org/details/${id}`
    };
}

function renderHomeShelf(albums) {
    const shelf = document.getElementById('homeShelf');
    const grid = document.getElementById('homeGrid');
    if (!shelf || !grid) return;
    grid.innerHTML = '';
    shelf.style.display = '';
    if (!albums || !albums.length) {
        grid.innerHTML = '<div class="home-empty">Cargando recomendaciones…</div>';
        return;
    }
    albums.forEach((alb, idx) => {
        const el = document.createElement('div');
        el.className = 'home-card';
        el.innerHTML = `
            <img class="cover" loading="lazy" src="${bestCoverOrPlaceholder(`${alb.artist||''} ${alb.title||''}`.trim(), alb.cover)}" alt="cover" onerror="this.src='${makeCoverPlaceholder(`${alb.artist||''} ${alb.title||''}`.trim())}'" />
            <div class="home-meta">
              <div class="home-title" title="${alb.title}">${alb.title}</div>
              <div class="home-sub">${alb.artist || ''}${alb.year ? ' · ' + alb.year : ''}</div>
            </div>`;
            /* stamp cover */
    const _img = el.querySelector('img.cover');
    if (_img) {
        _img.src = __stamp(_img.getAttribute('src'));
        _img.loading = 'eager';
        _img.decoding = 'async';
        try { _img.fetchPriority = 'high'; } catch(_) {}
    }
    el.addEventListener('click', () => {
            // No alterar el buscador: solo seleccionar este álbum y preparar continuidad
            try {
                // preparar cola de continuidad con el resto del shelf
                state.nextAlbums = albums.filter((_,i)=>i>idx).concat(albums.filter((_,i)=>i<idx));
            } catch(e){}
            const __s=document.getElementById('homeShelf'); if (__s) __s.style.display='none';
            selectAlbum(alb);
        }, { passive: true });
        grid.appendChild(el);
    });
}

async function loadHomeShelfOnce() {
    try {
        const docs = await fetchRecentFromAlquimix(12);
        const albumsRaw = docs.map(toAlbumFromDoc);
        const albums = (typeof validateAlbumsForHome === 'function')
            ? await validateAlbumsForHome(albumsRaw)
            : albumsRaw;
        __homeShelfData = albums;
        renderHomeShelf(albums);
    } catch (e) {
        console.warn('loadHomeShelfOnce error:', e);
    }
}

// Actualización periódica (ligera, no intrusiva)
let __homeRefreshIv = null;
function startHomeShelfAutoRefresh() {
    if (__homeRefreshIv) return;
    __homeRefreshIv = setInterval(async () => {
        if (document.hidden) return;
        try {
            const docs = await fetchRecentFromAlquimix(12);
            const albumsRaw = docs.map(toAlbumFromDoc);
            const albums = (typeof validateAlbumsForHome === 'function')
                ? await validateAlbumsForHome(albumsRaw)
                : albumsRaw;
            const prev = (__homeShelfData||[]).map(a=>a.id).join(',');
            const now  = (albums||[]).map(a=>a.id).join(',');
            if (prev !== now) {
                __homeShelfData = albums;
                __homeShelfStamp = Date.now();
            renderHomeShelf(albums);
            }
        } catch(e) {}
    }, 15 * 60 * 1000);
}

// Botón refrescar manual
document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t && t.id === 'homeRefresh') {
        
        try {
            const old = t.textContent;
            t.disabled = true;
            t.setAttribute('aria-busy','true');
            t.textContent = 'Actualizando…';
            __homeShelfStamp = Date.now();
            await loadHomeShelfOnce();
        } finally {
            t.disabled = false;
            t.removeAttribute('aria-busy');
            t.textContent = old;
        }
    }
});

// Integración no invasiva en el arranque
window.addEventListener('load', () => {
    // Mostrar shelf solo si no hay resultados aún en #albums y no hay selección
    const albumsWrap = document.getElementById('albums');
    const content = document.getElementById('content');
    const empty = document.getElementById('albums-empty');
    if (albumsWrap && content && empty && (!albumsWrap.children.length)) {
        loadHomeShelfOnce();
        startHomeShelfAutoRefresh();
    }
}, { once: true });
// === Fin Home shelf ===

// --- fin fallback ilustración ---
const PLAY_WATCHDOG = 5000;
const LS_PLAYLISTS = 'openmusic_playlists_v1';
const PRIORITY_UPLOADER = 'Alquimix OR \"ignacio carrizo\" OR ignacio_carrizo664 OR @ignacio_carrizo664' ;
const PRIORITY_ACCOUNT = '@ignacio_carrizo664';
const SEARCH_CACHE = new Map();

const state = {
    artist: null,
    albums: [],
    view: 'album',
    currentAlbum: null,
    currentPlaylist: null,
    tracks: [],
    idx: -1,
    contextIdx: -1,
    a1: new Audio(),
    a2: new Audio(),
    nextTrackBuffer: new Audio(),
    useA: true,
    crossfade: false,
    shuffle: false,
    repeatOne: false,
    background: true,
    _userPaused: false,
    providers: { archive: true },
    nextAlbums: [],
    searchCache: SEARCH_CACHE,
    preloadIndex: -1,
    // --- Background handoff (móvil, pantalla apagada) ---
    _handoffPrimed: false,
    _handoffTargetIdx: -1,
    _handoffAlbumId: null
};

// Cargar preferencia de reproducción en segundo plano de forma segura
try {
    const bgSetting = LS_SAFE.getItem(LS_BACKGROUND);
    if (bgSetting !== null) state.background = JSON.parse(bgSetting);
} catch (e) {
    console.warn('Error loading background play setting:', e);
}

// Configuración inicial de audio
[state.a1, state.a2, state.nextTrackBuffer].forEach(a => {
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    a.volume = 1;
    try { a.setAttribute('playsinline',''); } catch(e){}
});

/* === Global reset helpers === */
function resetPreloadBuffer(){
    try {
        if (state.nextTrackBuffer && state.nextTrackBuffer.src) {
            state.nextTrackBuffer.src = '';
            state.nextTrackBuffer.removeAttribute('src');
            state.nextTrackBuffer.load && state.nextTrackBuffer.load();
        }
    } catch(e){}
    state.preloadIndex = -1;
}

function resetPlaybackContext(){
    try { state.a1 && state.a1.pause && state.a1.pause(); } catch(e){}
    try { state.a2 && state.a2.pause && state.a2.pause(); } catch(e){}
    try {
        [state.a1, state.a2].forEach(a => {
            if (!a) return;
            a.src = '';
            a.load && a.load();
            a.volume = (document.getElementById('volume')?.valueAsNumber) || 1;
            a.muted = false;
        });
    } catch(e){}
    state.useA = true;
    resetPreloadBuffer();
}
/* === end Global reset helpers === */

// === Helper: próximo álbum para reproducción automática (móvil + pantalla apagada) ===
function __getNextAlbumForAuto(){
    try {
        if (state.nextAlbums && state.nextAlbums.length > 0) {
            return state.nextAlbums[0];
        }
        if (Array.isArray(state.albums) && state.albums.length > 0 && state.currentAlbum) {
            const all = state.albums;
            const currIdx = all.findIndex(a => a && a.id === state.currentAlbum.id);
            if (currIdx !== -1) {
                const nextAlbum = all.slice(currIdx + 1).find(a => a && a.id !== state.currentAlbum.id);
                return nextAlbum || null;
            }
        }
    } catch(e){}
    return null;
}
// === Helper: próximo playlist para reproducción automática (móvil + pantalla apagada) ===
function __getNextPlaylistForAuto(){
    try {
        const pls = loadPlaylists && loadPlaylists();
        if (!Array.isArray(pls) || !pls.length || !state.currentPlaylist) return null;
        const currIdx = pls.findIndex(p => p && p.id === state.currentPlaylist.id);
        if (currIdx === -1) return null;
        // buscar siguiente playlist no vacía
        for (let j = currIdx + 1; j < pls.length; j++){
            const p = pls[j];
            if (p && Array.isArray(p.tracks) && p.tracks.length) return p;
        }
        return null;
    } catch(e){ return null; }
}


// --- Context reset that keeps current playback running ---
function resetContextKeepPlaying(){
    try {
        // Clear only the INACTIVE element (avoid stopping current music)
        const other = inactiveEl && inactiveEl();
        if (other) {
            try { other.pause && other.pause(); } catch(e){}
            try { other.src = ''; other.load && other.load(); } catch(e){}
            try { other.muted = false; other.volume = (document.getElementById('volume')?.valueAsNumber) || 1; } catch(e){}
        }
    } catch(e){}
    // Always drop any stale preloaded buffer
    try {
        if (state.nextTrackBuffer && state.nextTrackBuffer.src) {
            state.nextTrackBuffer.src = '';
            state.nextTrackBuffer.removeAttribute('src');
            state.nextTrackBuffer.load && state.nextTrackBuffer.load();
        }
    } catch(e){}
    state.preloadIndex = -1;
}

// Función para precargar la siguiente pista
function preloadNextTrack(url, idx) {
    if (!url || state.preloadIndex === idx) return;
    
    if (state.nextTrackBuffer.src) {
        state.nextTrackBuffer.src = '';
        state.nextTrackBuffer.removeAttribute('src');
        state.nextTrackBuffer.load();
    }
    
    
try {
        state.nextTrackBuffer.src = url;
        state.nextTrackBuffer.load();
        state.preloadIndex = idx;
    } catch (e) {
        console.warn('Error precargando pista:', e);
        state.preloadIndex = -1;
    }
}

// Helpers para inicio robusto de reproducción
function waitForPlaying(el, timeoutMs) {
    return new Promise((resolve, reject) => {
        let done = false;
        const cleanup = () => {
            el.removeEventListener('playing', onPlay);
            el.removeEventListener('timeupdate', onTU);
            el.removeEventListener('error', onErr);
            if (t) clearTimeout(t);
        };
        const onPlay = () => { if (done) return; done = true; cleanup(); resolve('ok'); };
        const onTU = () => {
            if (!done && !el.paused && el.currentTime > 0.15) {
                done = true; cleanup(); resolve('ok');
            }
        };
        const onErr = (e) => { if (done) return; done = true; cleanup(); reject(e); };
        el.addEventListener('playing', onPlay, { once: true });
        el.addEventListener('timeupdate', onTU);
        el.addEventListener('error', onErr, { once: true });
        const t = setTimeout(() => {
            if (done) return;
            done = true; cleanup();
            if (document.hidden) resolve('deferred'); else reject(new Error('start-timeout'));
        }, Math.max(2000, timeoutMs|0));
    });
}

async function attemptStart(el, idx) {
    try {
        await el.play();
    } catch (e) {
        if (document.hidden) {
            state.handoff = { idx };
            document.addEventListener('visibilitychange', function onVis() {
                if (!document.hidden) {
                    document.removeEventListener('visibilitychange', onVis);
                    try { playIndex(idx); } catch(e){}
                }
            });
            return 'deferred';
        }
        throw e;
    }
    const res = await waitForPlaying(el, document.hidden ? 20000 : 8000).catch(err => {
        if (document.hidden) return 'deferred';
        throw err;
    });
    if (res === 'deferred') {
        state.handoff = { idx };
        document.addEventListener('visibilitychange', function onVis() {
            if (!document.hidden) {
                document.removeEventListener('visibilitychange', onVis);
                try { playIndex(idx); } catch(e){}
            }
        });
        return 'deferred';
    }
    return 'ok';
}

// Ajustes de tamaño del reproductor
function updatePlayerPadding() {
    const ph = Math.max(100, $('#player')?.offsetHeight || 0);
    document.documentElement.style.setProperty('--player-h', ph + 'px');
}

window.addEventListener('load', updatePlayerPadding);
window.addEventListener('resize', updatePlayerPadding);
window.addEventListener('orientationchange', updatePlayerPadding);

// Reproductor
function activeEl() {
    return state.useA ? state.a1 : state.a2;
}

function inactiveEl() {
    return state.useA ? state.a2 : state.a1;
}

function setUIPlaying() {
    const t = state.tracks[state.idx];
    if (!t) return;
    
    $('#player').style.display = '';
    $('#p-title').textContent = t.name;
    $('#p-artist').textContent = (state.view === 'playlist' ? 
        `Playlist · ${state.currentPlaylist?.name || ''}` : 
        (state.currentAlbum?.artist ? 
            `${state.currentAlbum.artist} · ${state.currentAlbum.title || ''}` : 
            (state.currentAlbum?.title || '')));
    
    const cover = t.cover || $('.hero-cover')?.src || state.currentAlbum?.cover || 'https://archive.org/images/notfound.png';
    $('#p-cover').src = cover;
    $('#mini-cover') && ($('#mini-cover').src = cover);
    $('#mini-title') && ($('#mini-title').textContent = t.name);
    $('#mini-artist') && ($('#mini-artist').textContent = $('#p-artist').textContent);
    $('#play').textContent = activeEl().paused ? '▶' : '⏸';
    $('#mini-play') && ($('#mini-play').textContent = activeEl().paused ? '▶' : '⏸');
    
    $$('.track-row').forEach((r, i) => {
        r.classList.toggle('active', i === state.idx);
        if (i === state.idx) {
            r.style.boxShadow = '0 0 15px rgba(0, 211, 255, 0.5)';
        } else {
            r.style.boxShadow = '';
        }
    });
    
    updatePlayerPadding();
}

// === Pre-arranque: prepara el primer tema del próximo álbum justo antes de que termine el actual (móvil + pantalla apagada) ===
async function maybePrimeHiddenHandoff(el){
    try{
        if (!state.background) return;
        if (typeof isMobile === 'function' ? !isMobile() : (window.innerWidth||0) >= 900) return;
        if (!document.hidden) return; // sólo cuando la pantalla está apagada
        if (state.crossfade) return;  // si hay crossfade, el flujo normal ya hace el swap
        if (!state.tracks || state.tracks.length === 0) return;
        if (state._handoffPrimed) return;
        const d = el.duration || 0;
        if (!d) return;
        const remaining = d - (el.currentTime || 0);
        if (remaining > 2.5) return; // ventana de ~450ms antes del final

        // === NUEVO: pre-primeo del SIGUIENTE TEMA dentro de la misma lista (playlist/álbum) ===
        try{
            if (state.idx < state.tracks.length - 1) {
                const nextIdx = state.idx + 1;
                if (state._handoffTargetIdx === nextIdx) return;
                const nextTrack = state.tracks[nextIdx];
                if (nextTrack && nextTrack.url) {
                    const nxt = inactiveEl();
                    if (nxt) {
                        const volCtl = document.getElementById('volume');
                        const vol = (volCtl && typeof volCtl.valueAsNumber==='number') ? volCtl.valueAsNumber : 1;
                        nxt.src = nextTrack.url;
                        nxt.muted = false;
                        nxt.volume = Math.max(0.001, Math.min(vol, vol)) * 0.001; // ultrabajo para evitar bloqueos de autoplay
                        const st = await attemptStart(nxt, nextIdx);
                        // Marca priming y arranca watchdog; si quedó diferido, igualmente dejamos target preparado
                        if (st === 'ok') {
                            startWatchdogFor(nxt, nextIdx);
                            try{ ensureBGAutoplay(20000); }catch(_){ }
                            state._handoffPrimed = true;
                        } else {
                            state._handoffPrimed = true; // diferido: onended hará el swap y playIndex consolidará
                        }
                        state._handoffTargetIdx = nextIdx;
                        state._handoffAlbumId = (state.view === 'playlist' && state.currentPlaylist) ? state.currentPlaylist.id : (state.currentAlbum ? state.currentAlbum.id : null);
                        return;
                    }
                }
            }
        }catch(_){}
// --- Playlist handoff (igual que álbum) ---
        if (state.view === 'playlist') {
            const nxtPl = __getNextPlaylistForAuto();
            if (!nxtPl) return;
            state._handoffPrimed = true;
            try{
                await openPlaylist(nxtPl.id);
                const first = state.tracks && state.tracks[0];
                if (!first || !first.url) { state._handoffPrimed = false; return; }
                const nxt = inactiveEl();
                if (!nxt) { state._handoffPrimed = false; return; }
                const volCtl = document.getElementById('volume');
                const vol = (volCtl && typeof volCtl.valueAsNumber==='number') ? volCtl.valueAsNumber : 1;
                nxt.src = first.url;
                nxt.muted = false;
                nxt.volume = Math.max(0.001, Math.min(vol, vol)) * 0.001;
                const st = await attemptStart(nxt, 0);
                if (st !== 'ok') {
                    state._handoffTargetIdx = 0;
                    state._handoffAlbumId = state.currentPlaylist ? state.currentPlaylist.id : null;
                    return;
                }
                startWatchdogFor(nxt, 0);
                try{ ensureBGAutoplay(20000); }catch(_){ }
                state._handoffTargetIdx = 0;
                state._handoffAlbumId = state.currentPlaylist ? state.currentPlaylist.id : null;
            }catch(e){
                state._handoffPrimed = false;
                state._handoffTargetIdx = -1;
                state._handoffAlbumId = null;
            }
            return;
        }
        const nxtAlbum = __getNextAlbumForAuto();
        if (!nxtAlbum) return;

        state._handoffPrimed = true;
        try{
            // Carga del próximo álbum (no invasiva: inevitable cambio de UI, pero ocurre con pantalla apagada)
            await selectAlbum(nxtAlbum);
            const first = state.tracks && state.tracks[0];
            if (!first || !first.url) { state._handoffPrimed = false; return; }

            const nxt = inactiveEl();
            if (!nxt) { state._handoffPrimed = false; return; }

            // Volumen mínimo audible para evitar bloqueos de autoplay
            const volCtl = document.getElementById('volume');
            const vol = (volCtl && typeof volCtl.valueAsNumber==='number') ? volCtl.valueAsNumber : 1;
            nxt.src = first.url;
            nxt.muted = false;
            nxt.volume = Math.max(0.001, Math.min(vol, vol)) * 0.001; // ultrabajo

            const st = await attemptStart(nxt, 0);
            if (st !== 'ok') {
                // Si el inicio quedó diferido, mantén la primed flag y deja que playIndex reintente.
                state._handoffTargetIdx = 0;
                state._handoffAlbumId = state.currentAlbum ? state.currentAlbum.id : null;
                return;
}
            startWatchdogFor(nxt, 0);
            try{ ensureBGAutoplay(20000); }catch(_){ }
            state._handoffTargetIdx = 0;
            state._handoffAlbumId = state.currentAlbum ? state.currentAlbum.id : null;
        }catch(e){
            // Falla silenciosa: volver al comportamiento estándar
            state._handoffPrimed = false;
            state._handoffTargetIdx = -1;
            state._handoffAlbumId = null;
        }
    }catch(e){ /* no-op */ }
}

function attachTimeUpdates(a) {
    a.ontimeupdate = () => {
        try{ maybePrimeHiddenHandoff(a); }catch(_){}

        const d = a.duration || 0;
        $('#cur').textContent = fmtTime(a.currentTime);
        $('#dur').textContent = fmtTime(d);
        const p = (a.currentTime / (d || 1)) * 100;
        $('#fill').style.width = p + '%';
        $('#bar').setAttribute('aria-valuenow', String(Math.floor(p)));
    };
    
    a.onended = () => {
        onTrackEnded(a);
};

    a.addEventListener('playing', async () => {
        try {
            setUIPlaying();
        } catch (e) {
            console.warn('setUIPlaying() no disponible:', e);
        }
    });
}

function onTrackEnded(a){
    try{
        if (state.repeatOne) {
            a.currentTime = 0;
            a.play().catch(() => {});
            return;
        }
        // Si primamos un handoff, y el elemento inactivo ya está reproduciendo el primer tema del próximo álbum,
        // hacemos el swap sin pasar por playNext() (evita bloqueo por falta de gesto)
        try{
            const nxt = inactiveEl();
            if (state._handoffPrimed && nxt && !nxt.paused) {
                const volCtl = document.getElementById('volume');
                const vol = (volCtl && typeof volCtl.valueAsNumber==='number') ? volCtl.valueAsNumber : 1;
                try { nxt.volume = vol; } catch(e){}
                state.useA = !state.useA;
                state._handoffPrimed = false;
                setUIPlaying();
                try { if (typeof state._handoffTargetIdx === 'number' && state._handoffTargetIdx >= 0) { state.idx = state._handoffTargetIdx; updateMediaMetadata && updateMediaMetadata(state.tracks[state.idx]); } } catch(_){ }
                return;
            }
        }catch(e){}
        // Fallback estándar
        playNext();
    }catch(e){
        // Fallback duro
        try{ playNext(); }catch(_){}
    }
}

[state.a1, state.a2].forEach(attachTimeUpdates);

function startWatchdogFor(el, idx) {
    const token = Symbol('wd');
    state._wdToken = token;
    let last = el.currentTime;
    let cleared = false;
    
    const clear = () => {
        if (cleared) return;
        cleared = true;
        if (state._wdToken === token) state._wdToken = null;
        el.removeEventListener('playing', onPlay);
        el.removeEventListener('timeupdate', onTU);
        el.removeEventListener('error', onErr);
        clearInterval(iv);
    };
    
    const onPlay = () => clear();
    const onTU = () => {
        if (!el.paused && el.currentTime > last + .2) {
            clear();
        }
        last = el.currentTime;
    };
    const onErr = () => {
        clear();
        if (state.tracks && state.tracks[idx]) state.tracks[idx].__blocked = true;
        toast('Pista con error. Siguiente…');
        playNext();
    };
    
    el.addEventListener('playing', onPlay);
    el.addEventListener('timeupdate', onTU);
    el.addEventListener('error', onErr, { once: true });
    
    const iv = setInterval(() => {}, 1000);
    setTimeout(() => {
        if (!cleared) {
            clear();
            if (state.tracks && state.tracks[idx]) state.tracks[idx].__blocked = true;
            toast('Pista no disponible. Siguiente…');
            playNext();
        }
    }, PLAY_WATCHDOG);
}

async function playWithCrossfade(url, idx) {
    const cur = activeEl();
    const nxt = inactiveEl();

    // Use preloaded buffer if valid
    preloadNextTrack(state.tracks[idx + 1]?.url, idx + 1);
    if (state.preloadIndex === idx && state.nextTrackBuffer.src) {
        nxt.src = state.nextTrackBuffer.src;
    } else {
        nxt.src = url;
    }

    // Volume settings
    const volVal = (document.getElementById('volume')?.valueAsNumber) ||
                   (document.getElementById('volume_c')?.valueAsNumber) ||
                   (document.getElementById('miniVolume')?.valueAsNumber) || 1;

    // Prepare next
    nxt.muted = false;
    nxt.volume = Math.max(0.001, Math.min(0.001, volVal)); // tiny but audible to avoid autoplay quirks

    try {
        const st = await attemptStart(nxt, idx);
        if (st !== 'ok') return;
        startWatchdogFor(nxt, idx);

        // Update metadata early for background controls
        try { if (state.background) updateMediaMetadata(state.tracks[idx]); } catch(e){}

        // Time-based fade for smoothness
        const dur = (typeof isMobile === 'function' && isMobile()) ? 150 : 700; // ms (shorter on mobile)
        const t0 = performance.now();
        const curStart = Math.max(0, Math.min(1, cur.volume || volVal));
        const step = (now) => {
            // If crossfade got turned off mid-flight, end immediately
            if (!state.crossfade) {
                nxt.volume = volVal;
                cur.volume = 0;
                finalize();
                return;
            }
            const frac = Math.min(1, (now - t0) / dur);
            nxt.volume = Math.max(0, Math.min(volVal, volVal * frac));
            cur.volume = Math.max(0, Math.min(curStart, curStart * (1 - frac)));

            if (frac < 1) {
                requestAnimationFrame(step);
            } else {
                finalize();
            }
        };

        function finalize() {
            try { cur.pause(); } catch(e) {}
            try { cur.src = ''; cur.load && cur.load(); } catch(e) {}
            try { cur.volume = volVal; } catch(e) {}

            // Ensure next ends at desired volume
            try { nxt.volume = volVal; } catch(e) {}

            // Swap buffers
            state.useA = !state.useA;
            setUIPlaying();
        }

        requestAnimationFrame(step);
    } catch (e) {
        const _msg = (e && (e.message || e.name)) ? String(e.message || e.name) : '';
        // AbortError provocado por pausas intermedias es benigno: no bloquear ni avanzar
        if (e && (e.name === 'AbortError' || /interrupted.*play\(\)/i.test(_msg))) {
            console.warn('Crossfade abort (ignorado):', e);
            return;
        }
        console.error('Error en crossfade:', e);
        if (state.tracks && state.tracks[idx]) state.tracks[idx].__blocked = true;
        toast('Pista con error. Siguiente…');
        playNext();
    }
}

async function playDirect(url, idx) {
    const el = activeEl();
    
    if (state.preloadIndex === idx && state.nextTrackBuffer.src) {
        el.src = state.nextTrackBuffer.src;
    } else {
        el.src = url;
    }
    
    el.muted = false;
    el.volume = $('#volume')?.valueAsNumber || 1;
    
    preloadNextTrack(state.tracks[idx + 1]?.url, idx + 1);
    
    try {
        const __st = await attemptStart(el, idx);
        if (__st !== 'ok') return;
        startWatchdogFor(el, idx);
    } catch (e) {
        console.error('Error en reproducción directa:', e);
        if (state.tracks && state.tracks[idx]) state.tracks[idx].__blocked = true;
        toast('Pista con error. Siguiente…');
        playNext();
    }
}

async function playIndex(i) {
    if (!state.tracks.length) return;
    
    state.idx = i;
    const t = state.tracks[i];
    
    try {
        const target = (state.crossfade && !activeEl().paused) ? inactiveEl() : activeEl();
        setUIPlaying();
        
        if (state.crossfade && !activeEl().paused) {
            await playWithCrossfade(t.url, i);
        } else {
            await playDirect(t.url, i);
        }
    
        try{ ensureBGAutoplay(20000); }catch(_){}} catch (e) {
        const _msg = (e && (e.message || e.name)) ? String(e.message || e.name) : '';
        if (e && (e.name === 'AbortError' || /interrupted.*play\(\)/i.test(_msg))) {
            console.warn('playIndex abort (ignorado):', e);
            return;
        }
        console.error('Error en playIndex:', e);
        if (state.tracks && state.tracks[i]) state.tracks[i].__blocked = true;
        toast('Pista con error. Siguiente…');
        playNext();
    }
}

function pickRandomNext() {
    if (state.tracks.length <= 1) return state.idx;
    
    const available = state.tracks
        .map((_, i) => i)
        .filter(j => j !== state.idx && !state.tracks[j].__blocked);
    
    return available.length ? 
        available[Math.floor(Math.random() * available.length)] : 
        state.idx;
}

function playNext() {
    if (!state.tracks.length) return;

    
    // Si estamos en la última pista de la playlist
    if (state.view === 'playlist' && state.idx >= state.tracks.length - 1) {
        // Intentar avanzar a la siguiente playlist en móvil + segundo plano
        try {
            const pls = (typeof loadPlaylists==='function') ? loadPlaylists() : [];
            if (state.background && typeof isMobile==='function' && isMobile() && Array.isArray(pls) && pls.length && state.currentPlaylist){
                const currIdx = pls.findIndex(p => p && p.id === state.currentPlaylist.id);
                if (currIdx !== -1){
                    const nextPl = pls.slice(currIdx + 1).find(p => p && Array.isArray(p.tracks) && p.tracks.length);
                    if (nextPl){
                        openPlaylist(nextPl.id);
                        playIndex(0);
                        try{ ensureBGAutoplay(20000); }catch(_){}
                        return;
                    }
                }
            }
        } catch(e){}
        const el = activeEl();
        if (el && !el.paused) el.pause();
        return;
    }
// Si estamos en la última pista del álbum
    if (state.idx >= state.tracks.length - 1) {
        // Si hay álbumes siguientes en la cola, avanza al siguiente álbum
        if (state.nextAlbums && state.nextAlbums.length > 0) {
            const nextAlbum = state.nextAlbums.shift();
            selectAlbum(nextAlbum).then(() => { playIndex(0); try{ ensureBGAutoplay(20000); }catch(_){} });
        } else {
            // Fallback móvil con reproducción en segundo plano: continuar con el siguiente álbum de la lista de búsqueda
            if (state.background && typeof isMobile === 'function' && isMobile() && Array.isArray(state.albums) && state.albums.length > 0 && state.currentAlbum) {
                const all = state.albums;
                const currIdx = all.findIndex(a => a && a.id === state.currentAlbum.id);
                if (currIdx !== -1) {
                    // Construir lista circular a partir del siguiente
                    // (sin repetir) avanzar linealmente, sin wrap
                    // const circular = all.slice(currIdx + 1).concat(all.slice(0, currIdx));
                    const nextAlbum = all.slice(currIdx + 1).find(a => a && a.id !== state.currentAlbum.id);
                    if (nextAlbum) {
                        try { state.nextAlbums = all.slice(currIdx + 2); } catch(_) {}
                        selectAlbum(nextAlbum).then(() => { playIndex(0); try{ ensureBGAutoplay(20000); }catch(_){} });
                        return;
                    }
                }
            }
            // Si no aplica el fallback, detiene la reproducción (no repite el álbum)
            const el = activeEl();
            if (el && !el.paused) el.pause();
        }
        return;
    }

    // Reproducción aleatoria
    if (state.shuffle) {
        const n = pickRandomNext();
        playIndex(n);
        return;
    }

    // Reproducción secuencial sin repetición: busca la siguiente pista no bloqueada
    let n = state.idx + 1;
    while (n < state.tracks.length && state.tracks[n]?.__blocked) {
        n++;
    }
    if (n < state.tracks.length && !state.tracks[n]?.__blocked) {
        playIndex(n);
    } else {
        // Si no hay más pistas en el álbum, detiene la reproducción (la transición de álbum ya se maneja arriba)
        const el = activeEl();
        if (el && !el.paused) el.pause();
    }
}

function playPrev() {
    if (!state.tracks.length) return;
    
    let p = (state.idx - 1 + state.tracks.length) % state.tracks.length;
    let k = 0;
    
    while (state.tracks[p]?.__blocked && k < state.tracks.length) {
        p = (p - 1 + state.tracks.length) % state.tracks.length;
        k++;
    }
    
    if (!state.tracks[p]?.__blocked) {
        playIndex(p);
    }
}

// Sheets y overlay
const overlay = $('#overlay');

function openSheet(el){ if(!el) return; el.style.display='block'; overlay && (overlay.style.display='block'); }

function closeSheet(el){ if(!el) return; el.style.display='none'; overlay && (overlay.style.display='none'); }

$('#filtersBtn')?.addEventListener('click', () => { const el=$('#filtersSheet'); el && openSheet(el); });
$('#filtersClose')?.addEventListener('click', () => { const el=$('#filtersSheet'); el && closeSheet(el); });
$('#moreBtn')?.addEventListener('click', () => { const el=$('#ctrlSheet'); el && openSheet(el); });
$('#ctrlClose')?.addEventListener('click', () => { const el=$('#ctrlSheet'); el && closeSheet(el); });
$('#trackClose')?.addEventListener('click', () => { const el=$('#trackSheet'); el && closeSheet(el); });
overlay.addEventListener('click', () => { ['filtersSheet','ctrlSheet','trackSheet'].forEach(id => { const el = $('#' + id); if (el) el.style.display = 'none'; }); overlay.style.display = 'none'; });

// Sidebar móvil
const sidebar = $('#sidebar');
const menuBtn = $('#menu');
function setSidebar(open){
  if (!sidebar || !overlay || !menuBtn) return;
  sidebar.classList.toggle('open', !!open);
  overlay.style.display = open ? 'block' : 'none';
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (!open && typeof menuBtn.focus === 'function') {
    setTimeout(()=>{ try{menuBtn.focus();}catch(e){} },0);
  }
}

function isSidebarOpen(){ return !!(sidebar && sidebar.classList.contains('open')); }
function openSidebarMobile(){ setSidebar(true); }
function closeSidebarMobile(){ setSidebar(false); }
function toggleSidebarMobile(){ setSidebar(!isSidebarOpen()); }

menuBtn && menuBtn.addEventListener('click', toggleSidebarMobile, {passive:true});
overlay && overlay.addEventListener('click', closeSidebarMobile, {passive:true});

// Cerrar con Esc (sin romper escritorio)
document.addEventListener('keydown', (ev)=>{
  try{
    if (ev.key === 'Escape' && isSidebarOpen()){
      ev.preventDefault();
      closeSidebarMobile();
    }
  }catch(e){}
});

// Controles del reproductor
$('#prev').onclick = playPrev;
$('#next').onclick = playNext;

$('#play').onclick = () => {
    const el = activeEl();
    if (el.paused) {
        state._userPaused = false;
        el.play();
    } else {
        state._userPaused = true;
        el.pause();
    }
    $('#play').textContent = el.paused ? '▶' : '⏸';
    $('#mini-play') && ($('#mini-play').textContent = el.paused ? '▶' : '⏸');
    updatePlayerPadding();
};

$('#mini-play')?.addEventListener('click', () => $('#play').click());
$('#mini-prev')?.addEventListener('click', playPrev);
$('#mini-next')?.addEventListener('click', playNext);

// Barra de progreso
(() => {
    const bar = $('#bar');
    let dragging = false;
    
    const setFromEvent = e => {
        const r = bar.getBoundingClientRect();
        const x = e.clientX !== undefined ? e.clientX : (e.touches ? e.touches[0].clientX : 0);
        const pct = Math.max(0, Math.min(1, (x - r.left) / r.width));
        activeEl().currentTime = pct * (activeEl().duration || 0);
    };
    
    bar.addEventListener('pointerdown', e => {
        dragging = true;
        bar.setPointerCapture(e.pointerId);
        setFromEvent(e);
    });
    
    bar.addEventListener('pointermove', e => {
        if (dragging) setFromEvent(e);
    });
    
    const end = () => {
        dragging = false;
    };
    
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('pointerleave', end);
})();

// Controles de volumen
$('#volume')?.addEventListener('input', () => {
    activeEl().volume = $('#volume').valueAsNumber || 1;
});

$('#mute')?.addEventListener('click', () => {
    const el = activeEl();
    el.muted = !el.muted;
    $('#mute').textContent = el.muted ? '🔈' : '🔇';
});

$('#volume_c')?.addEventListener('input', () => {
    const v = $('#volume_c').valueAsNumber || 1;
    activeEl().volume = v;
    const vol = $('#volume');
    vol && (vol.value = v);
});

$('#mute_c')?.addEventListener('click', () => {
    const el = activeEl();
    el.muted = !el.muted;
});

// Toggles y botones
function updateDesktopToggle(sel, on) {
    const b = $(sel);
    if (!b) return;
    b.classList.toggle('toggle-on', !!on);
}

$('#btnShuffle')?.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    updateDesktopToggle('#deskShuffle', state.shuffle);
    toast(state.shuffle ? 'Shuffle ON' : 'Shuffle OFF');
});

$('#btnRepeat')?.addEventListener('click', () => {
    state.repeatOne = !state.repeatOne;
    updateDesktopToggle('#deskRepeat', state.repeatOne);
    toast(state.repeatOne ? 'Repeat One ON' : 'Repeat One OFF');
});

// Botones de escritorio
$('#deskShuffle')?.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    updateDesktopToggle('#deskShuffle', state.shuffle);
    toast(state.shuffle ? 'Shuffle ON' : 'Shuffle OFF');
});
$('#deskRepeat')?.addEventListener('click', () => {
    state.repeatOne = !state.repeatOne;
    updateDesktopToggle('#deskRepeat', state.repeatOne);
    toast(state.repeatOne ? 'Repeat One ON' : 'Repeat One OFF');
});

// Proveedores y switches
function syncProvUI() {
    ['#provChips_d', '#provChips_m'].forEach(sel => {
        const box = $(sel);
        if (!box) return;
        $$('.chip', box).forEach(ch => {
            ch.classList.toggle('on', !!state.providers[ch.dataset.prov]);
        });
    });
}

function syncSwitchesUI() {
    const c = state.crossfade;
    
    ['#crossfadeToggle_d', '#crossfadeToggle_m'].forEach(id => {
        const el = $(id);
        el && (el.checked = c);
    });
}

function setCrossfade(on) {
    state.crossfade = on;
    syncSwitchesUI();
}

$('#provChips_d')?.addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const p = c.dataset.prov;
    state.providers[p] = !state.providers[p];
    syncProvUI();
    doSearchNow();
});

$('#provChips_m')?.addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const p = c.dataset.prov;
    state.providers[p] = !state.providers[p];
    syncProvUI();
    doSearchNow();
});

$('#crossfadeToggle_d')?.addEventListener('change', e => setCrossfade(e.target.checked));
$('#crossfadeToggle_m')?.addEventListener('change', e => setCrossfade(e.target.checked));

// Búsqueda optimizada con caché
const FIELDS = ['identifier', 'title', 'creator', 'year', 'downloads', 'mediatype', 'date', 'publicdate', 'uploader', 'account'];
const IA_BASE = 'https://archive.org/advancedsearch.php';

async function safeJSON(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        console.error('Fetch error:', e);
        return null;
    }
}

function iaBuild(expr, sort = ['year asc', 'title asc']) {
    const p = new URLSearchParams();
    p.set('q', expr);
    FIELDS.forEach(f => p.append('fl[]', f));
    p.set('rows', '200');
    p.set('output', 'json');
    sort.forEach(s => p.append('sort[]', s));
    return `${IA_BASE}?${p.toString()}`;
}

function iaExprPriority(q) {
    return `((account:(${PRIORITY_ACCOUNT}) OR uploader:(${PRIORITY_UPLOADER}) OR creator:("Alquimix"))) AND mediatype:(audio) AND (creator:("${q}") OR title:("${q}") OR subject:("${q}"))`;
}

function iaExprCreatorTitle(q) {
    return `(mediatype:(audio) AND (creator:("${q}") OR title:("${q}")))`;
}

function iaExprTitle(q) {
    return `title:("${q}") AND mediatype:(audio)`;
}

async function searchArchive(q) {
    const cacheKey = `archive:${q}`;
    if (SEARCH_CACHE.has(cacheKey)) {
        return SEARCH_CACHE.get(cacheKey);
    }
    
    const urls = [
        iaBuild(iaExprPriority(q)),
        iaBuild(iaExprCreatorTitle(q)),
        iaBuild(iaExprTitle(q), ['year asc', 'downloads desc'])
    ];
    
    const docs = [];
    for (const u of urls) {
        const data = await safeJSON(u);
        if (!data) continue;
        const got = (data.response?.docs || []).filter(x => x.mediatype === 'audio');
        docs.push(...got);
    }
    
    const map = new Map();
    for (const d of docs) {
        if (!map.has(d.identifier)) map.set(d.identifier, d);
    }
    
    const uniq = [...map.values()];
    const albums = uniq.map(doc => {
        const uploader = (doc.uploader || '') + '';
        const creator = (Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || '')) + '';
        const isAlq = /alquimix/i.test(uploader) || /alquimix/i.test(creator);
        
        return {
            id: 'ia:' + doc.identifier,
            provider: 'archive',
            title: doc.title || 'Sin título',
            artist: creator || q,
            year: doc.year || (doc.date || '').slice(0,4) || (doc.publicdate || '').slice(0,4) || '',
            downloads: doc.downloads || 0,
            cover: `https://archive.org/download/${doc.identifier}/__ia_thumb.jpg`,
            link: `https://archive.org/details/${doc.identifier}`,
            alq: isAlq
        };
    });
    
    albums.sort((a, b) => {
        if (a.alq !== b.alq) return b.alq - a.alq;
        return (String(a.year || '').localeCompare(String(b.year || '')) || 
               (a.title || '').localeCompare(b.title || ''));
    });
    
    SEARCH_CACHE.set(cacheKey, albums);
    return albums;
}

async function searchAll(q) {
    if (!state.providers.archive) {
        state.providers.archive = true;
        syncProvUI();
    }
    const results = await searchArchive(q);
    state.nextAlbums = [...results].filter(a => a !== state.currentAlbum).slice(0, 5);
    return results;
}

// Carga de pistas
async function fetchArchiveTracks(identifier) {
    const id = identifier.replace(/^ia:/, '');
    const res = await fetch(`https://archive.org/metadata/${id}`);
    
    if (!res.ok) throw new Error('No se pudo cargar el álbum');
    
    const data = await res.json();
    const files = data.files || [];
    // Preferimos explícitamente archivos llamados 'cover.*' si existen (prioridad máxima)
    const coverExplicit = files.find(f => /^(?:\.|_|\s|)*cover\.(jpg|jpeg|png|webp)$/i.test(f.name));

    
    const cover = coverExplicit || files.find(f => 
        /(\.jpg|\.jpeg|\.png|\.webp)$/i.test(f.name) && 
        /cover|folder|front|album|art/i.test(f.name)
    );
    
    const coverUrl = cover ? 
        `https://archive.org/download/${id}/${encodeURIComponent(cover.name)}` : 
        `https://archive.org/download/${id}/__ia_thumb.jpg`;
    
    const exts = ['.mp3', '.ogg', '.m4a', '.aac', '.wav', '.flac'];
    
    let tracks = files
        .filter(f => exts.some(ext => f.name.toLowerCase().endsWith(ext)))
        .filter(f => !/\.zip$|\.m3u$|\.cue$|\.txt$|^_?thumb/i.test(f.name))
        .map((f, i) => {
            const name = (f.title || f.track || f.name).replace(/_/g, ' ');
            const ds = f.length ? Number(f.length) : (f.duration ? Number(f.duration) : NaN);
            
            return {
                index: i + 1,
                name,
                size: f.size ? (Number(f.size) / (1024 * 1024)).toFixed(1) + ' MB' : '',
                format: (f.format || f.source || f.name.split('.').pop()).toString().toUpperCase(),
                duration: isFinite(ds) ? fmtTime(ds) : (f.length || ''),
                durationSec: isFinite(ds) ? ds : NaN,
                url: `https://archive.org/download/${id}/${encodeURIComponent(f.name)}`,
                artist: state.currentAlbum?.artist || '',
                album: state.currentAlbum?.title || '',
                cover: coverUrl,
                licenseLabel: '',
                licenseUrl: '',
                source: 'Internet Archive',
                sourceUrl: `https://archive.org/details/${id}`,
                __blocked: false
            };
        });
    
    const num = s => {
        const m = s.match(/(^|[^0-9])(\d{1,2})([^0-9]|$)/);
        return m ? Number(m[2]) : Infinity;
    };
    
    tracks.sort((a, b) => num(a.name) - num(b.name));
    
    const seen = new Set();
    tracks = tracks.filter(t => {
        if (seen.has(t.url)) return false;
        seen.add(t.url);
        return true;
    });
    
    return { tracks, cover: coverUrl };
}

// Renderizado
function renderAlbums(albums) {
    const list = $('#albums');
    list.innerHTML = '';
    
    if (!albums.length) {
        $('#albums-empty').style.display = 'block';
        return;
    }
    
    $('#albums-empty').style.display = 'none';
    
    for (const alb of albums) {
        const alqBadge = alb.alq ? 
            `<span class="src-badge alq" title="Subido por ${PRIORITY_UPLOADER}">★ ${PRIORITY_UPLOADER}</span>` : 
            '';
        
        const el = document.createElement('div');
        el.className = 'album';
        el.dataset.id = alb.id;
        el.innerHTML = `
            <img class="cover" loading="lazy" src="${alb.cover || 'https://archive.org/images/notfound.png'}" 
                 onerror="this.src='https://archive.org/images/notfound.png'">
            <div class="meta">
                <div class="title" title="${alb.title}">${alb.title} 
                    <span class="src-badge">${alb.provider}</span>${alqBadge}
                </div>
                <div class="year" style="color:#9fb2c6;font-size:12px;">
                    ${alb.artist || ''} ${alb.year ? ('· ' + alb.year) : ''}
                </div>
            </div>
            <div class="downloads">⬇ ${alb.downloads || 0}</div>
        `;
        
        
        const _img = el.querySelector('img.cover');
        if (_img) {
            const ph = makeCoverPlaceholder(`${alb.artist || ''} ${alb.title || ''}`.trim());
            if (isWeakCover(_img.getAttribute('src'))) _img.setAttribute('src', ph);
            _img.addEventListener('error', () => { _img.src = ph; }, { once: true });
        }
        el.addEventListener('click', () => {
            try {
                const idxSel = (albums || []).findIndex(a => a && a.id === alb.id);
                if (idxSel >= 0) {
                    state.nextAlbums = albums.slice(idxSel + 1).concat(albums.slice(0, idxSel));
                } else {
                    state.nextAlbums = (albums || []).filter(a => a && a.id !== alb.id);
                }
            } catch(e) { /* no-op */ }
            selectAlbum(alb);
        });
list.appendChild(el);
    }
}

function licenseTag(t) {
    if (!t.licenseLabel) return '';
    return t.licenseUrl ? 
        `<a class="tag" href="${t.licenseUrl}" target="_blank" rel="noopener">${t.licenseLabel}</a>` :
        `<span class="tag">${t.licenseLabel}</span>`;
}

function renderTracks(tracks) {
    const wrap = $('#tracks');
    wrap.innerHTML = '';
    
    if (!tracks.length) {
        wrap.innerHTML = '<div class="empty">No hay pistas.</div>';
        return;
    }
    
    tracks.forEach((t, i) => {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.i = i;
        row.draggable = true;
        
        row.innerHTML = `

            <div class="t-left">
                <img class="t-cover" loading="lazy" src="${t.cover || (state.currentAlbum?.cover || '')}" 
                     onerror="this.src='https://archive.org/images/notfound.png'" alt="cover">
            </div>

            <div class="t-title">
                <span class="index">${String(i + 1).padStart(2, '0')}</span>
                <span class="name">${getSafeName(t)}</span>
                <span class="format">· ${t.format || ''}</span>
            </div>
            <div class="t-dur">${t.duration || ''}</div>
            <div class="t-more">
                <button class="icon-btn" type="button" title="Más">⋯</button>
            </div>
            <div class="t-meta">
                <div class="tags">
                    <span class="tag">${t.source || state.currentAlbum?.provider || ''}</span>
                    ${licenseTag(t)}
                    <button class="sm-btn add only-desktop" type="button">Agregar a…</button>
                </div>
            </div>
        `;
        
        row.addEventListener('click', e => {
            if (e.target.closest('.icon-btn, .add')) return;
            playIndex(i);
        });
        
        row.querySelector('.add')?.addEventListener('click', e => {
            e.stopPropagation();
            openAddToPlaylistDialog(t);
        });
        
        row.querySelector('.t-more .icon-btn').addEventListener('click', e => {
            e.stopPropagation();
            openTrackSheet(i, t);
        });
        
        row.addEventListener('dragstart', e => {
            e.dataTransfer.setData('application/json', JSON.stringify(tracks[i]));
        });
        
        wrap.appendChild(row);
    });
}

// Playlists
function openTrackSheet(i, t) {
    state.contextIdx = i;
    $('#trackInfo').textContent = `${t.name} · ${t.artist || ''}`;
    $('#tSource').href = t.sourceUrl || '#';
    $('#tAdd').onclick = () => {
        openAddToPlaylistDialog(t);
    };
    openSheet($('#trackSheet'));
}

function openAddToPlaylistDialog(track) {
    const pls = loadPlaylists();
    if (!pls.length) {
        toast('No tenés playlists todavía.');
        return;
    }
    
    const names = pls.map((p, idx) => `${idx + 1}. ${p.name}`).join('\n');
    const idx = prompt(`Agregar a playlist:\n${names}\n\nNúmero:`);
    const n = parseInt(idx, 10);
    
    if (!Number.isInteger(n) || n < 1 || n > pls.length) return;
    
    addTrackToPlaylist(pls[n - 1].id, { ...track });
    renderPlaylists();
    toast(`Añadido a "${pls[n - 1].name}"`);
}

function loadPlaylists() {
    try {
        return JSON.parse(LS_SAFE.getItem(LS_PLAYLISTS) || '[]');
    } catch (e) {
        console.error('Error loading playlists:', e);
        return window.__pls || [];
    }
}

function savePlaylists(pls) {
    try {
        LS_SAFE.setItem(LS_PLAYLISTS, JSON.stringify(pls));
    } catch (e) {
        console.error('Error saving playlists:', e);
        window.__pls = pls;
    }
}

function renderPlaylists() {
    const pls = loadPlaylists();
    const box = $('#playlists');
    box.innerHTML = '';
    $('#pl-empty').style.display = pls.length ? 'none' : 'block';
    
    for (const pl of pls) {
        const el = document.createElement('div');
        el.className = 'album';
        el.style.marginBottom = '8px';
        el.innerHTML = `
            <div style="grid-column:1 / span 3;display:flex;justify-content:space-between;align-items:center;width:100%">
                <strong>${pl.name}</strong>
                <span style="color:#9fb2c6;font-size:12px">${pl.tracks.length} pistas</span>
            </div>
        `;
        
        el.addEventListener('click', () => openPlaylist(pl.id));
        
        el.addEventListener('dragover', e => {
            e.preventDefault();
            el.style.outline = '1px solid rgba(0,211,255,.5)';
        });
        
        el.addEventListener('dragleave', () => {
            el.style.outline = '';
        });
        
        el.addEventListener('drop', e => {
            e.preventDefault();
            el.style.outline = '';
            try {
                const data = e.dataTransfer.getData('application/json');
                if (!data) return;
                const t = JSON.parse(data);
                addTrackToPlaylist(pl.id, t);
                renderPlaylists();
                toast(`Añadido a "${pl.name}"`);
            } catch (e) {
                console.error('Drop error:', e);
            }
        });
        
        box.appendChild(el);
    }
}

function createPlaylist() {
    const raw = prompt('Nombre de la playlist:');
    const name = (raw || '').trim();
    if (!name) return;
    
    const pls = loadPlaylists();
    let final = name;
    let k = 2;
    
    while (pls.some(p => p.name.toLowerCase() === final.toLowerCase())) {
        final = `${name} (${k++})`;
    }
    
    pls.push({
        id: 'pl_' + Date.now(),
        name: final,
        tracks: []
    });
    
    savePlaylists(pls);
    renderPlaylists();
    openPlaylist(pls.at(-1).id);
}

function addTrackToPlaylist(id, t) {
const pls = loadPlaylists();
const pl = pls.find(p => p.id === id);
if (!pl) return;

// Verifica si la pista ya existe usando múltiples criterios
const trackUrl = t && (t.url || t.src);
if (!trackUrl) return;

const exists = (pl.tracks || []).find(x => 
    (x.url === trackUrl) || 
    (x.name && t.name && x.name === t.name)
);

if (!exists) {
    const clean = normalizeNameOnly(t);
    pl.tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
    pl.tracks.push(clean);
    savePlaylists(pls);
}

}

function openPlaylist(id) {
    const pls = loadPlaylists();
    const pl = pls.find(p => p.id === id);
    if (!pl) return;

// Completar nombres faltantes en pistas de la playlist
if (!Array.isArray(pl.tracks)) pl.tracks = [];
let __changed = false;
pl.tracks = pl.tracks.map(tt => {
    const currentName = tt && tt.name;
    const safeName = getSafeName(tt);

    // Siempre actualizar el nombre para asegurar consistencia
    if (currentName !== safeName) {
        __changed = true;
        return { ...tt, name: safeName };
    }
    return tt;
});
if (__changed) savePlaylists(pls);

    
    
state.view = 'playlist';
    state.currentPlaylist = pl;
    state.currentAlbum = { title: '', artist: '', cover: '' };
    state.tracks = pl.tracks.slice();
    state.idx = -1;
    
    
    resetContextKeepPlaying();
$('#content').innerHTML = `
        <div class="album-hero">
            <img class="hero-cover" id="hero-cover" 
                 src="${pl.tracks[0]?.cover || 'https://archive.org/images/notfound.png'}" 
                 onerror="this.src='https://archive.org/images/notfound.png'">
            <div>
                <h1>Playlist: ${pl.name}</h1>
                <div class="sub">${pl.tracks.length} pistas</div>
                <div class="actions">
                    <button class="btn" id="plPlayAll" type="button">Reproducir todo</button>
                    <button class="btn secondary" id="plShuffle" type="button">Shuffle</button>
                    <button class="btn secondary" id="plDelete" type="button">Eliminar</button>
                </div>
            </div>
        </div>
        <section class="tracks">
            <div id="tracks"></div>
        </section>
    `;
    
    renderPlaylistTracks(pl);
    
    $('#plPlayAll').onclick = () => {
        if (state.tracks.length) playIndex(0);
    };
    
    $('#plShuffle').onclick = () => {
        state.shuffle = true;
        updateDesktopToggle('#deskShuffle', true);
        if (state.tracks.length) playIndex(Math.floor(Math.random() * state.tracks.length));
    };
    
    $('#plDelete').onclick = () => {
        if (confirm('¿Eliminar playlist?')) {
            savePlaylists(pls.filter(p => p.id !== pl.id));
            state.view = 'album';
            state.currentPlaylist = null;
            $('#content').innerHTML = '<div class="empty">Selecciona un álbum o playlist.</div>';
            renderPlaylists();
        }
    };
}

function renderPlaylistTracks(pl) {
    const wrap = $('#tracks');
    wrap.innerHTML = '';
    
    if (!pl.tracks.length) {
        wrap.innerHTML = '<div class="empty">Sin pistas. Arrastrá canciones desde un álbum.</div>';
        return;
    }
    
    pl.tracks.forEach((t, i) => {
        const safeName = getSafeName(t);
        // Selecciona la mejor portada disponible o un placeholder basado en el nombre
        const cover = (typeof bestCoverOrPlaceholder === 'function')
            ? bestCoverOrPlaceholder(safeName, t.cover || '')
            : (t.cover || 'https://archive.org/images/notfound.png');
        const row = document.createElement('div');
        // Usamos la clase específica para playlists para respetar el grid y los estilos
        row.className = 'pl-track-row';
        row.dataset.i = i;
        row.draggable = true;
        
        row.innerHTML = `
            <div class="t-left">
                <img class="t-cover" loading="lazy" src="${cover}" onerror="this.src='https://archive.org/images/notfound.png'" alt="cover">
            </div>
            <div class="t-title">
                <span class="index">${String(i + 1).padStart(2, '0')}</span>
                <span class="name" title="${safeName}">${safeName}</span>
                <span class="format">${t.format ? "· " + t.format : ""}</span>
            </div>
            <div class="t-dur">${t.duration || ''}</div>
            <div class="t-more">
                <button class="icon-btn" type="button">⋯</button>
            </div>
            <div class="t-meta">
                <div class="tags">
                    <span class="tag">${t.source || ''}</span>
                    ${licenseTag(t)}
                    <button class="sm-btn add only-desktop" type="button">Quitar</button>
                </div>
            </div>
        `;
        
        row.addEventListener('click', e => {
            if (e.target.closest('.icon-btn, .add')) return;
            state.tracks = pl.tracks.slice();
            playIndex(i);
        });
        
        row.querySelector('.add')?.addEventListener('click', e => {
            e.stopPropagation();
            const pls = loadPlaylists();
            const p = pls.find(x => x.id === pl.id);
            if (p) {
                p.tracks.splice(i, 1);
                savePlaylists(pls);
                openPlaylist(pl.id);
            }
        });
        
        row.querySelector('.t-more .icon-btn').addEventListener('click', e => {
            e.stopPropagation();
            openTrackSheet(i, t);
        });
        
        row.addEventListener('dragstart', e => {
            e.dataTransfer.setData('application/json', JSON.stringify(pl.tracks[i]));
            e.dataTransfer.setData('text/plain', i);
        });
        
        row.addEventListener('dragover', e => {
            e.preventDefault();
            row.style.background = '#121222';
        });
        
        row.addEventListener('dragleave', () => {
            row.style.background = '';
        });
        
        row.addEventListener('drop', e => {
            e.preventDefault();
            row.style.background = '';
            const from = Number(e.dataTransfer.getData('text/plain'));
            const to = i;
            
            if (Number.isInteger(from)) {
                const pls = loadPlaylists();
                const p = pls.find(x => x.id === pl.id);
                if (p) {
                    const [m] = p.tracks.splice(from, 1);
                    p.tracks.splice(to, 0, m);
                    savePlaylists(pls);
                    openPlaylist(pl.id);
                }
            }
        });
        
        wrap.appendChild(row);
    });
}

// Selección de álbum con precarga
async function selectAlbum(alb) {
    state.view = 'album';
    state.currentPlaylist = null;
    state.currentAlbum = alb;
    state.tracks = [];
    state.idx = -1;
    
    
    resetContextKeepPlaying();
$$('.album', $('#albums')).forEach(n => {
        n.classList.toggle('active', n.dataset.id === alb.id);
    });
    
    closeSidebarMobile();
    
    $('#content').innerHTML = `
        <div class="album-hero">
            <img class="hero-cover" id="hero-cover" 
                 src="${alb.cover || 'https://archive.org/images/notfound.png'}" 
                 onerror="this.src='https://archive.org/images/notfound.png'">
            <div>
                <h1>${alb.title}</h1>
                <div class="sub">${alb.artist || ''}${alb.year ? (' · ' + alb.year) : ''}</div>
                <div class="actions">
                    <button class="btn" id="playall" type="button">Reproducir todo</button>
                    <a class="btn secondary" href="${alb.link || '#'}" target="_blank" rel="noopener">Ver fuente</a>
                </div>
            </div>
        </div>
        <section class="tracks">
            <div id="tracks"><div class="empty">Cargando pistas…</div></div>
        </section>
    `;
    

    /* hero onerror guard */
    (function(){
        const hero = document.getElementById('hero-cover');
        if (hero) {
            const ph = (window.makeCoverPlaceholder ? makeCoverPlaceholder(`${alb.artist||''} ${alb.title||''}`.trim()) : 'https://archive.org/images/notfound.png');
            hero.addEventListener('error', () => { hero.src = ph; }, { once:true });
            // If initial src is IA notfound, swap immediately
            if (/images\/notfound\.png$/i.test(hero.src)) hero.src = ph;
        }
    })();
    try {
        let res = { tracks: [], cover: alb.cover || '' };
        
        if (alb.provider === 'archive') {
            res = await fetchArchiveTracks(alb.id);
        } else if (alb.provider === 'openverse') {
            res = await fetchOpenverseTracks(alb.id);
        }
        
        if (res.cover) {
            $('#hero-cover').src = res.cover;
        }
        
        state.tracks = (res.tracks || []).map(t => ({
            ...t,
            artist: t.artist || (alb.artist || ''),
            album: t.album || (alb.title || ''),
            cover: t.cover || res.cover || alb.cover
        }));
        
        
        resetPreloadBuffer();
renderTracks(state.tracks);
        
        $('#playall').onclick = () => {
            if (state.tracks.length) playIndex(0);
        };
    } catch (e) {
        console.error('Error loading album:', e);
        $('#tracks').innerHTML = '<div class="empty">No se pudieron cargar las pistas.</div>';
    }
}

// Búsqueda con debouncing
const doSearch = debounce(async () => {
    const q = $('#q').value.trim();
    
    if (q.length < 3) {
        $('#albums').innerHTML = '';
        $('#albums-empty').style.display = 'block';
        
        const shelf = document.getElementById('homeShelf');
        if (shelf) {
            if (q === '') {
                shelf.style.display = '';
                if (!window.__homeShelfData || !__homeShelfData.length) {
                    if (typeof loadHomeShelfOnce === 'function') loadHomeShelfOnce();
                }
            } else {
                shelf.style.display = 'none';
            }
        }
        return;
    }
    
    $('#albums').innerHTML = '<div class="empty">Buscando…</div>';
    const _shelf = document.getElementById('homeShelf');
    if (_shelf) _shelf.style.display = 'none';
    
    try {
        const albums = await searchAll(q);
        state.artist = q;
        state.albums = albums;
        renderAlbums(albums);
        
        if (!albums.length) {
            $('#albums').innerHTML = '<div class="empty">Sin resultados. Probá con otro término.</div>';
        }
    } catch (e) {
        console.error('Search error:', e);
        $('#albums').innerHTML = '<div class="empty">Error de búsqueda.</div>';
    }
}, 500);

function doSearchNow() {
    if (doSearch.flush) doSearch.flush();
    else doSearch();
}

// Mostrar Recomendados sólo cuando el buscador está vacío
function updateHomeShelfVisibility() {
    const q = $('#q');
    const shelf = document.getElementById('homeShelf');
    if (!q || !shelf) return;
    const hasText = (q.value || '').trim().length > 0;
    shelf.style.display = hasText ? 'none' : '';
}
// Inicial: ajustar según valor actual del input
window.addEventListener('DOMContentLoaded', updateHomeShelfVisibility, { once: true });
// Reaccionar al tipear (instantáneo, además del debounce de búsqueda)
$('#q')?.addEventListener('input', updateHomeShelfVisibility, { passive: true });

$('#q').addEventListener('input', doSearch);

// Mini player y visibilidad
(() => {
    const mini = $('#mini');
    const player = $('#player');
    if (!mini || !player) return;

    let playerVisible = false;

    const io = new IntersectionObserver(entries => {
        entries.forEach(en => {
            playerVisible = !!(en.isIntersecting && en.intersectionRatio >= 0.6);
            updateMini();
        });
    }, { threshold: [0, 0.6, 1] });
    io.observe(player);

    const mq = matchMedia('(min-width:900px)');
    if (mq.addEventListener) {
        mq.addEventListener('change', () => updateMini());
    } else if (mq.addListener) {
        mq.addListener(() => updateMini());
    }
    window.addEventListener('resize', updateMini);

    function updateMini() {
        if (mq.matches) {
            mini.style.display = 'none';
            return;
        }
        mini.style.display = playerVisible ? 'none' : 'block';
    }

    updateMini();
})();
$('#miniShuffle')?.addEventListener('click', () => $('#btnShuffle').click());
$('#miniRepeat')?.addEventListener('click', () => $('#btnRepeat').click());
$('#miniMute')?.addEventListener('click', () => {
    const el = activeEl();
    el.muted = !el.muted;
});
$('#miniVolume')?.addEventListener('input', () => {
    const v = $('#miniVolume').valueAsNumber || 1;
    activeEl().volume = v;
    const vol = $('#volume');
    vol && (vol.value = v);
    const vc = $('#volume_c');
    vc && (vc.value = v);
});

// Inicialización de playlists
$('#newPl').addEventListener('click', createPlaylist);
renderPlaylists();
syncProvUI();
syncSwitchesUI();

if (matchMedia('(min-width:900px)').matches) {
    $('#acc-albums').setAttribute('open', '');
    $('#acc-pl').setAttribute('open', '');
}

// Media Session & metadata
function setupMediaSession(){
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.setActionHandler('play', async () => {
            try { await activeEl().play(); navigator.mediaSession.playbackState = 'playing'; } catch(e){}
        });
        navigator.mediaSession.setActionHandler('pause', () => { try { activeEl().pause(); navigator.mediaSession.playbackState = 'paused'; } catch(e){} });
        navigator.mediaSession.setActionHandler('previoustrack', () => { try { playPrev(); } catch(e){} });
        navigator.mediaSession.setActionHandler('nexttrack', () => { if (sinceLastSeek >= SD.seekCooldownSecs) { safeSeek(el, Math.max(0, dur - 0.6)); silentAccum = 0; } });
        navigator.mediaSession.playbackState = activeEl().paused ? 'paused' : 'playing';
    } catch(e) {
        console.warn('MediaSession not fully available:', e);
    }
}

function updateMediaMetadata(track){
    if (!('mediaSession' in navigator) || !state.background || !track) return;
    try {
        const album = (state.view === 'playlist') ? (state.currentPlaylist?.name || '') : (state.currentAlbum?.title || '');
        const artist = (state.view === 'playlist') ? (`Playlist · ${state.currentPlaylist?.name || ''}`) : (track.artist || state.currentAlbum?.artist || 'Artista desconocido');
        const cover = track.cover || $('.hero-cover')?.src || state.currentAlbum?.cover || 'https://archive.org/images/notfound.png';
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name || 'Sin título',
            artist, album,
            artwork: [
                { src: cover, sizes: '96x96', type: 'image/jpeg' },
                { src: cover, sizes: '256x256', type: 'image/jpeg' }
            ]
        });
    } catch(e){ console.warn('Error updating media metadata:', e); }
}

// Añadir control de reproducción en segundo plano al panel de controles
(function addBackgroundPlayControls(){
    const sheet = $('#ctrlSheet');
    if (!sheet) return;
    const container = sheet.querySelector('.row')?.parentElement || sheet;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
        <label>Reproducción en segundo plano</label>
        <label class="switch" style="margin-left:auto">
            <input type="checkbox" id="backgroundToggle" ${state.background ? 'checked' : ''}>
            <span class="slider"></span>
        </label>
    `;
    container.appendChild(row);
    $('#backgroundToggle')?.addEventListener('change', (e) => {
        state.background = !!e.target.checked;
        try { LS_SAFE.setItem(LS_BACKGROUND, JSON.stringify(state.background)); } catch(e){}
        if (state.background) {
            try { setupMediaSession(); updateMediaMetadata(state.tracks[state.idx]); } catch(e){}
            toast && toast('Reproducción en segundo plano activada');
        } else {
            toast && toast('Reproducción en segundo plano desactivada');
        }
    });
})();

// Mantener reproducción en segundo plano cuando la página está oculta
document.addEventListener('visibilitychange', async () => {
    if (!state.background) return;
    const el = activeEl();
    if (document.hidden) {
        if (el && !el.paused) {
            try { await el.play(); } catch(e){}
        }
    } else {
        try {
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = el.paused ? 'paused' : 'playing';
                updateMediaMetadata(state.tracks[state.idx]);
            }
        } catch(e){}
    }
});

// Inicializar Media Session al cargar
setupMediaSession();

// ===== Playlists: Exportar / Importar =====
function exportPlaylists(){
    try {
        const pls = loadPlaylists();
        const data = JSON.stringify({ version: 1, playlists: pls }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'playlists.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        toast && toast('Playlists exportadas.');
    } catch(e){
        console.error('Export error:', e);
        toast && toast('No se pudo exportar.');
    }
}

function importPlaylistsFromFile(file, mode='merge'){
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const txt = reader.result;
            const parsed = JSON.parse(txt);
            const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.playlists) ? parsed.playlists : []);
            if (!Array.isArray(arr)) throw new Error('Formato inválido');
            const current = loadPlaylists();
            let result = [];
            if (mode === 'replace') {
                result = arr;
            } else {
                const byId = new Map();
                for (const p of current) byId.set(p.id || p.name, p);
                for (const p of arr) {
                    const key = p.id || p.name;
                    if (!byId.has(key)) {
                        byId.set(key, p);
                    } else {
                        const dst = byId.get(key);
                        const urls = new Set((dst.tracks||[]).map(t => t.url));
                        for (const t of (p.tracks||[])){
                            if (t && t.url && !urls.has(t.url)) {
                                (dst.tracks = dst.tracks || []).push(t);
                                urls.add(t.url);
                            }
                        }
                    }
                }
                result = Array.from(byId.values());
            }
            savePlaylists(result);
            renderPlaylists && renderPlaylists();
            toast && toast('Playlists importadas.');
        } catch(e){
            console.error('Import error:', e);
            toast && toast('Archivo inválido.');
        }
    };
    reader.readAsText(file);
}

function promptImportPlaylists(){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
        const f = input.files && input.files[0];
        if (f) importPlaylistsFromFile(f, 'merge');
    };
    input.click();
}

// Enlazar botones Exportar/Importar
(function wirePlaylistTransferButtons(){
    const bExp = $('#btnExportPl');
    const bImp = $('#btnImportPl');
    if (bExp) bExp.addEventListener('click', exportPlaylists);
    if (bImp) bImp.addEventListener('click', promptImportPlaylists);
})();

// Auto-close sidebar on mobile when a playlist is selected
try {
  const playlistsBox = document.getElementById('playlists');
  if (playlistsBox && !playlistsBox.__closeOnClick) {
    playlistsBox.addEventListener('click', function(e){
      if (e.target && (e.target.closest('.album') || e.target.closest('[data-pl]'))) {
        try { closeSidebarMobile(); } catch (e) {}
      }
    }, true);
    playlistsBox.__closeOnClick = true;
  }
} catch (e) {}
// === Animated background boot ===
(() => {
  const enable = () => {
    document.body.classList.add('theme-aurora-anim');
    let layer = document.querySelector('.bg-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'bg-layer'; layer.setAttribute('aria-hidden','true');
      document.body.prepend(layer);
    }
    if (layer.querySelector('.orb')) return;
    const mk = (cls,tA,tB,left,top) => {
      const d=document.createElement('div'); d.className='orb '+cls;
      d.style.setProperty('--tA', tA); d.style.setProperty('--tB', tB);
      d.style.left=left; d.style.top=top; layer.appendChild(d);
    };
    mk('',       '39s','19s','-12vmax','-10vmax');
    mk('magenta','47s','23s','55%','-16vmax');
    mk('lime',   '52s','21s','62%','60%');
    mk('yellow', '44s','27s','-18vmax','65%');
  };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', enable, {once:true}); else enable();
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('bg-paused', document.hidden);
  });
})();

// === Neon Wave Visualizer (cyan) ===
(() => {
  let ctx, analyser, rafId = 0;
  const fftSize = 2048;              // alta resolución temporal para ondas
  const smoothing = 0.85;
  const canvas = document.getElementById('viz');
  if (!canvas) return;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const c2d = canvas.getContext('2d', { alpha: true, desynchronized: true });

  const dataT = new Uint8Array(fftSize);

  const resize = () => {
    const eco = document.body.classList.contains('viz-eco') ? 0.7 : 1;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width  = Math.floor(w * eco * DPR);
    canvas.height = Math.floor(h * eco * DPR);
  };
  window.addEventListener('resize', resize);
  resize();

  function ensureAudioGraph(){
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = smoothing;

    const connect = (el) => {
      if (!el) return;
      // evita excepciones si ya se creó un MediaElementSource para este elemento
      if (el._mediaSrcNode) { try { el._mediaSrcNode.connect(analyser); } catch(e){} return; }
      try {
        const s = ctx.createMediaElementSource(el);
        el._mediaSrcNode = s;
        s.connect(analyser);
      } catch(e){ /* ignore */ }
    };
    // Conecta ambas fuentes del crossfade si existen
    connect(window.state?.a1);
    connect(window.state?.a2);

    // fallback: conecta el primer <audio> que encuentre si aún no hay fuentes
    if (!window.state?.a1 && !window.state?.a2) {
      const a = document.querySelector('audio');
      connect(a);
    }

    if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
  }

  function drawWaves(){
    if (!analyser) return;
    analyser.getByteTimeDomainData(dataT);

    const W = canvas.width, H = canvas.height;
    c2d.clearRect(0,0,W,H);

    // Neon blend
    c2d.save();
    c2d.globalCompositeOperation = 'lighter';

    const center = H * 0.72;  // línea base
    const amp    = H * 0.18;  // amplitud máx
    const n = dataT.length;

    // muestreo proporcional al ancho (reduce cómputo)
    const pxStep = 2 * DPR; // 2px por muestra
    const step = Math.max(1, Math.floor(n / Math.max(1, Math.floor(W / pxStep))));

    // helper para trazar una onda
    function wave(phase, kAmplitude, thickness, alpha){
      c2d.beginPath();
      let x = 0;
      for (let i = 0; i < n; i += step){
        const v = (dataT[(i + phase) % n] - 128) / 128; // [-1..1]
        const y = center - v * amp * kAmplitude;
        if (x === 0) c2d.moveTo(x, y); else c2d.lineTo(x, y);
        x += pxStep;
      }
      c2d.lineWidth = thickness;
      c2d.strokeStyle = `rgba(0,229,255,${alpha})`; // celeste neón
      c2d.stroke();
    }

    // capas para resplandor
    wave(0, 1.0, 6*DPR, 0.10);
    wave(Math.floor(n*0.01), 1.0, 3*DPR, 0.22);
    wave(Math.floor(n*0.02), 1.0, 1.6*DPR, 0.9);

    c2d.restore();

    rafId = requestAnimationFrame(drawWaves);
  }

  const hookPlay = () => { ensureAudioGraph(); if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(drawWaves); };
  const hookPause = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } c2d.clearRect(0,0,canvas.width,canvas.height); };

  // Integra con tu botón #play
  $('#play')?.addEventListener('click', () => {
    const el = (window.activeEl && activeEl()) || document.querySelector('audio');
    setTimeout(() => (el && !el.paused) ? hookPlay() : hookPause(), 0);
  });

  // Cambios de pestaña
  document.addEventListener('visibilitychange', () => { document.hidden ? hookPause() : hookPlay(); });

  // API
  window.viz = window.viz || {};
  window.viz.on = () => { document.body.classList.remove('viz-off'); hookPlay(); };
  window.viz.off = () => { hookPause(); document.body.classList.add('viz-off'); };
  window.viz.eco = (on=true) => { document.body.classList.toggle('viz-eco', !!on); };
})();

// === Favicon picker & persistence ===
const SITE_FAVICON_DATAURL = 'site_favicon_dataurl_v1';
(function initFaviconPicker(){
    const linkMain = document.getElementById('dynamic-favicon') || (() => {
        const l = document.createElement('link'); l.id='dynamic-favicon'; l.rel='icon'; document.head.appendChild(l); return l;
    })();
    const link32 = document.getElementById('dynamic-favicon32') || null;
    const apple = document.getElementById('dynamic-apple') || null;

    try {
        const saved = localStorage.getItem(SITE_FAVICON_DATAURL);
        if (saved) {
            linkMain.href = saved;
            if (link32) link32.href = saved;
            if (apple) apple.href = saved;
        }
    } catch(e){}

    const file = document.getElementById('faviconFile');
    const trigger = document.getElementById('btnFavicon');
    if (trigger && file) trigger.addEventListener('click', () => file.click());
    if (file) {
        file.addEventListener('change', e => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
                const data = reader.result;
                linkMain.href = data;
                if (link32) link32.href = data;
                if (apple) apple.href = data;
                try { localStorage.setItem(SITE_FAVICON_DATAURL, data); } catch(e){}
            };
            reader.readAsDataURL(f);
        });
    }
})();

// === Mobile header metrics & scroll padding ===
(function initHeaderSizing(){
  try {
    const hdr = document.querySelector('header');
    if (!hdr) return;
    function setHeaderH(){
      const h = Math.max(hdr.offsetHeight || 0, 48);
      document.documentElement.style.setProperty('--header-h', h + 'px');
    }
    setHeaderH();
    window.addEventListener('load', setHeaderH, { passive: true });
    window.addEventListener('resize', setHeaderH, { passive: true });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(setHeaderH);
      ro.observe(hdr);
    }
  } catch(e){ console.warn('Header sizing init failed:', e); }
})();

/* === Desktop Visualizer (neon cyan waves + bars) === */
(function initDesktopVisualizer(){
  const isDesktop = window.matchMedia && window.matchMedia('(min-width:900px)').matches;
  if (!isDesktop) return;
  let started = false, enabled = false, full = false;
  let AC, ctx, analyser, canvas, g, overlay, metaImg, metaT1, rafId = 0;
  let waveRGB = {r:0,g:211,b:255}, barsRGB = {r:255,g:64,b:255};
  let waveHex = '#00d3ff', barsHex = '#ff40ff';
  function hexToRgb(hex){
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'');
    if(!m) return null; return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
  }

  function readPrefs(){
    try{ const s0 = LS_SAFE && LS_SAFE.getItem('viz_enabled'); if (s0!==null) enabled = JSON.parse(s0);}catch(_){}
    try{ const f0 = LS_SAFE && LS_SAFE.getItem('viz_full'); if (f0!==null) full = JSON.parse(f0);}catch(_){}
    try{ const w = LS_SAFE && LS_SAFE.getItem('viz_wave_color'); if (w) { waveHex = w; const rgb = hexToRgb(w); if (rgb) waveRGB = rgb; } }catch(_){}
    try{ const b = LS_SAFE && LS_SAFE.getItem('viz_bars_color'); if (b) { barsHex = b; const rgb = hexToRgb(b); if (rgb) barsRGB = rgb; } }catch(_){}
  }

  
  function applyColorsToInputs(){
    try{
      if (!overlay) return;
      const wIn = overlay.querySelector('#vizWaveColor');
      const bIn = overlay.querySelector('#vizBarsColor');
      if (wIn && typeof waveHex === 'string') wIn.value = waveHex;
      if (bIn && typeof barsHex === 'string') bIn.value = barsHex;
    }catch(_){}
  }

  function bindColorInputs(){
    if (!overlay) return;
    try{
      const wIn = overlay.querySelector('#vizWaveColor');
      const bIn = overlay.querySelector('#vizBarsColor');
      if (wIn && !wIn.__bound){
        wIn.__bound = true;
        wIn.addEventListener('input', (e)=>{
          try{
            const hex = String((e && e.target && e.target.value) || '').trim();
            const rgb = hexToRgb(hex);
            if (rgb){
              waveHex = hex; waveRGB = rgb;
              try{ LS_SAFE && LS_SAFE.setItem('viz_wave_color', hex); }catch(__){}
            }
          }catch(__){}
        });
      }
      if (bIn && !bIn.__bound){
        bIn.__bound = true;
        bIn.addEventListener('input', (e)=>{
          try{
            const hex = String((e && e.target && e.target.value) || '').trim();
            const rgb = hexToRgb(hex);
            if (rgb){
              barsHex = hex; barsRGB = rgb;
              try{ LS_SAFE && LS_SAFE.setItem('viz_bars_color', hex); }catch(__){}
            }
          }catch(__){}
        });
      }
    }catch(_){}
  }
function ensureCanvas(){
    if (canvas) return canvas;
    // Adopt existing canvas if present to avoid duplicates
    let c = document.getElementById('viz');
    if (c && c.tagName && c.tagName.toLowerCase() === 'canvas') {
      canvas = c;
      try { canvas.classList.add('viz-canvas','only-desktop'); } catch(_){ canvas.className = 'viz-canvas only-desktop'; }
    } else {
      canvas = document.createElement('canvas');
      canvas.id = 'viz';
      canvas.className = 'viz-canvas only-desktop';
      document.body.appendChild(canvas);
    }
    g = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    resize();
    return canvas;
  }

  function ensureOverlay(){
    if (overlay) { bindColorInputs(); applyColorsToInputs(); return overlay; }
    overlay = document.createElement('div');
    overlay.id = 'vizFs';
    overlay.className = 'viz-fs only-desktop';
    overlay.innerHTML = `
      <button class="viz-exit only-desktop" title="Salir de pantalla completa" aria-label="Salir">✕ Salir</button>
      <div class="viz-center">
        <img class="art" alt="Portada"/>
        <div class="t1"></div>
        <div class="viz-ctrls" role="group" aria-label="Controles (overlay)">
          <button class="btn prev" title="Anterior">⏮</button>
          <button class="btn play" title="Play/Pause">▶/⏸</button>
          <button class="btn next" title="Siguiente">⏭</button>
        </div>
        <div class="viz-colors only-desktop" role="group" aria-label="Colores visuales">
          <label class="colorctl"><span>Ondas</span><input type="color" id="vizWaveColor" value="#00d3ff" /></label>
          <label class="colorctl"><span>Barras</span><input type="color" id="vizBarsColor" value="#ff40ff" /></label>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const center = overlay.querySelector('.viz-center');
    metaImg = center.querySelector('img.art');
    metaT1  = center.querySelector('.t1');
    const byId = (id)=>document.getElementById(id);
    center.querySelector('.prev').addEventListener('click', e=>{ e.preventDefault(); byId('prev')?.click(); });
    center.querySelector('.play').addEventListener('click', e=>{ e.preventDefault(); byId('play')?.click(); });
    center.querySelector('.next').addEventListener('click', e=>{ e.preventDefault(); byId('next')?.click(); });
    // Exit fullscreen button
    const btnExit = overlay.querySelector('.viz-exit');
    if (btnExit) btnExit.addEventListener('click', (e)=>{
      e.preventDefault();
      try {
        const fs = document.getElementById('vizFsToggle_d');
        if (fs) { fs.checked = false; fs.dispatchEvent(new Event('change', {bubbles:true})); }
        else if (window.__viz) { window.__viz.setFullscreen(false); }
      } catch(_){ if (window.__viz) try{ window.__viz.setFullscreen(false); }catch(__){} }
    });
    bindColorInputs();
    applyColorsToInputs();
    return overlay;
  }

  function resize(){
    if (!canvas) return;
    const header = document.querySelector('header');
    const top = full ? 0 : (header ? header.offsetHeight : 64);
    canvas.style.top = top + 'px';
    canvas.style.left = 0;
    canvas.style.right = 0;
    canvas.style.bottom = (full ? '0' : 'calc(var(--player-h) + 4px)');
    const w = Math.max(320, window.innerWidth);
    const h = full ? window.innerHeight : Math.min(Math.floor(window.innerHeight * 0.75), 800);
    canvas.width = w; canvas.height = h;
    canvas.style.display = enabled ? 'block' : 'none';
    if (overlay) overlay.style.display = (enabled && full) ? 'flex' : 'none';
  }

  function coverFromTrack(t){
    return t?.img || t?.image || t?.thumb || t?.cover || t?.art || t?.picture || null;
  }
  function updateMeta(){
    let t = null;
    try { if (state && state.tracks && typeof state.idx==='number') t = state.tracks[state.idx]; } catch(_){}
    if (!t || !metaT1) return;
    const title = t.name || t.title || 'Pista';
    metaT1.textContent = title;
    const img = coverFromTrack(t) || document.getElementById('p-cover')?.src;
    if (metaImg) { if (img) { metaImg.src = img; metaImg.style.display='block'; } else { metaImg.removeAttribute('src'); metaImg.style.display='none'; } }
  }

  function setupAudioTap(){
    if (started) return;
    started = true;
    try{
      AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;

      const attachMES = (el)=>{
        try {
          if (el.__mes) { el.__mes.connect(analyser); try{ el.__mes.connect(ctx.destination);}catch(_){}
            return true;
          }
          const src = ctx.createMediaElementSource(el);
          el.__mes = src;
          src.connect(analyser);
          try{ src.connect(ctx.destination);}catch(_){}
          return true;
        } catch(e){ return false; }
      };

      const tapEl = (el)=>{
        if (!el) return;
        try {
          if (typeof el.captureStream === 'function') {
            const ms = el.captureStream();
            if (ms) { ctx.createMediaStreamSource(ms).connect(analyser); return; }
          }
        } catch(_){}
        attachMES(el);
      };

      tapEl(state && state.a1); tapEl(state && state.a2);
      try { tapEl(state && state.nextTrackBuffer); } catch(_){}

      const resume = ()=>{ try{ctx.resume&&ctx.resume();}catch(_){}
        document.removeEventListener('click', resume); document.removeEventListener('keydown', resume);
      };
      document.addEventListener('click', resume, { once:true, passive:true });
      document.addEventListener('keydown', resume, { once:true });

      startDrawing();
    }catch(e){ console.warn('Visualizer init failed:', e); }
  }

  function startDrawing(){
    ensureCanvas(); ensureOverlay(); readPrefs(); applyColorsToInputs();
    const td = new Uint8Array(analyser.fftSize);
    const fq = new Uint8Array(analyser.frequencyBinCount);
    const bars = 96;
    const loop = ()=>{
      rafId = requestAnimationFrame(loop);
      if (!g || !canvas || !enabled) { if (g && canvas) g.clearRect(0,0,canvas.width,canvas.height); return; }
      const w = canvas.width, h = canvas.height;
      g.clearRect(0,0,w,h);

      // Waveform
      analyser.getByteTimeDomainData(td);
      g.save(); g.translate(0, Math.floor(h*0.50));
      g.strokeStyle = `rgba(${waveRGB.r}, ${waveRGB.g}, ${waveRGB.b}, 0.95)`;
      g.lineWidth = 2; g.shadowBlur = 16; g.shadowColor = `rgba(${waveRGB.r}, ${waveRGB.g}, ${waveRGB.b}, 0.35)`;
      g.beginPath();
      for (let i=0;i<td.length;i+=2){
        const x = i/td.length * w;
        const y = (td[i]-128)/128 * (h*0.34);
        if (i===0) g.moveTo(x,y); else g.lineTo(x,y);
      }
      g.stroke();
      g.restore();

      // Bars (fill width, no gaps)
      analyser.getByteFrequencyData(fq);
      const step = Math.max(1, Math.floor(fq.length / bars));
      const bw = w / bars;
      for (let i=0;i<bars;i++){
        const v = fq[i*step] / 255;
        const bh = v * (h*0.38);
        const x0 = Math.round(i*bw);
        const x1 = Math.round((i+1)*bw);
        const ww = Math.max(1, x1 - x0);
        g.fillStyle = `rgba(${barsRGB.r}, ${barsRGB.g}, ${barsRGB.b}, ${0.12 + v*0.25})`; // bars color
        g.fillRect(x0, Math.floor(h*0.5)-bh, ww, bh*2);
      }

      if (full) updateMeta();
    };
    rafId = requestAnimationFrame(loop);
  }

  window.addEventListener('load', ()=>{ ensureCanvas(); ensureOverlay(); setupAudioTap(); }, {once:true});

  window.__viz = {
    setEnabled(flag){
      enabled = !!flag;
      ensureCanvas(); ensureOverlay(); resize();
      try{ LS_SAFE && LS_SAFE.setItem('viz_enabled', JSON.stringify(enabled)); }catch(_){}
    },
    setFullscreen(flag){
      full = !!flag;
      ensureCanvas(); ensureOverlay();
      try { canvas && canvas.classList.toggle('full', full); } catch(_){}
      try { overlay && overlay.classList.toggle('full', full); } catch(_){}
      // move canvas into overlay for correct stacking in fullscreen
      try {
        if (full && overlay && canvas && canvas.parentNode !== overlay) {
          overlay.prepend(canvas);
        } else if (!full && canvas && canvas.parentNode && canvas.parentNode !== document.body) {
          document.body.appendChild(canvas);
        }
      } catch(_){}
      resize(); updateMeta();
      try{ LS_SAFE && LS_SAFE.setItem('viz_full', JSON.stringify(full)); }catch(_){}
    }
  };
})();

// Visuales: wiring de switches de escritorio
(function(){
  const isDesktop = window.matchMedia && window.matchMedia('(min-width:900px)').matches;
  const viz = document.getElementById('vizToggle_d');
  const full = document.getElementById('vizFsToggle_d');
  if (!isDesktop) return;

  // Estados iniciales desde storage seguro
  let on = false, fs = false;
  try { const s = LS_SAFE && LS_SAFE.getItem('viz_enabled'); if (s!==null) on = JSON.parse(s);} catch(_){}
  try { const f = LS_SAFE && LS_SAFE.getItem('viz_full'); if (f!==null) fs = JSON.parse(f);} catch(_){}

  if (viz) {
    viz.checked = !!on;
    try { window.__viz && window.__viz.setEnabled(!!on); } catch(_){}
    viz.addEventListener('change', () => {
      const v = !!viz.checked;
      try { LS_SAFE && LS_SAFE.setItem('viz_enabled', JSON.stringify(v)); } catch(_){}
      try { window.__viz && window.__viz.setEnabled(v); } catch(_){}
    });
  }
  if (full) {
    full.checked = !!fs;
    try { window.__viz && window.__viz.setFullscreen(!!fs); } catch(_){}
    full.addEventListener('change', () => {
      const v = !!full.checked;
      try { LS_SAFE && LS_SAFE.setItem('viz_full', JSON.stringify(v)); } catch(_){}
      try { window.__viz && window.__viz.setFullscreen(v); } catch(_){}
    });
  }
})();

/* === Auto-skip Silence (non-intrusive, mobile+desktop) ===
   TAIL-ONLY CONFIG (hardened):
   - SOLO colas: no recorta inicios ni mitad
   - Más exigente: silencio ≥ 2.5s + 1.2s confirmación
   - Actúa sólo si restan < 6s; seek a duration - 0.7s una única vez
   - Crossfade-safe; guardas de seek estrictas; sin logs en consola
*/
(function(){
  // Detener cualquier detector previo
  try { if (state && state._silenceCtl && typeof state._silenceCtl.stop==='function') { state._silenceCtl.stop(); } } catch(_){}

  const SD = {
    ctx: null,
    analyser: null,
    zeroGain: null,
    srcMap: new WeakMap(),
    flags: new WeakMap(), // el -> { tailDone }
    iv: null,
    enabled: true,
    // Umbrales exigentes (sólo colas)
    rmsThreshold: 0.0060,
    tailSilenceWindow: 2.5,  // silencio sostenido
    confirmExtraTail: 1.2,   // confirmación adicional
    sampleInterval: 240,
    tailNearSecs: 6.0,       // actuar sólo si resta muy poco
    tailSeekBack: 0.7,       // acercar a duration - 0.7s
    seekCooldownSecs: 2.0,
    lastSeekAt: 0
  };

  function ensureCtx() {
    if (SD.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      SD.ctx = new AC();
      SD.analyser = SD.ctx.createAnalyser();
      SD.analyser.fftSize = 2048;
      SD.zeroGain = SD.ctx.createGain();
      SD.zeroGain.gain.value = 0.0;
      SD.analyser.connect(SD.zeroGain);
      SD.zeroGain.connect(SD.ctx.destination);
    } catch(e) { SD.enabled = false; }
  }

  function connect(el){
    if (!SD.enabled) return false;
    ensureCtx();
    if (!SD.ctx) return false;
    try {
      if (SD.srcMap.has(el)) return true;
      let stream = null;
      if (typeof el.captureStream === 'function') stream = el.captureStream();
      else if (typeof el.mozCaptureStream === 'function') stream = el.mozCaptureStream();
      if (!stream) return false;
      const src = SD.ctx.createMediaStreamSource(stream);
      src.connect(SD.analyser);
      SD.srcMap.set(el, src);
      return true;
    } catch(e){ return false; }
  }

  function rmsFrom(timeData){
    let sum = 0;
    for (let i=0;i<timeData.length;i++){
      const v = (timeData[i]-128)/128;
      sum += v*v;
    }
    return Math.sqrt(sum / timeData.length);
  }

  function canSeek(el){ return Number.isFinite(el.duration) && el.seekable && el.seekable.length>0 && el.readyState >= 3; }
  function safeSeek(el, t){ 
    try { 
      if (!canSeek(el)) return false;
      const end = el.duration - 0.5;
      const clamped = Math.max(0, Math.min(t, end));
      if (!Number.isFinite(clamped)) return false;
      el.currentTime = clamped; 
      SD.lastSeekAt = performance.now();
      return true; 
    } catch(e){ return false; }
  }

  function isCrossfading(){
    try {
      const a1 = state?.a1, a2 = state?.a2;
      if (!a1 || !a2) return false;
      return (!a1.paused && !a2.paused);
    } catch(_) { return false; }
  }

  function start(el){
    if (!SD.enabled) return;
    if (!connect(el)) return;
    try { SD.ctx.resume && SD.ctx.resume(); } catch(_){}
    const timeBuf = new Uint8Array(SD.analyser.fftSize);
    let silentAccum = 0;

    if (!SD.flags.has(el)) SD.flags.set(el, {tailDone:false});

    stop();
    SD.iv = setInterval(()=>{
      try {
        if (el.paused) return;
        if (isCrossfading()) return;
        if (el.readyState < 2) return;

        SD.analyser.getByteTimeDomainData(timeBuf);
        const rms = rmsFrom(timeBuf);

        const now = performance.now();
        const dt = SD.sampleInterval/1000;
        const sinceLastSeek = (now - SD.lastSeekAt)/1000;

        if (rms < SD.rmsThreshold) silentAccum += dt; else silentAccum = 0;

        const dur = isFinite(el.duration) ? el.duration : null;
        const cur = el.currentTime;
        const rem = dur ? (dur - cur) : null;

        const flags = SD.flags.get(el);

        // COLA endurecida: única corrección y sólo si hay silencio claro y queda muy poco
        if (!flags.tailDone && rem !== null && rem < SD.tailNearSecs && silentAccum >= (SD.tailSilenceWindow + SD.confirmExtraTail) && sinceLastSeek >= SD.seekCooldownSecs) {
          if (dur && safeSeek(el, Math.max(0, dur - SD.tailSeekBack))) {
            flags.tailDone = true;
            silentAccum = 0;
            return;
          }
        }

      } catch(e){ /* sin logs */ }
    }, SD.sampleInterval);
  }

  function stop(){
    if (SD.iv) { clearInterval(SD.iv); SD.iv = null; }
  }

  try {
    [state.a1, state.a2].forEach(a => {
      a.addEventListener('playing', () => start(a));
      a.addEventListener('pause', stop);
      a.addEventListener('ended', stop);
      a.addEventListener('emptied', stop);
      a.addEventListener('error', ()=>{ try{ const f = SD.flags.get(a); if (f) { f.tailDone = true; } }catch(_){}});
    });
  } catch(e){}

  try { state._silenceCtl = { start, stop }; } catch(_){}
})();
/* === End Auto-skip Silence === */

/* === Mini/Media reconcile helpers === */
function __normSrc(u){ try { return String(u||'').replace(/[?#].*$/, ''); } catch(_) { return String(u||''); } }
function __findIdxByActiveSrc(){
    try{
        const el = activeEl && activeEl();
        if (!el || !state || !Array.isArray(state.tracks)) return -1;
        const src = __normSrc(el.currentSrc || el.src || '');
        if (!src) return -1;
        for (let i=0; i<state.tracks.length; i++){
            const t = state.tracks[i];
            if (t && t.url && __normSrc(t.url) === src) return i;
        }
    }catch(e){}
    return -1;
}
function reconcileIdxAndUI(){
    try{
        if (document.hidden) return;
        const i = __findIdxByActiveSrc();
        if (i >= 0 && i !== state.idx) { state.idx = i; }
        try { setUIPlaying && setUIPlaying(); } catch(_){}
        try { updateMediaMetadata && updateMediaMetadata(state.tracks[state.idx]); } catch(_){}
    }catch(e){}
}
/* === end reconcile helpers === */

/* === Unlock/visibility -> reconcile & poke === */
function __onVisReconcileStrict(){
    try{
        if (!document.hidden){
            try { reconcileIdxAndUI && reconcileIdxAndUI(); } catch(_){}
            setTimeout(function(){
                try { ensureNoSilence && ensureNoSilence(20000); } catch(_){}
            }, 30);
        }
    }catch(e){}
}
document.addEventListener('visibilitychange', __onVisReconcileStrict);
window.addEventListener('focus', __onVisReconcileStrict);
window.addEventListener('pageshow', __onVisReconcileStrict);
/* === end unlock reconcile === */

/* === ensureNoSilence: soft resume without violating user pause === */
function ensureNoSilence(maxMs){
    try{
        if (!state || state._userPaused) return;
        const el = activeEl && activeEl();
        if (!el || !el.paused) return;
        try{
            if (el.readyState >= 2) { el.play && el.play().catch(()=>{}); }
            else { el.load && el.load(); el.play && el.play().catch(()=>{}); }
        }catch(_) {}
        if (el.paused) { try{ ensureBGAutoplay && ensureBGAutoplay(maxMs||20000); }catch(_){ } }
    }catch(e){}
}
/* === end ensureNoSilence === */

/* === Header metrics var for mobile layout === */
function updateHeaderVars(){
    try{
        const h = document.querySelector('header')?.offsetHeight || 64;
        document.documentElement.style.setProperty('--header-h', h + 'px');
    }catch(_){}
}
window.addEventListener('load', updateHeaderVars, { once:true });
window.addEventListener('resize', updateHeaderVars);
window.addEventListener('orientationchange', updateHeaderVars);
/* === end header metrics === */
