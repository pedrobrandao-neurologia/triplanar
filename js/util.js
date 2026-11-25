// Utilitários compartilhados do Triplanar.

export const $ = (sel, raiz = document) => raiz.querySelector(sel)
export const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel))

/** Cria um elemento: h('button', { class: 'x', onclick: fn }, 'texto', outroElemento) */
export function h(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v)
    else if (k === 'class') e.className = v
    else if (k === 'dataset') Object.assign(e.dataset, v)
    else if (k in e && k !== 'list' && k !== 'form') e[k] = v
    else e.setAttribute(k, v === true ? '' : v)
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue
    e.append(f instanceof Node ? f : String(f))
  }
  return e
}

export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: nome, style: 'display:none' })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

let caixaAvisos = null
/** Aviso temporário no canto da tela. tipo: 'info' | 'ok' | 'erro' */
export function aviso(msg, tipo = 'info', ms = 4500) {
  if (!caixaAvisos) {
    caixaAvisos = h('div', { id: 'avisos', role: 'status', 'aria-live': 'polite' })
    document.body.append(caixaAvisos)
  }
  // Dentro de um <dialog> modal o aviso precisa estar na camada superior para ser visto.
  const modal = document.querySelector('dialog[open]')
  const destino = modal || document.body
  if (caixaAvisos.parentNode !== destino) destino.append(caixaAvisos)
  const el = h('div', { class: `aviso ${tipo}` }, msg)
  caixaAvisos.append(el)
  setTimeout(() => el.remove(), tipo === 'erro' ? Math.max(ms, 8000) : ms)
}

export const prefs = {
  get(chave, padrao) {
    try {
      const v = localStorage.getItem('triplanar.' + chave)
      return v === null ? padrao : JSON.parse(v)
    } catch {
      return padrao
    }
  },
  set(chave, valor) {
    try {
      localStorage.setItem('triplanar.' + chave, JSON.stringify(valor))
    } catch {
      /* armazenamento indisponível (janela privada): segue sem persistir */
    }
  }
}

/** Número legível: até `casas` decimais, sem zeros à direita. */
export function fmt(n, casas = 2) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  const abs = Math.abs(v)
  if (abs !== 0 && (abs < 0.001 || abs >= 1e7)) return v.toExponential(3)
  return String(Number(v.toFixed(casas)))
}

export function tamanhoLegivel(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export const semExtensao = (nome) => nome.replace(/\.(nii\.gz|nii|nrrd|nhdr|mgz|mgh|mif|mha|mhd|head|hdr|img|v|v16|vmr|gz)$/i, '')

// ---------- DICOM ----------

const EXT_DICOM = /\.(dcm|dicom|ima)$/i
const EXT_NAO_DICOM = /\.(nii|gz|nrrd|nhdr|mgz|mgh|mif|mha|mhd|json|txt|bval|bvec|png|jpg|jpeg|pdf|html?|xml|zip|js|csv|tsv|exe|dll)$/i

/**
 * Um arquivo é DICOM pela extensão, pela assinatura "DICM" no byte 128 ou por não ter extensão
 * (todo formato de imagem aceito pelo visualizador tem uma; DICOM antigo pode vir sem assinatura).
 */
export async function ehDicom(arquivo) {
  if (EXT_DICOM.test(arquivo.name)) return true
  if (EXT_NAO_DICOM.test(arquivo.name)) return false
  if (arquivo.size < 132) return false
  if (!/\.[a-z][a-z0-9]{0,4}$/i.test(arquivo.name)) return true
  try {
    const b = new Uint8Array(await arquivo.slice(128, 132).arrayBuffer())
    return b[0] === 0x44 && b[1] === 0x49 && b[2] === 0x43 && b[3] === 0x4d
  } catch {
    return false
  }
}

// ---------- ZIP (gravação sem compressão e leitura com DecompressionStream) ----------

let tabelaCrc = null
export function crc32(u8) {
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      tabelaCrc[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < u8.length; i++) crc = tabelaCrc[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Monta um .zip "store" (sem recompressão: os .nii.gz já estão comprimidos).
 * @param {{nome: string, dados: Uint8Array}[]} arquivos
 */
export function criarZip(arquivos) {
  const enc = new TextEncoder()
  const agora = new Date()
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1)
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate()
  const partes = []
  const central = []
  let deslocamento = 0
  for (const { nome, dados } of arquivos) {
    const nomeBytes = enc.encode(nome)
    const crc = crc32(dados)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // nomes em UTF-8
    local.setUint16(8, 0, true)
    local.setUint16(10, hora, true)
    local.setUint16(12, data, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, dados.length, true)
    local.setUint32(22, dados.length, true)
    local.setUint16(26, nomeBytes.length, true)
    local.setUint16(28, 0, true)
    partes.push(new Uint8Array(local.buffer), nomeBytes, dados)

    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, hora, true)
    c.setUint16(14, data, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, dados.length, true)
    c.setUint32(24, dados.length, true)
    c.setUint16(28, nomeBytes.length, true)
    c.setUint32(42, deslocamento, true)
    central.push(new Uint8Array(c.buffer), nomeBytes)
    deslocamento += 30 + nomeBytes.length + dados.length
  }
  if (deslocamento > 0xfffffff0) throw new Error('O conjunto passa de 4 GB: baixe os arquivos individualmente.')
  const tamCentral = central.reduce((s, p) => s + p.length, 0)
  const fim = new DataView(new ArrayBuffer(22))
  fim.setUint32(0, 0x06054b50, true)
  fim.setUint16(8, arquivos.length, true)
  fim.setUint16(10, arquivos.length, true)
  fim.setUint32(12, tamCentral, true)
  fim.setUint32(16, deslocamento, true)
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/zip' })
}

/** Lê um .zip e devolve seus arquivos como File (com _webkitRelativePath, usado pelo dcm2niix). */
export async function lerZip(arquivoZip) {
  const tam = arquivoZip.size
  const cauda = new Uint8Array(await arquivoZip.slice(Math.max(0, tam - 66000)).arrayBuffer())
  let p = -1
  for (let i = cauda.length - 22; i >= 0; i--) {
    if (cauda[i] === 0x50 && cauda[i + 1] === 0x4b && cauda[i + 2] === 0x05 && cauda[i + 3] === 0x06) {
      p = i
      break
    }
  }
  if (p < 0) throw new Error('Arquivo .zip inválido (diretório central não encontrado).')
  const fim = new DataView(cauda.buffer, p)
  const total = fim.getUint16(10, true)
  const tamCentral = fim.getUint32(12, true)
  const inicioCentral = fim.getUint32(16, true)
  if (inicioCentral === 0xffffffff) throw new Error('Arquivos .zip64 (maiores que 4 GB) não são suportados.')
  const central = new DataView(await arquivoZip.slice(inicioCentral, inicioCentral + tamCentral).arrayBuffer())
  const dec = new TextDecoder()
  const pasta = arquivoZip.name.replace(/\.zip$/i, '')
  const saida = []
  let o = 0
  for (let n = 0; n < total; n++) {
    if (central.getUint32(o, true) !== 0x02014b50) break
    const metodo = central.getUint16(o + 10, true)
    const tamComp = central.getUint32(o + 20, true)
    const lenNome = central.getUint16(o + 28, true)
    const lenExtra = central.getUint16(o + 30, true)
    const lenComent = central.getUint16(o + 32, true)
    const posLocal = central.getUint32(o + 42, true)
    const nome = dec.decode(new Uint8Array(central.buffer, o + 46, lenNome))
    o += 46 + lenNome + lenExtra + lenComent
    if (nome.endsWith('/') || /(^|\/)(__MACOSX\/|\.DS_Store$)/.test(nome)) continue
    const cab = new DataView(await arquivoZip.slice(posLocal, posLocal + 30).arrayBuffer())
    const inicio = posLocal + 30 + cab.getUint16(26, true) + cab.getUint16(28, true)
    const bruto = arquivoZip.slice(inicio, inicio + tamComp)
    let blob
    if (metodo === 0) blob = bruto
    else if (metodo === 8) blob = await new Response(bruto.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()
    else throw new Error(`Método de compressão ${metodo} não suportado em "${nome}".`)
    const f = new File([blob], nome.split('/').pop())
    f._webkitRelativePath = `${pasta}/${nome}`
    saida.push(f)
  }
  return saida
}

/** Percorre itens soltos (arquivos e pastas), preservando o caminho relativo. */
export async function arquivosDoDrop(dataTransfer) {
  const entradas = []
  for (const item of dataTransfer.items || []) {
    const e = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
    if (e) entradas.push(e)
  }
  if (!entradas.length) return Array.from(dataTransfer.files || [])
  const saida = []
  const andar = (entrada, caminho) =>
    new Promise((resolve, reject) => {
      if (entrada.isFile) {
        entrada.file((f) => {
          f._webkitRelativePath = caminho + f.name
          saida.push(f)
          resolve()
        }, reject)
      } else if (entrada.isDirectory) {
        const leitor = entrada.createReader()
        const lote = () =>
          leitor.readEntries((itens) => {
            if (!itens.length) return resolve()
            Promise.all(itens.map((i) => andar(i, `${caminho}${entrada.name}/`)))
              .then(lote)
              .catch(reject)
          }, reject)
        lote()
      } else resolve()
    })
  await Promise.all(entradas.map((e) => andar(e, '')))
  return saida
}
