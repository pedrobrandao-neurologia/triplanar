// Service worker do Triplanar: guarda o aplicativo para uso offline.
// Os arquivos do app se atualizam sozinhos (uma visita depois da publicação). Troque VERSAO ao
// atualizar a pasta vendor/ ou a lista ARQUIVOS, para refazer o cache inteiro.
const VERSAO = 'triplanar-1.0.0'
const CACHE_APP = `${VERSAO}-app`
const CACHE_IMAGENS = 'triplanar-imagens-padrao' // sobrevive às atualizações do app

const ARQUIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/util.js',
  'js/dicom.js',
  'js/ferramentas.js',
  'js/script.js',
  'vendor/niivue/niivue.min.js',
  'vendor/dcm2niix/index.jpeg.js',
  'vendor/dcm2niix/worker.jpeg.js',
  'vendor/dcm2niix/dcm2niix.jpeg.js',
  'vendor/dcm2niix/dcm2niix.jpeg.wasm',
  'icons/icone.svg',
  'icons/icone-192.png',
  'icons/icone-512.png',
  'icons/icone-mascara-512.png'
]

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_APP)
      .then((cache) => cache.addAll(ARQUIVOS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE_APP && n !== CACHE_IMAGENS).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (evento) => {
  const req = evento.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Imagens-padrão (repositório do MRIcroGL): baixa uma vez e reutiliza offline.
  if (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('/Resources/standard/')) {
    evento.respondWith(
      caches.open(CACHE_IMAGENS).then(async (cache) => {
        const guardada = await cache.match(req)
        if (guardada) return guardada
        const resposta = await fetch(req)
        if (resposta.ok) cache.put(req, resposta.clone())
        return resposta
      })
    )
    return
  }

  if (url.origin !== self.location.origin) return

  // Aplicativo: responde do cache na hora e atualiza a cópia em segundo plano, de modo que a
  // visita seguinte já recebe a versão nova. A pasta vendor/ só muda quando VERSAO muda.
  evento.respondWith(
    caches.open(CACHE_APP).then(async (cache) => {
      const guardada = await cache.match(req, { ignoreSearch: true })
      const fixo = url.pathname.includes('/vendor/')
      const daRede = () =>
        fetch(req).then((resposta) => {
          if (resposta.ok && guardada) cache.put(new Request(url.origin + url.pathname), resposta.clone())
          return resposta
        })
      if (guardada) {
        if (!fixo) evento.waitUntil(daRede().catch(() => {}))
        return guardada
      }
      try {
        return await fetch(req)
      } catch (erro) {
        if (req.mode === 'navigate') {
          const inicio = await cache.match('index.html')
          if (inicio) return inicio
        }
        throw erro
      }
    })
  )
})
