// Ferramentas de análise: cabeçalho, histograma, estatísticas e clusters.

import { h, aviso, baixar, fmt, semExtensao } from './util.js'

/** Abre um <dialog> modal temporário. Devolve o elemento (remove-se ao fechar). */
export function dialogo(titulo, conteudo, acoes = [], { largo = false } = {}) {
  const dlg = h(
    'dialog',
    { class: 'dlg' + (largo ? ' largo' : '') },
    h('header', { class: 'dlg-topo' }, h('h2', {}, titulo), h('button', { class: 'btn-x', 'aria-label': 'Fechar', onclick: () => dlg.close() }, '×')),
    h('div', { class: 'dlg-corpo' }, conteudo),
    h(
      'footer',
      { class: 'dlg-rodape' },
      acoes.map((a) => h('button', { class: 'btn' + (a.primario ? ' primario' : ''), onclick: () => a.acao(dlg) }, a.rotulo)),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Fechar')
    )
  )
  dlg.addEventListener('close', () => dlg.remove())
  document.body.append(dlg)
  dlg.showModal()
  return dlg
}

const TIPOS = {
  2: 'UINT8', 4: 'INT16', 8: 'INT32', 16: 'FLOAT32', 32: 'COMPLEX64', 64: 'FLOAT64', 128: 'RGB24',
  256: 'INT8', 512: 'UINT16', 768: 'UINT32', 1024: 'INT64', 1280: 'UINT64', 2304: 'RGBA32'
}
const FORMA = { 0: 'Desconhecido', 1: 'Scanner', 2: 'Alinhado', 3: 'Talairach', 4: 'MNI 152', 5: 'Modelo' }
const UNIDADE_ESPACO = { 0: '?', 1: 'm', 2: 'mm', 3: 'µm' }
const UNIDADE_TEMPO = { 0: '', 8: 's', 16: 'ms', 24: 'µs', 32: 'Hz', 40: 'ppm', 48: 'rad/s' }

function linhasCabecalho(vol) {
  const c = vol.hdr
  if (!c) return [['Erro', 'Imagem sem cabeçalho']]
  const d = c.dims || []
  const p = c.pixDims || []
  const texto = (v) => String(v ?? '').replace(/\0/g, '').trim()
  const linhas = [
    ['Arquivo', vol.name],
    ['Dimensões (X×Y×Z×T)', `${d[1]} × ${d[2]} × ${d[3]}${d[4] > 1 ? ' × ' + d[4] : ''}`],
    ['Tamanho do voxel', `${fmt(p[1], 4)} × ${fmt(p[2], 4)} × ${fmt(p[3], 4)} ${UNIDADE_ESPACO[c.xyzt_units & 7] || 'mm'}`],
    ['TR (4ª dimensão)', d[4] > 1 ? `${fmt(p[4], 4)} ${UNIDADE_TEMPO[c.xyzt_units & 56] || ''}` : '—'],
    ['Tipo de dado', `${TIPOS[c.datatypeCode] || c.datatypeCode} (${c.numBitsPerVoxel} bits)`],
    ['Escala (slope / intercept)', `${fmt(c.scl_slope, 6)} / ${fmt(c.scl_inter, 6)}`],
    ['Faixa de exibição do cabeçalho (cal_min / cal_max)', `${fmt(c.cal_min, 4)} / ${fmt(c.cal_max, 4)}`],
    ['Faixa de intensidade do volume', `${fmt(vol.global_min, 4)} … ${fmt(vol.global_max, 4)}`],
    ['Descrição', texto(c.description) || '—'],
    ['Arquivo auxiliar', texto(c.aux_file) || '—'],
    ['Intenção', `${c.intent_code ?? 0}${texto(c.intent_name) ? ' (' + texto(c.intent_name) + ')' : ''}`],
    ['QForm', FORMA[c.qform_code] ?? c.qform_code],
    ['SForm', FORMA[c.sform_code] ?? c.sform_code],
    ['Quaternion (b, c, d)', `${fmt(c.quatern_b, 5)}, ${fmt(c.quatern_c, 5)}, ${fmt(c.quatern_d, 5)}`],
    ['Deslocamento Q (x, y, z)', `${fmt(c.qoffset_x, 3)}, ${fmt(c.qoffset_y, 3)}, ${fmt(c.qoffset_z, 3)}`],
    ['Deslocamento dos dados (vox_offset)', c.vox_offset],
    ['Pouco significativo primeiro (little-endian)', c.littleEndian ? 'sim' : 'não']
  ]
  const a = c.affine
  if (a) for (let i = 0; i < 3; i++) linhas.push([`Afim, linha ${'XYZ'[i]}`, a[i].map((v) => fmt(v, 4)).join('   ')])
  if (Number.isFinite(vol.oblique_angle)) linhas.push(['Ângulo de obliquidade', `${fmt(vol.oblique_angle, 2)}°`])
  return linhas
}

export function mostrarCabecalho(vol) {
  const linhas = linhasCabecalho(vol)
  const tabela = h('table', { class: 'tabela chave-valor' }, h('tbody', {}, linhas.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, String(v))))))
  dialogo('Informações do cabeçalho NIfTI', tabela, [
    {
      rotulo: 'Salvar como texto',
      acao: () => baixar(new Blob([linhas.map(([k, v]) => `${k}\t${v}`).join('\n')], { type: 'text/plain' }), semExtensao(vol.name) + '_cabecalho.txt')
    }
  ])
}

/** Fatia (visão) do volume 3D atual de uma imagem 4D, sem copiar. */
function quadroAtual(vol) {
  const d = vol.hdr.dims
  const n = d[1] * d[2] * d[3]
  const q = Math.min(vol.frame4D || 0, Math.max(0, Math.floor(vol.img.length / n) - 1))
  return vol.img.subarray(q * n, q * n + n)
}

const escala = (vol) => {
  const s = Number.isFinite(vol.hdr.scl_slope) && vol.hdr.scl_slope !== 0 ? vol.hdr.scl_slope : 1
  const i = Number.isFinite(vol.hdr.scl_inter) ? vol.hdr.scl_inter : 0
  return [s, i]
}

export function mostrarHistograma(nv, indice) {
  const vol = nv.volumes[indice]
  if (!vol) return
  if ([128, 2304].includes(vol.hdr.datatypeCode)) {
    aviso('Histograma não disponível para imagens RGB.', 'erro')
    return
  }
  const img = quadroAtual(vol)
  const [s, i0] = escala(vol)
  let mn = Infinity
  let mx = -Infinity
  const passo = Math.max(1, Math.floor(img.length / 8e6))
  for (let i = 0; i < img.length; i += passo) {
    const v = img[i]
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  mn = mn * s + i0
  mx = mx * s + i0
  if (!(mx > mn)) {
    aviso('A imagem tem intensidade constante.', 'erro')
    return
  }
  const N = 256
  const contagem = new Float64Array(N)
  const k = (N - 1) / (mx - mn)
  for (let i = 0; i < img.length; i += passo) contagem[Math.round((img[i] * s + i0 - mn) * k)]++

  const tela = h('canvas', { width: 720, height: 300, class: 'histograma', role: 'img', 'aria-label': 'Histograma de intensidade' })
  const usarLog = h('input', { type: 'checkbox', checked: true })
  const ignorarZero = h('input', { type: 'checkbox', checked: true })
  const desenhar = () => {
    const g = tela.getContext('2d')
    const W = tela.width
    const H = tela.height
    const m = { e: 12, d: 12, t: 10, b: 30 }
    g.fillStyle = '#10151b'
    g.fillRect(0, 0, W, H)
    const dados = Array.from(contagem)
    if (ignorarZero.checked && mn <= 0 && mx >= 0) dados[Math.round((0 - mn) * k)] = 0
    const f = (v) => (usarLog.checked ? Math.log10(1 + v) : v)
    const topo = Math.max(...dados.map(f)) || 1
    const lw = (W - m.e - m.d) / N
    g.fillStyle = '#7fb4e6'
    for (let b = 0; b < N; b++) {
      const alt = (f(dados[b]) / topo) * (H - m.t - m.b)
      g.fillRect(m.e + b * lw, H - m.b - alt, Math.max(1, lw - 0.5), alt)
    }
    // faixa de exibição atual (mais escuro / mais claro)
    for (const [val, cor] of [[vol.cal_min, '#f5c451'], [vol.cal_max, '#f5c451']]) {
      if (val < mn || val > mx) continue
      const x = m.e + (val - mn) * k * lw
      g.strokeStyle = cor
      g.setLineDash([5, 4])
      g.beginPath()
      g.moveTo(x, m.t)
      g.lineTo(x, H - m.b)
      g.stroke()
    }
    g.setLineDash([])
    g.fillStyle = '#c9d4df'
    g.font = '12px system-ui, sans-serif'
    g.textAlign = 'left'
    g.fillText(fmt(mn, 2), m.e, H - 10)
    g.textAlign = 'center'
    g.fillText(fmt((mn + mx) / 2, 2), W / 2, H - 10)
    g.textAlign = 'right'
    g.fillText(fmt(mx, 2), W - m.d, H - 10)
  }
  usarLog.addEventListener('change', desenhar)
  ignorarZero.addEventListener('change', desenhar)
  desenhar()
  dialogo(
    `Histograma de intensidade — ${vol.name}`,
    h(
      'div',
      {},
      tela,
      h('div', { class: 'linha-opcoes' }, h('label', {}, usarLog, ' Escala logarítmica'), h('label', {}, ignorarZero, ' Ignorar voxels com valor zero')),
      h('p', { class: 'suave pequeno' }, `Linhas tracejadas: faixa de exibição atual (${fmt(vol.cal_min)} a ${fmt(vol.cal_max)}).` + (passo > 1 ? ` Amostragem de 1 a cada ${passo} voxels.` : ''))
    ),
    [
      {
        rotulo: 'Salvar como texto',
        acao: () => {
          const linhas = ['intensidade\tcontagem', ...Array.from(contagem, (c, b) => `${mn + b / k}\t${c}`)]
          baixar(new Blob([linhas.join('\n')], { type: 'text/plain' }), semExtensao(vol.name) + '_histograma.txt')
        }
      }
    ],
    { largo: true }
  )
}

export function mostrarEstatisticas(nv) {
  if (!nv.volumes.length) return
  const temDesenho = !!nv.drawBitmap && nv.drawBitmap.some((v) => v > 0)
  const colunas = [
    ['Camada', (d, v) => v.name],
    ['Voxels', (d) => d.nvox],
    ['Volume (mL)', (d) => fmt(d.volumeML, 3)],
    ['Média', (d) => fmt(d.mean, 4)],
    ['Desvio-padrão', (d) => fmt(d.stdev, 4)],
    ['Mínimo', (d) => fmt(d.min, 4)],
    ['Máximo', (d) => fmt(d.max, 4)],
    ['Média (≠0)', (d) => fmt(d.meanNot0, 4)],
    ['DP (≠0)', (d) => fmt(d.stdevNot0, 4)],
    ['Voxels (≠0)', (d) => d.nvoxNot0]
  ]
  const montar = (mascara) => {
    const linhas = []
    nv.volumes.forEach((v, i) => {
      try {
        const d = nv.getDescriptives({ layer: i, drawingIsMask: mascara })
        linhas.push(colunas.map(([, f]) => f(d, v)))
      } catch (erro) {
        linhas.push([v.name, 'não calculado: ' + erro.message])
      }
    })
    return linhas
  }
  const blocos = []
  const texto = []
  const adicionar = (titulo, linhas) => {
    blocos.push(h('h3', {}, titulo), h('div', { class: 'rolagem-x' }, h('table', { class: 'tabela' }, h('thead', {}, h('tr', {}, colunas.map(([c]) => h('th', {}, c)))), h('tbody', {}, linhas.map((l) => h('tr', {}, l.map((c) => h('td', {}, String(c)))))))))
    texto.push(titulo, colunas.map(([c]) => c).join('\t'), ...linhas.map((l) => l.join('\t')), '')
  }
  if (temDesenho) adicionar('Dentro do desenho (região de interesse)', montar(true))
  adicionar('Volume inteiro', montar(false))
  if (!temDesenho) blocos.push(h('p', { class: 'suave pequeno' }, 'Desenhe uma região de interesse (painel Desenho) para obter as estatísticas restritas a ela.'))
  dialogo('Estatísticas descritivas', h('div', {}, blocos), [
    { rotulo: 'Copiar tabela', acao: () => copiar(texto.join('\n')) },
    { rotulo: 'Salvar como texto', acao: () => baixar(new Blob([texto.join('\n')], { type: 'text/plain' }), 'estatisticas.txt') }
  ], { largo: true })
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto)
    aviso('Copiado para a área de transferência.', 'ok')
  } catch {
    aviso('O navegador bloqueou a cópia. Use "Salvar como texto".', 'erro')
  }
}

/**
 * Rotula componentes conexos acima (ou abaixo, se limiar < 0) do limiar.
 * @returns {{n: number, rotulos: Uint32Array, clusters: object[]}}
 */
export function rotularClusters(nv, indice, limiar, vizinhos = 26) {
  const vol = nv.volumes[indice]
  const d = vol.hdr.dims
  const dim = Uint32Array.from([d[1], d[2], d[3]])
  const img = quadroAtual(vol)
  const [s, i0] = escala(vol)
  const bin = new Uint32Array(img.length)
  if (limiar >= 0) for (let i = 0; i < img.length; i++) bin[i] = img[i] * s + i0 > limiar ? 1 : 0
  else for (let i = 0; i < img.length; i++) bin[i] = img[i] * s + i0 < limiar ? 1 : 0
  const [n, rotulos] = nv.bwlabel(bin, dim, vizinhos, false, false)
  const p = vol.hdr.pixDims
  const mm3 = Math.abs(p[1] * p[2] * p[3])
  const clusters = Array.from({ length: n + 1 }, (_, r) => ({ rotulo: r, voxels: 0, pico: limiar >= 0 ? -Infinity : Infinity, iPico: 0, soma: 0, sx: 0, sy: 0, sz: 0 }))
  const nx = dim[0]
  const nxy = dim[0] * dim[1]
  for (let i = 0; i < rotulos.length; i++) {
    const r = rotulos[i]
    if (!r) continue
    const c = clusters[r]
    const v = img[i] * s + i0
    c.voxels++
    c.soma += v
    c.sx += i % nx
    c.sy += Math.floor((i % nxy) / nx)
    c.sz += Math.floor(i / nxy)
    if (limiar >= 0 ? v > c.pico : v < c.pico) {
      c.pico = v
      c.iPico = i
    }
  }
  const a = vol.hdr.affine
  const paraMM = (x, y, z) => [0, 1, 2].map((l) => a[l][0] * x + a[l][1] * y + a[l][2] * z + a[l][3])
  const lista = clusters
    .slice(1)
    .filter((c) => c.voxels > 0)
    .map((c) => ({
      ...c,
      mm3: c.voxels * mm3,
      media: c.soma / c.voxels,
      picoMM: paraMM(c.iPico % nx, Math.floor((c.iPico % nxy) / nx), Math.floor(c.iPico / nxy)),
      centroMM: paraMM(c.sx / c.voxels, c.sy / c.voxels, c.sz / c.voxels)
    }))
    .sort((x, y) => y.voxels - x.voxels)
  return { n, rotulos, clusters: lista }
}

function formularioClusters(nv, indicePadrao, comTamanho = true) {
  const camada = h('select', {}, nv.volumes.map((v, i) => h('option', { value: i, selected: i === indicePadrao }, `${i}: ${v.name}`)))
  const volIni = nv.volumes[indicePadrao]
  const limiar = h('input', { type: 'number', step: 'any', value: fmt(volIni.cal_min, 4) })
  const minimo = h('input', { type: 'number', step: 'any', min: 0, value: 32 })
  const viz = h('select', {}, h('option', { value: 6 }, 'Faces (6)'), h('option', { value: 18 }, 'Faces + arestas (18)'), h('option', { value: 26, selected: true }, 'Faces + arestas + vértices (26)'))
  camada.addEventListener('change', () => (limiar.value = fmt(nv.volumes[Number(camada.value)].cal_min, 4)))
  const forma = h(
    'div',
    { class: 'grade-form' },
    h('label', {}, 'Camada', camada),
    h('label', {}, 'Limiar de intensidade', limiar),
    comTamanho ? h('label', {}, 'Tamanho mínimo (mm³)', minimo) : null,
    h('label', {}, 'Vizinhança', viz),
    h('p', { class: 'suave pequeno span2' }, 'Limiar positivo: voxels acima dele. Limiar negativo: voxels abaixo dele (ativações negativas).')
  )
  return { forma, ler: () => ({ indice: Number(camada.value), limiar: Number(limiar.value), minimo: Number(minimo.value) || 0, vizinhos: Number(viz.value) }) }
}

export function tabelaDeClusters(nv, indicePadrao, irPara) {
  if (!nv.volumes.length) return
  const { forma, ler } = formularioClusters(nv, indicePadrao)
  const saida = h('div', { class: 'rolagem-x' })
  let texto = ''
  const gerar = () => {
    const o = ler()
    const { clusters } = rotularClusters(nv, o.indice, o.limiar, o.vizinhos)
    const lista = clusters.filter((c) => c.mm3 >= o.minimo)
    if (!lista.length) {
      saida.replaceChildren(h('p', { class: 'suave' }, 'Nenhum cluster atende aos critérios.'))
      texto = ''
      return
    }
    const cab = ['#', 'Volume (mm³)', 'Voxels', 'Pico', 'Média', 'Pico X', 'Pico Y', 'Pico Z (mm)', 'Centro de massa (mm)']
    const linhas = lista.map((c, i) => [i + 1, fmt(c.mm3, 1), c.voxels, fmt(c.pico, 3), fmt(c.media, 3), ...c.picoMM.map((v) => fmt(v, 1)), c.centroMM.map((v) => fmt(v, 1)).join(', ')])
    texto = [cab.join('\t'), ...linhas.map((l) => l.join('\t'))].join('\n')
    saida.replaceChildren(
      h('p', { class: 'suave pequeno' }, `${lista.length} cluster(s). Clique em uma linha para levar a mira ao pico.`),
      h(
        'table',
        { class: 'tabela clicavel' },
        h('thead', {}, h('tr', {}, cab.map((c) => h('th', {}, c)))),
        h('tbody', {}, linhas.map((l, i) => h('tr', { tabIndex: 0, onclick: () => irPara(lista[i].picoMM), onkeydown: (e) => e.key === 'Enter' && irPara(lista[i].picoMM) }, l.map((c) => h('td', {}, String(c))))))
      )
    )
  }
  dialogo('Tabela de clusters', h('div', {}, forma, h('div', { class: 'linha-botoes' }, h('button', { class: 'btn primario', onclick: gerar }, 'Gerar tabela')), saida), [
    { rotulo: 'Copiar tabela', acao: () => (texto ? copiar(texto) : aviso('Gere a tabela primeiro.')) },
    { rotulo: 'Salvar como texto', acao: () => (texto ? baixar(new Blob([texto], { type: 'text/plain' }), 'clusters.txt') : aviso('Gere a tabela primeiro.')) }
  ], { largo: true })
}

/** Zera voxels fora dos clusters que passam do limiar e do tamanho mínimo. */
export function aplicarRemocaoDeClusters(nv, indice, limiar, minimoMM3, vizinhos = 26) {
  const vol = nv.volumes[indice]
  const { rotulos, clusters } = rotularClusters(nv, indice, limiar, vizinhos)
  const manter = new Uint8Array(rotulos.reduce((m, r) => (r > m ? r : m), 0) + 1)
  let mantidos = 0
  for (const c of clusters) {
    if (c.mm3 >= minimoMM3) {
      manter[c.rotulo] = 1
      mantidos++
    }
  }
  const img = quadroAtual(vol)
  for (let i = 0; i < img.length; i++) if (!manter[rotulos[i]]) img[i] = 0
  nv.updateGLVolume()
  return { mantidos, removidos: clusters.length - mantidos }
}

export function removerClustersPequenos(nv, indicePadrao, aoTerminar) {
  if (!nv.volumes.length) return
  const { forma, ler } = formularioClusters(nv, indicePadrao)
  dialogo(
    'Remover clusters pequenos',
    h('div', {}, forma, h('p', { class: 'suave pequeno' }, 'Altera a imagem em memória: voxels abaixo do limiar ou em clusters menores que o tamanho mínimo passam a zero. O arquivo original não é modificado; use "Salvar volume" para guardar o resultado.')),
    [
      {
        rotulo: 'Aplicar',
        primario: true,
        acao: (dlg) => {
          const o = ler()
          const r = aplicarRemocaoDeClusters(nv, o.indice, o.limiar, o.minimo, o.vizinhos)
          dlg.close()
          aviso(`${r.mantidos} cluster(s) mantido(s), ${r.removidos} removido(s).`, 'ok')
          aoTerminar?.()
        }
      }
    ]
  )
}
