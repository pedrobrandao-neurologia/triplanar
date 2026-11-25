// Triplanar — aplicativo principal.
// Visualização por NiiVue (WebGL2) e conversão DICOM → NIfTI por dcm2niix (WebAssembly),
// os equivalentes web, de código aberto, do MRIcroGL.

import { Niivue, NVImage, SLICE_TYPE } from '../vendor/niivue/niivue.min.js'
import { $, $$, h, aviso, baixar, prefs, fmt, semExtensao, ehDicom, arquivosDoDrop } from './util.js'
import { configurarConversor, abrirConversor, converterParaVisualizar, expandirZips } from './dicom.js'
import { dialogo, mostrarCabecalho, mostrarHistograma, mostrarEstatisticas, tabelaDeClusters, removerClustersPequenos } from './ferramentas.js'
import { EXEMPLOS, executarScript } from './script.js'

const VERSAO = '1.0.0'
const MOSTRAR_3D = { nunca: 0, sempre: 1, auto: 2 }
const LAYOUT_GRADE = 2
const LAYOUT_AUTO = 0

// Imagens de exemplo distribuídas com o MRIcroGL; baixadas sob demanda e guardadas para uso offline.
const BASE_PADRAO = 'https://raw.githubusercontent.com/rordenlab/MRIcroGL/master/Resources/standard/'
const PADROES = [
  { id: 'mni152', rotulo: 'MNI152 — T1 (4,3 MB)' },
  { id: 'spm152', rotulo: 'SPM152 — T1 (4,1 MB)' },
  { id: 'chris_t2', rotulo: 'T2 individual (4,3 MB)' },
  { id: 'chris_MRA', rotulo: 'Angio-RM (0,1 MB)' },
  { id: 'CT_Philips', rotulo: 'Tomografia de crânio (7,8 MB)' },
  { id: 'CT_Abdo', rotulo: 'Angiotomografia de tórax e abdome (7,8 MB)' },
  { id: 'spmMotor', rotulo: 'Mapa estatístico de fMRI motor (0,4 MB)', sobrepor: true }
]
const CORES_SOBREPOSICAO = ['warm', 'winter', 'redyell', 'bluegrn', 'cool', 'violet', 'red', 'blue', 'green']
const CORES_CANETA = [
  { valor: 0, nome: 'Apagar', css: 'transparent', texto: '⌫' },
  { valor: 1, nome: 'Vermelho', css: '#ff0000' },
  { valor: 2, nome: 'Verde', css: '#00c000' },
  { valor: 3, nome: 'Azul', css: '#0040ff' },
  { valor: 4, nome: 'Amarelo', css: '#ffff00' },
  { valor: 5, nome: 'Ciano', css: '#00ffff' },
  { valor: 6, nome: 'Magenta', css: '#ff00ff' }
]

const estado = {
  camadaAtiva: 0,
  visao: 'mpr',
  caneta: 1,
  animacao: null,
  scriptAtual: null
}

const tela = $('#tela')
const nv = new Niivue({
  backColor: [0, 0, 0, 1],
  show3Dcrosshair: true,
  isColorbar: false,
  dragAndDropEnabled: false,
  loadingText: '',
  logLevel: 'warn',
  multiplanarShowRender: MOSTRAR_3D.nunca,
  clipPlaneColor: [0, 0, 0, 0],
  crosshairWidthUnit: 'percent', // proporcional ao campo de visão: não engrossa em imagens de baixa resolução
  crosshairWidth: 0.5,
  isResizeCanvas: true
})

// ====================================================================== ocupado / erros

function ocupar(texto) {
  $('#ocupado-texto').textContent = texto
  $('#ocupado').hidden = false
}
function desocupar() {
  $('#ocupado').hidden = true
}
const erroLegivel = (e) => (e && (e.message || String(e))) || 'erro desconhecido'

// ====================================================================== carregar imagens

function proximaCor(posicao) {
  const disponiveis = nv.colormaps()
  const nome = CORES_SOBREPOSICAO[(Math.max(1, posicao) - 1) % CORES_SOBREPOSICAO.length]
  return disponiveis.includes(nome) ? nome : 'warm'
}

/** Troca o esquema de cores sem perder a faixa de exibição (o NiiVue a recalcula na troca). */
function definirCores(vol, nome) {
  const [mn, mx] = [vol.cal_min, vol.cal_max]
  vol.colormap = nome
  vol.cal_min = mn
  vol.cal_max = mx
  nv.updateGLVolume()
}

/**
 * Sobreposição com valores negativos e positivos (mapa estatístico): começa mostrando só o terço
 * superior dos valores positivos; senão o limiar negativo coloriria o volume inteiro.
 */
function limiarInicial(img) {
  if (img.global_min < 0 && img.global_max > 0 && img.cal_min <= 0) {
    img.cal_min = img.global_max / 3
    img.cal_max = img.global_max
  }
}

/** Abre arquivos locais (NIfTI e afins, DICOM, .zip). Com sobrepor=true, mantém o que está aberto. */
async function carregarArquivos(lista, { sobrepor = false } = {}) {
  let arquivos = Array.from(lista || [])
  if (!arquivos.length) return
  ocupar('Lendo arquivos…')
  try {
    arquivos = await expandirZips(arquivos)
    const dicoms = []
    const outros = []
    for (const f of arquivos) ((await ehDicom(f)) ? dicoms : outros).push(f)

    const porNome = new Map(outros.map((f) => [f.name.toLowerCase(), f]))
    const imagens = []
    for (const f of outros) {
      const n = f.name.toLowerCase()
      if (/\.(json|bval|bvec|txt|tsv|csv|xml|pdf|png|jpe?g)$/.test(n)) continue
      if (/\.img(\.gz)?$/.test(n) && porNome.has(n.replace(/\.img(\.gz)?$/, '.hdr'))) continue
      if (/\.brik(\.gz)?$/.test(n)) continue
      if (/\.raw(\.gz)?$/.test(n)) continue
      let par = null
      if (n.endsWith('.hdr')) par = porNome.get(n.replace(/\.hdr$/, '.img')) || porNome.get(n.replace(/\.hdr$/, '.img.gz'))
      if (n.endsWith('.head')) par = porNome.get(n.replace(/\.head$/, '.brik')) || porNome.get(n.replace(/\.head$/, '.brik.gz'))
      imagens.push({ file: f, par })
    }

    if (dicoms.length) {
      ocupar(`Convertendo ${dicoms.length} arquivo(s) DICOM…`)
      const convertidas = await converterParaVisualizar(dicoms, (p) => ocupar(`Convertendo DICOM… ${Math.round(p * 100)}%`))
      if (convertidas.length > 1 && !imagens.length) {
        desocupar()
        escolherSerie(convertidas, sobrepor)
        return
      }
      imagens.push(...convertidas.map((file) => ({ file })))
    }
    if (!imagens.length) throw new Error('Nenhuma imagem reconhecida nos arquivos escolhidos.')
    await adicionarImagens(imagens, sobrepor)
  } catch (erro) {
    console.error(erro)
    aviso(`Não foi possível abrir: ${erroLegivel(erro)}`, 'erro')
  } finally {
    desocupar()
  }
}

async function adicionarImagens(imagens, sobrepor) {
  // Lê tudo antes de fechar o que está aberto: se a leitura falhar, nada se perde.
  const base = sobrepor ? nv.volumes.length : 0
  const carregadas = []
  for (const { file, par } of imagens) {
    ocupar(`Abrindo ${file.name}…`)
    const posicao = base + carregadas.length
    try {
      carregadas.push(
        await NVImage.loadFromFile({
          file,
          name: file.name,
          urlImgData: par || null,
          colormap: posicao === 0 ? 'gray' : proximaCor(posicao),
          opacity: 1
        })
      )
    } catch (erro) {
      console.error(erro)
      aviso(`${file.name}: ${erroLegivel(erro)}`, 'erro')
    }
  }
  if (!carregadas.length) return
  if (!sobrepor) fecharTudo(false)
  for (const img of carregadas) {
    if (nv.volumes.length > 0) limiarInicial(img)
    nv.addVolume(img)
  }
  estado.camadaAtiva = sobrepor ? nv.volumes.length - 1 : 0
  aposCarregar()
}

function escolherSerie(imagens, sobrepor) {
  const dlg = dialogo(
    'Séries DICOM encontradas',
    h(
      'div',
      {},
      h('p', { class: 'suave' }, `Foram convertidas ${imagens.length} séries. Escolha qual abrir.`),
      h(
        'ul',
        { class: 'lista-resultados' },
        imagens.map((f) =>
          h(
            'li',
            { class: 'resultado' },
            h('div', { class: 'resultado-nome' }, h('strong', {}, semExtensao(f.name))),
            h(
              'div',
              { class: 'linha-botoes' },
              h('button', { class: 'btn primario', onclick: () => abrir(f, sobrepor) }, sobrepor ? 'Sobrepor' : 'Abrir'),
              !sobrepor ? h('button', { class: 'btn', onclick: () => abrir(f, true) }, 'Adicionar como sobreposição') : null,
              h('button', { class: 'btn', onclick: () => baixar(f, f.name) }, 'Baixar NIfTI')
            )
          )
        )
      )
    )
  )
  async function abrir(f, comoSobreposicao) {
    dlg.close()
    try {
      await adicionarImagens([{ file: f }], comoSobreposicao && nv.volumes.length > 0)
    } finally {
      desocupar()
    }
  }
}

async function carregarUrl(url, { sobrepor = false, nome } = {}) {
  ocupar(`Baixando ${nome || url.split('/').pop()}…`)
  try {
    const posicao = sobrepor ? nv.volumes.length : 0
    const img = await NVImage.loadFromUrl({ url, name: nome || url.split('/').pop(), colormap: posicao === 0 ? 'gray' : proximaCor(posicao), opacity: 1 })
    if (!sobrepor) fecharTudo(false)
    if (nv.volumes.length > 0) limiarInicial(img)
    nv.addVolume(img)
    estado.camadaAtiva = nv.volumes.length - 1
    aposCarregar()
  } finally {
    desocupar()
  }
}

/** Nome de imagem-padrão (mni152, spmMotor…) ou URL http(s). Usado pelos menus e pelos scripts. */
async function carregarPorNome(nome, sobrepor) {
  const limpo = String(nome).replace(/\.nii(\.gz)?$/i, '')
  const padrao = PADROES.find((p) => p.id.toLowerCase() === limpo.toLowerCase())
  if (padrao) return carregarUrl(`${BASE_PADRAO}${padrao.id}.nii.gz`, { sobrepor, nome: `${padrao.id}.nii.gz` })
  if (/^https?:\/\//i.test(nome)) return carregarUrl(String(nome), { sobrepor })
  throw new Error(`"${nome}" não é uma imagem-padrão nem um endereço http(s). Arquivos locais são abertos pelo menu Arquivo.`)
}

async function abrirPadrao(padrao) {
  try {
    const sobrepor = !!padrao.sobrepor && nv.volumes.length > 0
    if (padrao.sobrepor && !nv.volumes.length) await carregarPorNome('spm152', false)
    await carregarPorNome(padrao.id, padrao.sobrepor ? true : sobrepor)
    if (padrao.id === 'spmMotor') {
      const v = nv.volumes.at(-1)
      v.cal_min = 3
      v.cal_max = 8
      nv.updateGLVolume()
      atualizar()
    }
  } catch (erro) {
    aviso(`Não foi possível baixar a imagem (${erroLegivel(erro)}). As imagens-padrão exigem internet no primeiro uso.`, 'erro')
  }
}

function fecharTudo(redesenhar = true) {
  pararAnimacao()
  if (nv.drawBitmap) nv.closeDrawing()
  for (const v of [...nv.volumes].reverse()) nv.removeVolume(v)
  estado.camadaAtiva = 0
  if (redesenhar) aposCarregar()
}

function fecharSobreposicoes() {
  for (const v of nv.volumes.slice(1).reverse()) nv.removeVolume(v)
  estado.camadaAtiva = 0
  atualizar()
}

function aposCarregar() {
  const tem = nv.volumes.length > 0
  $('#vazio').hidden = tem
  if (tem && estado.camadaAtiva >= nv.volumes.length) estado.camadaAtiva = nv.volumes.length - 1
  document.title = tem ? `${nv.volumes[0].name} — Triplanar` : 'Triplanar — visualizador NIfTI e conversor DICOM'
  if (!tem) {
    $('#st-pos').textContent = '—'
    $('#st-valor').textContent = ''
  }
  atualizar()
  nv.drawScene()
  if (tem) nv.createOnLocationChange()
}

// ====================================================================== painel: camadas

function atualizar() {
  desenharCamadas()
  sincronizarControles()
}

function desenharCamadas() {
  const lista = $('#lista-camadas')
  const vols = nv.volumes
  $('#sem-camadas').hidden = vols.length > 0
  $('#props-camada').hidden = vols.length === 0
  lista.replaceChildren(
    ...vols.map((v, i) =>
      h(
        'li',
        { class: 'camada' + (i === estado.camadaAtiva ? ' ativa' : '') },
        h(
          'button',
          { class: 'nome', title: v.name, 'aria-pressed': String(i === estado.camadaAtiva), onclick: () => selecionarCamada(i) },
          h('span', { class: 'papel', title: i === 0 ? 'Imagem de fundo' : `Sobreposição ${i}` }, i === 0 ? 'F' : String(i)),
          h('span', { class: 'sr' }, i === 0 ? 'Fundo: ' : `Sobreposição ${i}: `),
          v.name
        ),
        h('button', { class: 'mini', title: v.opacity > 0 ? 'Ocultar' : 'Mostrar', 'aria-label': v.opacity > 0 ? 'Ocultar camada' : 'Mostrar camada', onclick: () => alternarVisivel(i) }, v.opacity > 0 ? '●' : '○'),
        h('button', { class: 'mini', title: 'Subir', 'aria-label': 'Mover camada para cima', disabled: i === vols.length - 1, onclick: () => moverCamada(i, 1) }, '↑'),
        h('button', { class: 'mini', title: 'Descer', 'aria-label': 'Mover camada para baixo', disabled: i === 0, onclick: () => moverCamada(i, -1) }, '↓'),
        h('button', { class: 'mini', title: 'Fechar camada', 'aria-label': 'Fechar camada', onclick: () => fecharCamada(i) }, '✕')
      )
    )
  )
  const v = vols[estado.camadaAtiva]
  if (!v) return
  const sel = $('#cam-cores')
  if (!sel.options.length) {
    sel.replaceChildren(...nv.colormaps().sort((a, b) => a.localeCompare(b)).map((c) => h('option', { value: c }, c)))
  }
  sel.value = v.colormap
  const neg = $('#cam-neg')
  if (neg.options.length < 2) neg.append(...nv.colormaps().sort((a, b) => a.localeCompare(b)).map((c) => h('option', { value: c }, c)))
  neg.value = v.colormapNegative || ''
  if (document.activeElement !== $('#cam-min')) $('#cam-min').value = fmt(v.cal_min, 4)
  if (document.activeElement !== $('#cam-max')) $('#cam-max').value = fmt(v.cal_max, 4)
  $('#cam-opac').value = v.opacity
  $('#cam-opac-v').textContent = `${Math.round(v.opacity * 100)}%`
  $('#cam-inverter').checked = !!v.colormapInvert
  $('#cam-barra').checked = v.colorbarVisible !== false
  const quadros = v.nFrame4D || 1
  $('#cam-4d').hidden = quadros < 2
  if (quadros > 1) {
    $('#cam-quadro').max = quadros - 1
    $('#cam-quadro').value = v.frame4D || 0
    $('#cam-quadro-v').textContent = `${(v.frame4D || 0) + 1} / ${quadros}`
  }
}

function selecionarCamada(i) {
  estado.camadaAtiva = i
  atualizar()
}

let opacidadeAnterior = new WeakMap()
function alternarVisivel(i) {
  const v = nv.volumes[i]
  if (v.opacity > 0) {
    opacidadeAnterior.set(v, v.opacity)
    nv.setOpacity(i, 0)
  } else nv.setOpacity(i, opacidadeAnterior.get(v) || 1)
  atualizar()
}

function moverCamada(i, direcao) {
  const v = nv.volumes[i]
  if (direcao > 0) nv.moveVolumeUp(v)
  else nv.moveVolumeDown(v)
  estado.camadaAtiva = nv.volumes.indexOf(v)
  atualizar()
}

function fecharCamada(i) {
  if (i === 0 && nv.volumes.length === 1) return fecharTudo()
  if (i === 0 && nv.drawBitmap) nv.closeDrawing()
  nv.removeVolume(nv.volumes[i])
  estado.camadaAtiva = Math.min(estado.camadaAtiva, nv.volumes.length - 1)
  aposCarregar()
}

const ativa = () => nv.volumes[estado.camadaAtiva]

function ligarPainelCamadas() {
  $('#cam-cores').addEventListener('change', (e) => ativa() && definirCores(ativa(), e.target.value))
  $('#cam-neg').addEventListener('change', (e) => ativa() && nv.setColormapNegative(ativa().id, e.target.value))
  const faixa = () => {
    const v = ativa()
    const mn = Number($('#cam-min').value)
    const mx = Number($('#cam-max').value)
    if (!v || !Number.isFinite(mn) || !Number.isFinite(mx)) return
    v.cal_min = mn
    v.cal_max = mx
    nv.updateGLVolume()
  }
  $('#cam-min').addEventListener('change', faixa)
  $('#cam-max').addEventListener('change', faixa)
  $('#cam-opac').addEventListener('input', (e) => {
    if (!ativa()) return
    nv.setOpacity(estado.camadaAtiva, Number(e.target.value))
    $('#cam-opac-v').textContent = `${Math.round(e.target.value * 100)}%`
  })
  $('#cam-opac').addEventListener('change', desenharCamadas)
  $('#cam-inverter').addEventListener('change', (e) => {
    if (!ativa()) return
    ativa().colormapInvert = e.target.checked
    nv.updateGLVolume()
  })
  $('#cam-barra').addEventListener('change', (e) => {
    if (!ativa()) return
    ativa().colorbarVisible = e.target.checked
    nv.updateGLVolume()
  })
  $('#cam-quadro').addEventListener('input', (e) => {
    const v = ativa()
    if (!v) return
    nv.setFrame4D(v.id, Number(e.target.value))
    $('#cam-quadro-v').textContent = `${Number(e.target.value) + 1} / ${v.nFrame4D}`
  })
  $('#cam-animar').addEventListener('click', () => (estado.animacao ? pararAnimacao() : iniciarAnimacao()))
  $('#cam-grafico').addEventListener('click', (e) => {
    const ligar = e.currentTarget.getAttribute('aria-pressed') !== 'true'
    e.currentTarget.setAttribute('aria-pressed', String(ligar))
    nv.graph.autoSizeMultiplanar = true
    nv.graph.normalizeValues = false
    nv.graph.opacity = ligar ? 1 : 0
    if (ligar) definirVisao('mpr')
    nv.updateGLVolume()
  })
  $('#cam-reset').addEventListener('click', () => {
    const v = ativa()
    if (!v) return
    v.cal_min = v.robust_min ?? v.global_min
    v.cal_max = v.robust_max ?? v.global_max
    nv.updateGLVolume()
    desenharCamadas()
  })
  $('#cam-cab').addEventListener('click', () => ativa() && mostrarCabecalho(ativa()))
  $('#cam-hist').addEventListener('click', () => ativa() && mostrarHistograma(nv, estado.camadaAtiva))
}

function iniciarAnimacao() {
  const v = ativa()
  if (!v || (v.nFrame4D || 1) < 2) return
  $('#cam-animar').setAttribute('aria-pressed', 'true')
  $('#cam-animar').textContent = '■ Parar'
  estado.animacao = setInterval(() => {
    const alvo = ativa()
    if (!alvo || (alvo.nFrame4D || 1) < 2) return pararAnimacao()
    const prox = ((alvo.frame4D || 0) + 1) % alvo.nFrame4D
    nv.setFrame4D(alvo.id, prox)
    $('#cam-quadro').value = prox
    $('#cam-quadro-v').textContent = `${prox + 1} / ${alvo.nFrame4D}`
  }, 150)
}
function pararAnimacao() {
  if (estado.animacao) clearInterval(estado.animacao)
  estado.animacao = null
  $('#cam-animar').setAttribute('aria-pressed', 'false')
  $('#cam-animar').textContent = '▶ Animar'
}

// ====================================================================== visões

function definirVisao(id) {
  if (id === 'mosaico') return dialogoMosaico()
  estado.visao = id
  nv.opts.sagittalNoseLeft = id === 'sagitalE'
  if (nv.sliceMosaicString) nv.setSliceMosaicString('')
  nv.opts.multiplanarShowRender = id === 'mpr3d' ? MOSTRAR_3D.sempre : MOSTRAR_3D.nunca
  nv.setMultiplanarLayout(id === 'mpr3d' ? LAYOUT_GRADE : LAYOUT_AUTO)
  const tipo = { mpr: SLICE_TYPE.MULTIPLANAR, mpr3d: SLICE_TYPE.MULTIPLANAR, axial: SLICE_TYPE.AXIAL, coronal: SLICE_TYPE.CORONAL, sagital: SLICE_TYPE.SAGITTAL, sagitalE: SLICE_TYPE.SAGITTAL, render: SLICE_TYPE.RENDER }[id]
  nv.setSliceType(tipo ?? SLICE_TYPE.MULTIPLANAR)
  marcarVisao()
  if (id === 'render' || id === 'mpr3d') $('#sec-3d').open = true
}

function definirMosaico(texto) {
  estado.visao = 'mosaico'
  nv.opts.sagittalNoseLeft = false
  nv.setSliceType(SLICE_TYPE.MULTIPLANAR)
  nv.setSliceMosaicString(texto)
  prefs.set('mosaico', texto)
  marcarVisao()
}

function marcarVisao() {
  for (const b of $$('.visao')) b.classList.toggle('ativo', b.dataset.visao === estado.visao || (estado.visao === 'sagitalE' && b.dataset.visao === 'sagital'))
}

/** Gera o texto de mosaico (mesma sintaxe do MRIcroGL): orientação, posições em mm e ";" entre linhas. */
function textoMosaico({ orientacao, fatias, linhas, rotulos, referencia }) {
  const v = nv.volumes[0]
  const eixo = { A: 2, C: 1, S: 0 }[orientacao]
  const mn = v?.extentsMinOrtho?.[eixo] ?? -70
  const mx = v?.extentsMaxOrtho?.[eixo] ?? 70
  const ini = mn + (mx - mn) * 0.15
  const fim = mn + (mx - mn) * 0.85
  const pos = Array.from({ length: fatias }, (_, i) => Math.round(fatias === 1 ? (ini + fim) / 2 : ini + ((fim - ini) * i) / (fatias - 1)))
  const porLinha = Math.ceil(fatias / Math.max(1, linhas))
  const partes = []
  for (let i = 0; i < pos.length; i += porLinha) partes.push(pos.slice(i, i + porLinha).join(' '))
  let texto = `${orientacao} ${rotulos ? 'L+ ' : 'L- '}${partes.join(' ; ')}`
  if (referencia) texto += ` ${orientacao === 'S' ? 'A' : 'S'} X R 0`
  return texto
}

function dialogoMosaico() {
  if (!nv.volumes.length) return aviso('Abra uma imagem primeiro.')
  const orientacao = h('select', {}, h('option', { value: 'A' }, 'Axial'), h('option', { value: 'C' }, 'Coronal'), h('option', { value: 'S' }, 'Sagital'))
  const fatias = h('input', { type: 'number', min: 1, max: 48, value: 12 })
  const linhas = h('input', { type: 'number', min: 1, max: 8, value: 3 })
  const rotulos = h('input', { type: 'checkbox', checked: true })
  const referencia = h('input', { type: 'checkbox', checked: true })
  const texto = h('input', { type: 'text', spellcheck: false, value: prefs.get('mosaico', '') })
  const gerar = () => (texto.value = textoMosaico({ orientacao: orientacao.value, fatias: Math.max(1, Number(fatias.value) || 1), linhas: Math.max(1, Number(linhas.value) || 1), rotulos: rotulos.checked, referencia: referencia.checked }))
  for (const c of [orientacao, fatias, linhas, rotulos, referencia]) c.addEventListener('change', gerar)
  if (!texto.value) gerar()
  dialogo(
    'Mosaico de fatias',
    h(
      'div',
      {},
      h('div', { class: 'grade-form' }, h('label', {}, 'Orientação', orientacao), h('label', {}, 'Número de fatias', fatias), h('label', {}, 'Linhas', linhas), h('div', { class: 'linha-opcoes coluna' }, h('label', {}, rotulos, ' Rótulos com a posição (mm)'), h('label', {}, referencia, ' Imagem de referência com as linhas de corte')), h('label', { class: 'span2' }, 'Texto do mosaico (editável)', texto)),
      h('p', { class: 'suave pequeno' }, 'Sintaxe: A, C ou S escolhem a orientação; os números são posições em mm; ";" começa nova linha; L+ mostra rótulos; "X R 0" acrescenta uma renderização com as linhas de corte.')
    ),
    [{ rotulo: 'Aplicar', primario: true, acao: (dlg) => (definirMosaico(texto.value.trim()), dlg.close()) }]
  )
}

// ====================================================================== painel: 2D, 3D, desenho

const hexParaRgba = (hex) => [1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16) / 255).concat(1)
const rgbaParaHex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')

const OPCOES_SALVAS = ['isRadiologicalConvention', 'isColorbar', 'isRuler', 'isOrientCube', 'isOrientationTextVisible', 'isSliceMM', 'isAdditiveBlend', 'isNearestInterpolation', 'crosshairWidth', 'crosshairColor', 'backColor']
function salvarOpcoes() {
  prefs.set('opcoes', Object.fromEntries(OPCOES_SALVAS.map((k) => [k, nv.opts[k]])))
}

function definirOpcao(chave, valor) {
  switch (chave) {
    case 'suave': nv.setInterpolation(!valor); break
    case 'isRadiologicalConvention': nv.setRadiologicalConvention(valor); break
    case 'isSliceMM': nv.setSliceMM(valor); break
    case 'isAdditiveBlend': nv.setAdditiveBlend(valor); break
    case 'isOrientationTextVisible': nv.setIsOrientationTextVisible(valor); break
    default: nv.opts[chave] = valor
  }
  nv.drawScene()
  salvarOpcoes()
}

function lerOpcao(chave) {
  return chave === 'suave' ? !nv.opts.isNearestInterpolation : !!nv.opts[chave]
}

function sincronizarControles() {
  for (const c of $$('[data-opt]')) c.checked = lerOpcao(c.dataset.opt)
  $('#mira').value = nv.opts.crosshairWidth
  $('#mira-v').textContent = nv.opts.crosshairWidth
  $('#mira-cor').value = rgbaParaHex(nv.opts.crosshairColor)
  $('#fundo-cor').value = rgbaParaHex(nv.opts.backColor)
  $('#gama-v').textContent = fmt(nv.scene.gamma ?? 1, 2)
  $('#gama').value = nv.scene.gamma ?? 1
  const clip = nv.scene.clipPlaneDepthAziElevs?.[0] || [2, 0, 0]
  const ligado = clip[0] < 1.8
  $('#clip-ligado').checked = ligado
  if (ligado) {
    $('#clip-prof').value = clip[0]
    $('#clip-azi').value = ((clip[1] % 360) + 360) % 360
    $('#clip-elev').value = clip[2]
  }
  $('#clip-recorte').checked = !!nv.opts.isClipPlanesCutaway
  $('#cam-azi').value = ((nv.scene.renderAzimuth % 360) + 360) % 360
  $('#cam-elev').value = nv.scene.renderElevation
  $('#luz').value = Math.max(0, nv.opts.gradientAmount || 0)
  $('#borda').value = nv.opts.gradientOpacity || 0
  for (const [id, sufixo] of [['clip-prof', ''], ['clip-azi', '°'], ['clip-elev', '°'], ['cam-azi', '°'], ['cam-elev', '°'], ['luz', ''], ['borda', '']]) {
    $(`#${id}-v`).textContent = fmt(Number($(`#${id}`).value), 2) + sufixo
  }
  $('#des-ligado').checked = !!nv.opts.drawingEnabled
  $('#des-tam-v').textContent = nv.opts.penSize
  $('#des-opac-v').textContent = `${Math.round(nv.drawOpacity * 100)}%`
  $('#sel-arrasto').value = { 1: 'contrast', 2: 'measurement', 3: 'pan', 4: 'slicer3D', 7: 'angle' }[nv.opts.dragMode] || 'contrast'
}

function aplicarCorte() {
  if (!$('#clip-ligado').checked) nv.setClipPlane([2, 0, 0])
  else nv.setClipPlane([Number($('#clip-prof').value), Number($('#clip-azi').value), Number($('#clip-elev').value)])
  for (const [id, sufixo] of [['clip-prof', ''], ['clip-azi', '°'], ['clip-elev', '°']]) $(`#${id}-v`).textContent = fmt(Number($(`#${id}`).value), 2) + sufixo
}

function ligarPainelExibicao() {
  for (const c of $$('[data-opt]')) c.addEventListener('change', () => definirOpcao(c.dataset.opt, c.checked))
  $('#mira').addEventListener('input', (e) => {
    nv.setCrosshairWidth(Number(e.target.value))
    $('#mira-v').textContent = e.target.value
    salvarOpcoes()
  })
  $('#mira-cor').addEventListener('input', (e) => (nv.setCrosshairColor(hexParaRgba(e.target.value)), salvarOpcoes()))
  $('#fundo-cor').addEventListener('input', (e) => definirOpcao('backColor', hexParaRgba(e.target.value)))
  $('#gama').addEventListener('input', (e) => {
    nv.setGamma(Number(e.target.value))
    $('#gama-v').textContent = fmt(Number(e.target.value), 2)
  })

  for (const id of ['clip-prof', 'clip-azi', 'clip-elev']) {
    $(`#${id}`).addEventListener('input', () => {
      $('#clip-ligado').checked = true
      aplicarCorte()
    })
  }
  $('#clip-ligado').addEventListener('change', aplicarCorte)
  $('#clip-recorte').addEventListener('change', (e) => {
    nv.opts.isClipPlanesCutaway = e.target.checked
    nv.drawScene()
  })
  const camera = () => {
    nv.setRenderAzimuthElevation(Number($('#cam-azi').value), Number($('#cam-elev').value))
    $('#cam-azi-v').textContent = $('#cam-azi').value + '°'
    $('#cam-elev-v').textContent = $('#cam-elev').value + '°'
  }
  $('#cam-azi').addEventListener('input', camera)
  $('#cam-elev').addEventListener('input', camera)
  for (const b of $$('[data-camera]')) {
    b.addEventListener('click', () => {
      const [a, e] = b.dataset.camera.split(',').map(Number)
      nv.setRenderAzimuthElevation(a, e)
      if (!['render', 'mpr3d'].includes(estado.visao)) definirVisao('render')
      sincronizarControles()
    })
  }
  $('#luz').addEventListener('input', async (e) => {
    $('#luz-v').textContent = fmt(Number(e.target.value), 2)
    await nv.setVolumeRenderIllumination(Number(e.target.value))
  })
  $('#borda').addEventListener('input', async (e) => {
    $('#borda-v').textContent = fmt(Number(e.target.value), 2)
    await nv.setGradientOpacity(Number(e.target.value))
  })
  $('#sel-arrasto').addEventListener('change', (e) => nv.setDragMode(e.target.value))
}

function definirCaneta(valor) {
  estado.caneta = valor
  nv.setPenValue(valor, $('#des-cheio').checked)
  for (const b of $$('#des-cores button')) b.setAttribute('aria-checked', String(Number(b.dataset.valor) === valor))
}

function ativarDesenho(ligar) {
  if (ligar && !nv.volumes.length) {
    $('#des-ligado').checked = false
    return aviso('Abra uma imagem antes de desenhar.')
  }
  nv.setDrawingEnabled(ligar)
  if (ligar) definirCaneta(estado.caneta)
  $('#des-ligado').checked = ligar
}

function temDesenho() {
  return !!nv.drawBitmap && nv.drawBitmap.some((v) => v > 0)
}

async function salvarDesenho() {
  if (!temDesenho()) return aviso('Não há desenho para salvar.')
  const nome = `${semExtensao(nv.volumes[0].name)}_voi.nii.gz`
  const bytes = await nv.volumes[0].saveToUint8Array(nome, nv.drawBitmap)
  baixar(new Blob([bytes], { type: 'application/gzip' }), nome)
}

async function abrirDesenho(arquivo) {
  if (!nv.volumes.length) return aviso('Abra a imagem de fundo antes do desenho.')
  try {
    const img = await NVImage.loadFromFile({ file: arquivo, name: arquivo.name })
    if (!nv.loadDrawing(img)) throw new Error('as dimensões do desenho não coincidem com as da imagem de fundo')
    nv.drawScene()
    aviso('Desenho carregado.', 'ok')
  } catch (erro) {
    aviso(`Não foi possível abrir o desenho: ${erroLegivel(erro)}`, 'erro')
  }
}

function ligarPainelDesenho() {
  $('#des-cores').replaceChildren(
    ...CORES_CANETA.map((c) =>
      h('button', { role: 'radio', title: c.nome, 'aria-label': c.nome, 'aria-checked': String(c.valor === estado.caneta), dataset: { valor: c.valor }, style: `background:${c.css}`, onclick: () => (ativarDesenho(true), definirCaneta(c.valor)) }, c.texto || '')
    )
  )
  $('#des-ligado').addEventListener('change', (e) => ativarDesenho(e.target.checked))
  $('#des-forma').addEventListener('change', (e) => (nv.opts.penType = Number(e.target.value)))
  $('#des-tam').addEventListener('input', (e) => {
    nv.opts.penSize = Number(e.target.value)
    $('#des-tam-v').textContent = e.target.value
  })
  $('#des-cheio').addEventListener('change', () => definirCaneta(estado.caneta))
  $('#des-sobrescrever').addEventListener('change', (e) => (nv.drawFillOverwrites = e.target.checked))
  $('#des-clique').addEventListener('change', (e) => {
    nv.opts.clickToSegment = e.target.checked
    if (e.target.checked) ativarDesenho(true)
  })
  $('#des-opac').addEventListener('input', (e) => {
    nv.setDrawOpacity(Number(e.target.value))
    $('#des-opac-v').textContent = `${Math.round(e.target.value * 100)}%`
  })
  $('#des-desfazer').addEventListener('click', () => nv.drawUndo())
  $('#des-interpolar').addEventListener('click', () => {
    if (!temDesenho()) return aviso('Desenhe em pelo menos duas fatias antes de interpolar.')
    try {
      nv.drawAddUndoBitmap()
      nv.interpolateMaskSlices()
      nv.drawScene()
    } catch (erro) {
      aviso(`Interpolação: ${erroLegivel(erro)}`, 'erro')
    }
  })
  $('#des-crescer').addEventListener('click', () => {
    if (!temDesenho()) return aviso('Desenhe sementes de pelo menos duas cores (por exemplo, lesão e tecido normal) antes de crescer.')
    nv.drawGrowCut()
    nv.drawScene()
  })
  $('#des-auto').addEventListener('click', () => {
    if (!nv.volumes.length) return aviso('Abra uma imagem primeiro.')
    nv.drawOtsu(Number($('#des-otsu').value))
    nv.drawScene()
  })
  $('#des-abrir').addEventListener('click', () => $('#inp-voi').click())
  $('#inp-voi').addEventListener('change', (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (f) abrirDesenho(f)
  })
  $('#des-salvar').addEventListener('click', salvarDesenho)
  $('#des-fechar').addEventListener('click', () => {
    if (nv.drawBitmap) nv.closeDrawing()
    nv.drawScene()
  })
  $('#des-stats').addEventListener('click', () => (nv.volumes.length ? mostrarEstatisticas(nv) : aviso('Abra uma imagem primeiro.')))
}

// ====================================================================== salvar / capturar

async function salvarVolume(indice, nomeSugerido) {
  const v = nv.volumes[indice]
  if (!v) return aviso('Não há imagem para salvar.')
  let nome = nomeSugerido
  if (!nome) {
    nome = prompt('Nome do arquivo (.nii ou .nii.gz):', `${semExtensao(v.name)}.nii.gz`)
    if (!nome) return
  }
  if (!/\.nii(\.gz)?$/i.test(nome)) nome += '.nii.gz'
  ocupar('Gravando NIfTI…')
  try {
    const bytes = await v.saveToUint8Array(nome)
    baixar(new Blob([bytes], { type: 'application/octet-stream' }), nome)
  } catch (erro) {
    aviso(`Não foi possível salvar: ${erroLegivel(erro)}`, 'erro')
  } finally {
    desocupar()
  }
}

function blobDaTela() {
  nv.drawScene() // o WebGL só garante o conteúdo no mesmo quadro em que foi desenhado
  return new Promise((resolve) => tela.toBlob(resolve, 'image/png'))
}

async function capturar(nome = 'triplanar.png') {
  const blob = await blobDaTela()
  if (blob) baixar(blob, /\.png$/i.test(nome) ? nome : nome.replace(/\.\w+$/, '') + '.png')
}

async function copiarImagem() {
  try {
    const blob = await blobDaTela()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    aviso('Imagem copiada para a área de transferência.', 'ok')
  } catch {
    aviso('O navegador não permitiu copiar a imagem. Use "Salvar captura de tela".', 'erro')
  }
}

function telaCheia(ligar) {
  if (ligar && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
  else if (!ligar && document.fullscreenElement) document.exitFullscreen?.()
}

function painelVisivel(ligar) {
  document.body.classList.toggle('sem-painel', !ligar)
  $('#btn-painel').setAttribute('aria-pressed', String(ligar))
  prefs.set('painel', ligar)
  requestAnimationFrame(() => nv.resizeListener())
}

function irParaMM(mm) {
  nv.scene.crosshairPos = nv.mm2frac(mm)
  nv.createOnLocationChange()
  nv.drawScene()
}

function redefinir() {
  pararAnimacao()
  nv.opts.sagittalNoseLeft = false
  nv.opts.isClipPlanesCutaway = false
  nv.opts.backColor = [0, 0, 0, 1]
  nv.opts.isColorbar = false
  nv.opts.isRuler = false
  nv.opts.isOrientCube = false
  nv.setCrosshairColor([1, 0, 0, 1])
  nv.setCrosshairWidth(0.5)
  nv.setInterpolation(false)
  nv.setAdditiveBlend(false)
  nv.setClipPlane([2, 0, 0])
  nv.setRenderAzimuthElevation(110, 10)
  nv.setScale(1)
  nv.setGamma(1)
  nv.graph.opacity = 0
  $('#cam-grafico').setAttribute('aria-pressed', 'false')
  ativarDesenho(false)
  definirVisao('mpr')
  salvarOpcoes()
  atualizar()
}

// ====================================================================== ferramentas

function removerNevoa() {
  if (!nv.volumes.length) return aviso('Abra uma imagem primeiro.')
  const nivel = h('select', {}, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, selected: n === 5 }, `${n}${n === 1 ? ' (remove mais)' : n === 5 ? ' (remove menos, padrão)' : ''}`)))
  dialogo('Remover névoa do fundo', h('div', {}, h('p', {}, 'Zera os voxels escuros ao redor do objeto (ar, ruído), o que limpa a renderização 3D. Altera a imagem de fundo em memória; o arquivo original não muda.'), h('label', { class: 'campo' }, 'Limiar', nivel)), [
    {
      rotulo: 'Aplicar',
      primario: true,
      acao: (dlg) => {
        nv.removeHaze(Number(nivel.value), 0)
        nv.drawScene()
        dlg.close()
        atualizar()
      }
    }
  ])
}

async function conformar() {
  const v = nv.volumes[0]
  if (!v) return aviso('Abra uma imagem primeiro.')
  ocupar('Reamostrando para 256³ a 1 mm…')
  try {
    await new Promise((r) => setTimeout(r, 30))
    const novo = await nv.conform(v, false, true, false, true)
    novo.name = `${semExtensao(v.name)}_conformado.nii.gz`
    fecharTudo(false)
    nv.addVolume(novo)
    aposCarregar()
    aviso('Imagem reamostrada para 256×256×256 voxels de 1 mm (8 bits).', 'ok')
  } catch (erro) {
    aviso(`Não foi possível reamostrar: ${erroLegivel(erro)}`, 'erro')
  } finally {
    desocupar()
  }
}

function sobre() {
  dialogo(
    'Sobre o Triplanar',
    h(
      'div',
      {},
      h('p', {}, h('strong', {}, `Triplanar ${VERSAO}`), ' — visualizador de neuroimagem e conversor DICOM → NIfTI que roda inteiro no navegador e funciona offline depois de instalado.'),
      h('p', {}, 'As imagens são lidas e processadas no seu aparelho. Nenhum arquivo é enviado a servidores.'),
      h('p', {}, h('strong', {}, 'Uso exclusivo para pesquisa e ensino. Não é um dispositivo médico e não deve ser usado para diagnóstico.')),
      h('h3', {}, 'Componentes de código aberto'),
      h(
        'ul',
        {},
        h('li', {}, h('a', { href: 'https://github.com/niivue/niivue', target: '_blank', rel: 'noopener' }, 'NiiVue'), ' — motor de visualização WebGL2 (licença BSD de 2 cláusulas).'),
        h('li', {}, h('a', { href: 'https://github.com/rordenlab/dcm2niix', target: '_blank', rel: 'noopener' }, 'dcm2niix'), ' de Chris Rorden, compilado para WebAssembly — conversão DICOM → NIfTI (BSD; inclui OpenJPEG e CharLS).'),
        h('li', {}, 'Funcionalidades, menus e API de scripts inspirados no ', h('a', { href: 'https://github.com/rordenlab/MRIcroGL', target: '_blank', rel: 'noopener' }, 'MRIcroGL'), ' (BSD de 2 cláusulas, © Chris Rorden). Este projeto é independente e não é endossado pelos autores do MRIcroGL.')
      ),
      h('p', { class: 'suave pequeno' }, 'As imagens-padrão são baixadas do repositório do MRIcroGL no primeiro uso; cada uma tem licença própria (várias são CC BY-NC 4.0).')
    )
  )
}

function atalhos() {
  const linhas = [
    ['Clique / arraste', 'Move a mira'],
    ['Botão direito + arraste', 'Ação escolhida em "Arrastar" (contraste, medir, mover…)'],
    ['Roda do mouse', 'Troca de fatia (2D) ou zoom (3D)'],
    ['Dois dedos (toque)', 'Pinça para ampliar; arraste para a ação escolhida'],
    ['Arraste no 3D', 'Gira a renderização'],
    ['V', 'Alterna entre as visões'],
    ['C', 'Liga e percorre o plano de corte'],
    ['H J K L', 'Giram a renderização ou movem a mira'],
    ['← →', 'Volume anterior / seguinte (imagens 4D)'],
    ['Ctrl+O', 'Abrir imagem'],
    ['Ctrl+D', 'Converter DICOM em NIfTI'],
    ['Ctrl+Z', 'Desfazer desenho'],
    ['Soltar arquivos com Shift', 'Abre como sobreposição']
  ]
  dialogo('Atalhos e gestos', h('div', { class: 'atalhos' }, linhas.flatMap(([k, d]) => [h('kbd', {}, k), h('span', {}, d)])))
}

// ====================================================================== scripts

const appParaScripts = {
  nv,
  redefinir: () => {
    fecharTudo(false)
    redefinir()
    aposCarregar()
  },
  carregarPorNome,
  definirCores,
  carregarDesenhoPorNome: async (nome) => {
    const img = await NVImage.loadFromUrl({ url: String(nome) })
    if (!nv.loadDrawing(img)) throw new Error('dimensões do desenho diferentes das do fundo')
  },
  fecharSobreposicoes,
  definirVisao,
  definirMosaico,
  irParaMM,
  capturar,
  salvarVolume,
  telaCheia,
  painelVisivel,
  atualizar
}

function ligarScripts() {
  const dlg = $('#dlg-script')
  const codigo = $('#scr-codigo')
  const saida = $('#scr-saida')
  const escrever = (texto, tipo) => {
    saida.append(h('div', { class: tipo ? `${tipo}-linha` : '' }, texto))
    saida.scrollTop = saida.scrollHeight
  }
  $('#scr-exemplos').append(...Object.keys(EXEMPLOS).map((k) => h('option', { value: k }, k)))
  $('#scr-exemplos').addEventListener('change', (e) => {
    if (e.target.value) codigo.value = EXEMPLOS[e.target.value]
    e.target.value = ''
  })
  codigo.value = prefs.get('script', EXEMPLOS['Básico (fundo + ativações)'])
  codigo.addEventListener('change', () => prefs.set('script', codigo.value))
  codigo.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      codigo.setRangeText('  ', codigo.selectionStart, codigo.selectionEnd, 'end')
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#scr-rodar').click()
  })
  dlg.querySelector('[data-fechar]').addEventListener('click', () => dlg.close())
  $('#scr-abrir').addEventListener('click', () => $('#inp-script').click())
  $('#inp-script').addEventListener('change', async (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (f) codigo.value = await f.text()
  })
  $('#scr-salvar').addEventListener('click', () => baixar(new Blob([codigo.value], { type: 'text/plain' }), 'script_triplanar.py'))
  $('#scr-ajuda').addEventListener('click', () => {
    saida.replaceChildren()
    escrever(
      [
        'Funções gl.* disponíveis (mesmos nomes e argumentos do MRIcroGL):',
        '  loadimage(nome|url)  overlayload(nome|url)  overlaycloseall()  overlaycount()',
        '  minmax(camada, min, max)  opacity(camada, %)  colorname(camada, nome)  invertcolor(camada, 0|1)',
        '  volume(camada, vol)  view(1 axial|2 coronal|4 sagital|8 sagital invertido|16 multiplanar|64 3D)',
        '  mosaic(texto)  orthoviewmm(x, y, z)  azimuthelevation(azi, elev)  cameradistance(z)',
        '  viewaxial(0|1)  viewcoronal(0|1)  viewsagittal(0|1)  clipazimuthelevation(prof, azi, elev)',
        '  backcolor(r, g, b)  linecolor(r, g, b)  linewidth(l)  colorbarposition(0|1)',
        '  overlayadditiveblending(0|1)  overlayloadsmooth(0|1)  extract(b, s, t)',
        '  removesmallclusters(camada, limiar, mm3, vizinhos)  drawload(url)',
        '  savebmp(nome.png)  saveimg(nome.nii.gz)  wait(ms)  modalmessage(texto)  resetdefaults()',
        '  fullscreen(0|1)  toolformvisible(0|1)  version()',
        '',
        'Imagens-padrão: ' + PADROES.map((p) => p.id).join(', '),
        'Também há print(...) e o objeto nv (instância NiiVue) para uso avançado.',
        'Funções do MRIcroGL sem equivalente na web (shaders, cutout etc.) são ignoradas com um aviso.'
      ].join('\n')
    )
  })
  $('#scr-rodar').addEventListener('click', async () => {
    saida.replaceChildren()
    prefs.set('script', codigo.value)
    $('#scr-rodar').disabled = true
    const inicio = performance.now()
    try {
      await executarScript(codigo.value, appParaScripts, escrever)
      escrever(`Concluído em ${((performance.now() - inicio) / 1000).toFixed(1)} s.`)
    } catch (erro) {
      escrever(`Erro: ${erroLegivel(erro)}`, 'erro')
    } finally {
      $('#scr-rodar').disabled = false
      desocupar()
      aposCarregar()
    }
  })
}

// ====================================================================== menus

const exige = () => nv.volumes.length > 0
const MENUS = [
  {
    rotulo: 'Arquivo',
    itens: [
      { rotulo: 'Abrir imagem…', atalho: 'Ctrl+O', acao: () => $('#inp-abrir').click() },
      { rotulo: 'Abrir pasta DICOM…', acao: () => $('#inp-pasta').click() },
      { rotulo: 'Adicionar sobreposição…', ativo: exige, acao: () => $('#inp-sobrepor').click() },
      { grupo: 'Imagens-padrão' },
      ...PADROES.map((p) => ({ rotulo: p.rotulo, acao: () => abrirPadrao(p) })),
      { sep: true },
      { rotulo: 'Converter DICOM em NIfTI…', atalho: 'Ctrl+D', acao: () => abrirConversor() },
      { sep: true },
      { rotulo: 'Salvar volume (NIfTI)…', ativo: exige, acao: () => salvarVolume(estado.camadaAtiva) },
      { rotulo: 'Salvar captura de tela (PNG)', ativo: exige, acao: () => capturar(`${semExtensao(nv.volumes[0].name)}.png`) },
      { rotulo: 'Salvar cena (.nvd)', ativo: exige, acao: () => nv.saveDocument(`${semExtensao(nv.volumes[0].name)}.nvd`) },
      { sep: true },
      { rotulo: 'Fechar sobreposições', ativo: () => nv.volumes.length > 1, acao: fecharSobreposicoes },
      { rotulo: 'Fechar tudo', ativo: exige, acao: () => fecharTudo() }
    ]
  },
  {
    rotulo: 'Editar',
    itens: [
      { rotulo: 'Copiar imagem', ativo: exige, acao: copiarImagem },
      { rotulo: 'Desfazer desenho', atalho: 'Ctrl+Z', ativo: () => !!nv.drawBitmap, acao: () => nv.drawUndo() },
      { rotulo: 'Limpar medições', acao: () => (nv.clearAllMeasurements(), nv.drawScene()) },
      { sep: true },
      { rotulo: 'Redefinir padrões de exibição', acao: redefinir }
    ]
  },
  {
    rotulo: 'Exibir',
    itens: [
      { rotulo: 'Multiplanar (A+C+S)', marcado: () => estado.visao === 'mpr', acao: () => definirVisao('mpr') },
      { rotulo: 'Multiplanar (A+C+S+3D)', marcado: () => estado.visao === 'mpr3d', acao: () => definirVisao('mpr3d') },
      { rotulo: 'Axial', marcado: () => estado.visao === 'axial', acao: () => definirVisao('axial') },
      { rotulo: 'Coronal', marcado: () => estado.visao === 'coronal', acao: () => definirVisao('coronal') },
      { rotulo: 'Sagital', marcado: () => estado.visao === 'sagital', acao: () => definirVisao('sagital') },
      { rotulo: 'Sagital (nariz à esquerda)', marcado: () => estado.visao === 'sagitalE', acao: () => definirVisao('sagitalE') },
      { rotulo: 'Renderização 3D', marcado: () => estado.visao === 'render', acao: () => definirVisao('render') },
      { rotulo: 'Mosaico…', marcado: () => estado.visao === 'mosaico', ativo: exige, acao: dialogoMosaico },
      { sep: true },
      { rotulo: 'Barra de cores', marcado: () => nv.opts.isColorbar, acao: () => (definirOpcao('isColorbar', !nv.opts.isColorbar), sincronizarControles()) },
      { rotulo: 'Régua (10 cm)', marcado: () => nv.opts.isRuler, acao: () => (definirOpcao('isRuler', !nv.opts.isRuler), sincronizarControles()) },
      { rotulo: 'Cubo de orientação', marcado: () => nv.opts.isOrientCube, acao: () => (definirOpcao('isOrientCube', !nv.opts.isOrientCube), sincronizarControles()) },
      { rotulo: 'Convenção radiológica', marcado: () => nv.opts.isRadiologicalConvention, acao: () => (definirOpcao('isRadiologicalConvention', !nv.opts.isRadiologicalConvention), sincronizarControles()) },
      { rotulo: 'Interpolação suave', marcado: () => !nv.opts.isNearestInterpolation, acao: () => (definirOpcao('suave', nv.opts.isNearestInterpolation), sincronizarControles()) },
      { sep: true },
      { rotulo: 'Fundo preto', acao: () => (definirOpcao('backColor', [0, 0, 0, 1]), sincronizarControles()) },
      { rotulo: 'Fundo branco', acao: () => (definirOpcao('backColor', [1, 1, 1, 1]), sincronizarControles()) },
      { sep: true },
      { rotulo: 'Painel lateral', marcado: () => !document.body.classList.contains('sem-painel'), acao: () => painelVisivel(document.body.classList.contains('sem-painel')) },
      { rotulo: 'Tela cheia', marcado: () => !!document.fullscreenElement, acao: () => telaCheia(!document.fullscreenElement) }
    ]
  },
  {
    rotulo: 'Desenhar',
    itens: [
      { rotulo: 'Modo de desenho', marcado: () => nv.opts.drawingEnabled, acao: () => (ativarDesenho(!nv.opts.drawingEnabled), ($('#sec-desenho').open = true)) },
      { grupo: 'Cor da caneta' },
      ...CORES_CANETA.map((c) => ({ rotulo: c.nome, marcado: () => nv.opts.drawingEnabled && estado.caneta === c.valor, acao: () => (ativarDesenho(true), definirCaneta(c.valor)) })),
      { sep: true },
      { rotulo: 'Desfazer', atalho: 'Ctrl+Z', ativo: () => !!nv.drawBitmap, acao: () => nv.drawUndo() },
      { rotulo: 'Segmentação automática (Otsu)', ativo: exige, acao: () => $('#des-auto').click() },
      { rotulo: 'Interpolar entre fatias', ativo: () => !!nv.drawBitmap, acao: () => $('#des-interpolar').click() },
      { rotulo: 'Crescer regiões (GrowCut)', ativo: () => !!nv.drawBitmap, acao: () => $('#des-crescer').click() },
      { sep: true },
      { rotulo: 'Abrir VOI…', ativo: exige, acao: () => $('#inp-voi').click() },
      { rotulo: 'Salvar VOI (NIfTI)', ativo: () => !!nv.drawBitmap, acao: salvarDesenho },
      { rotulo: 'Fechar VOI', ativo: () => !!nv.drawBitmap, acao: () => $('#des-fechar').click() }
    ]
  },
  {
    rotulo: 'Ferramentas',
    itens: [
      { rotulo: 'Cabeçalho NIfTI', ativo: exige, acao: () => mostrarCabecalho(ativa()) },
      { rotulo: 'Histograma de intensidade', ativo: exige, acao: () => mostrarHistograma(nv, estado.camadaAtiva) },
      { rotulo: 'Estatísticas descritivas', ativo: exige, acao: () => mostrarEstatisticas(nv) },
      { sep: true },
      { rotulo: 'Tabela de clusters…', ativo: exige, acao: () => tabelaDeClusters(nv, estado.camadaAtiva, irParaMM) },
      { rotulo: 'Remover clusters pequenos…', ativo: exige, acao: () => removerClustersPequenos(nv, estado.camadaAtiva, atualizar) },
      { sep: true },
      { rotulo: 'Remover névoa do fundo…', ativo: exige, acao: removerNevoa },
      { rotulo: 'Reamostrar para 256³ a 1 mm', ativo: exige, acao: conformar },
      { sep: true },
      { rotulo: 'Scripts…', acao: () => $('#dlg-script').showModal() }
    ]
  },
  {
    rotulo: 'Ajuda',
    itens: [
      { rotulo: 'Atalhos e gestos', acao: atalhos },
      { rotulo: 'Sobre o Triplanar', acao: sobre }
    ]
  }
]

let menuAberto = null
function fecharMenu() {
  if (!menuAberto) return
  menuAberto.lista.remove()
  menuAberto.botao.setAttribute('aria-expanded', 'false')
  menuAberto = null
}

function abrirMenu(menu, botao) {
  fecharMenu()
  const lista = h(
    'div',
    { class: 'menu-lista', role: 'menu' },
    menu.itens.map((item) => {
      if (item.sep) return h('div', { class: 'menu-sep', role: 'separator' })
      if (item.grupo) return h('div', { class: 'menu-grupo' }, item.grupo)
      const marcado = item.marcado ? !!item.marcado() : null
      return h(
        'button',
        {
          class: 'menu-item',
          role: marcado === null ? 'menuitem' : 'menuitemcheckbox',
          'aria-checked': marcado === null ? null : String(marcado),
          disabled: item.ativo ? !item.ativo() : false,
          onclick: () => {
            fecharMenu()
            item.acao()
          }
        },
        h('span', { class: 'marca-sel', 'aria-hidden': 'true' }, marcado ? '✓' : ''),
        h('span', { class: 'rotulo' }, item.rotulo),
        item.atalho ? h('span', { class: 'atalho' }, item.atalho) : null
      )
    })
  )
  document.body.append(lista)
  const r = botao.getBoundingClientRect()
  lista.style.top = `${r.bottom + 2}px`
  lista.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - lista.offsetWidth - 8))}px`
  botao.setAttribute('aria-expanded', 'true')
  menuAberto = { lista, botao, menu }
  lista.addEventListener('keydown', (e) => {
    const itens = $$('.menu-item:not(:disabled)', lista)
    const i = itens.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') (e.preventDefault(), itens[(i + 1) % itens.length]?.focus())
    if (e.key === 'ArrowUp') (e.preventDefault(), itens[(i - 1 + itens.length) % itens.length]?.focus())
  })
}

function montarMenus() {
  const barra = $('#menus')
  for (const menu of MENUS) {
    const botao = h('button', { class: 'menu-titulo', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, menu.rotulo)
    botao.addEventListener('click', (e) => {
      e.stopPropagation()
      if (menuAberto?.botao === botao) fecharMenu()
      else {
        abrirMenu(menu, botao)
        if (e.detail === 0) $('.menu-item:not(:disabled)', menuAberto.lista)?.focus() // aberto pelo teclado
      }
    })
    botao.addEventListener('pointerenter', () => menuAberto && menuAberto.botao !== botao && abrirMenu(menu, botao))
    barra.append(botao)
  }
  document.addEventListener('pointerdown', (e) => {
    if (menuAberto && !menuAberto.lista.contains(e.target) && !e.target.closest('.menu-titulo')) fecharMenu()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuAberto) {
      const b = menuAberto.botao
      fecharMenu()
      b.focus()
    }
  })
  window.addEventListener('resize', fecharMenu)
}

// ====================================================================== eventos gerais

function ligarEntradas() {
  const aoEscolher = (id, opcoes) =>
    $(id).addEventListener('change', (e) => {
      const arquivos = Array.from(e.target.files || [])
      e.target.value = ''
      carregarArquivos(arquivos, opcoes)
    })
  aoEscolher('#inp-abrir', { sobrepor: false })
  aoEscolher('#inp-pasta', { sobrepor: false })
  aoEscolher('#inp-sobrepor', { sobrepor: true })

  $('#btn-abrir').addEventListener('click', () => $('#inp-abrir').click())
  $('#vazio-abrir').addEventListener('click', () => $('#inp-abrir').click())
  $('#vazio-pasta').addEventListener('click', () => $('#inp-pasta').click())
  $('#btn-dicom').addEventListener('click', () => abrirConversor())
  $('#vazio-dicom').addEventListener('click', () => abrirConversor())
  $('#vazio-exemplo').addEventListener('click', () => abrirPadrao(PADROES[0]))
  $('#btn-painel').addEventListener('click', () => painelVisivel(document.body.classList.contains('sem-painel')))
  for (const b of $$('.visao')) b.addEventListener('click', () => definirVisao(b.dataset.visao))

  // arrastar e soltar em qualquer ponto da janela
  let profundidade = 0
  const temArquivos = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
  window.addEventListener('dragenter', (e) => {
    if (!temArquivos(e) || document.querySelector('dialog[open]')) return
    profundidade++
    $('#soltar').hidden = false
  })
  window.addEventListener('dragleave', () => {
    profundidade = Math.max(0, profundidade - 1)
    if (!profundidade) $('#soltar').hidden = true
  })
  window.addEventListener('dragover', (e) => temArquivos(e) && e.preventDefault())
  window.addEventListener('drop', async (e) => {
    if (!temArquivos(e)) return
    e.preventDefault()
    profundidade = 0
    $('#soltar').hidden = true
    if (document.querySelector('dialog[open]')) return
    const sobrepor = e.shiftKey && nv.volumes.length > 0
    carregarArquivos(await arquivosDoDrop(e.dataTransfer), { sobrepor })
  })

  document.addEventListener('keydown', (e) => {
    const emCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && e.key.toLowerCase() === 'o') (e.preventDefault(), $('#inp-abrir').click())
    else if (ctrl && e.key.toLowerCase() === 'd') (e.preventDefault(), abrirConversor())
    else if (ctrl && e.key.toLowerCase() === 'z' && !emCampo && nv.drawBitmap) (e.preventDefault(), nv.drawUndo())
  })

  // Em telas estreitas o painel é uma gaveta: tocar na imagem a fecha.
  $('#palco').addEventListener('pointerdown', () => {
    if (window.matchMedia('(max-width: 760px)').matches && !document.body.classList.contains('sem-painel')) painelVisivel(false)
  })
}

function ligarNiivue() {
  nv.onLocationChange = (dados) => {
    if (!dados?.mm) return
    const mm = Array.from(dados.mm).slice(0, 3).map((v) => fmt(v, 1))
    const vox = Array.from(dados.vox || []).map((v) => Math.round(v))
    $('#st-pos').textContent = `${mm.join(' × ')} mm  ·  voxel ${vox.join(', ')}`
    $('#st-valor').textContent = (dados.values || []).map((v, i) => `${i === 0 ? 'fundo' : 'sobrep. ' + i}: ${fmt(v.value, 3)}`).join('  ·  ')
  }
  nv.onIntensityChange = () => desenharCamadas()
  nv.onFrameChange = () => !estado.animacao && desenharCamadas()
  nv.onAzimuthElevationChange = () => sincronizarControles()
  nv.onClipPlaneChange = () => sincronizarControles()
  nv.onClickToSegment = (d) => aviso(`Região segmentada: ${fmt(d.mL, 2)} mL (${fmt(d.mm3, 0)} mm³).`, 'ok')
  nv.onMeasurementCompleted = () => {}
}

function restaurarPreferencias() {
  const o = prefs.get('opcoes', null)
  if (o) {
    for (const k of OPCOES_SALVAS) if (o[k] !== undefined && o[k] !== null) nv.opts[k] = o[k]
  }
  const estreito = window.matchMedia('(max-width: 760px)').matches
  painelVisivel(estreito ? false : prefs.get('painel', true))
}

function ligarPWA() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((erro) => console.warn('Service worker não registrado:', erro))
  }
  let convite = null
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    convite = e
    $('#btn-instalar').hidden = false
  })
  $('#btn-instalar').addEventListener('click', async () => {
    if (!convite) return
    convite.prompt()
    await convite.userChoice
    convite = null
    $('#btn-instalar').hidden = true
  })
  window.addEventListener('appinstalled', () => ($('#btn-instalar').hidden = true))
  // Arquivos abertos pelo sistema ("Abrir com") quando o app está instalado.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return
      carregarArquivos(await Promise.all(params.files.map((f) => f.getFile())))
    })
  }
}

// ====================================================================== início

async function iniciar() {
  montarMenus()
  ligarEntradas()
  ligarPainelCamadas()
  ligarPainelExibicao()
  ligarPainelDesenho()
  ligarScripts()
  configurarConversor({ aoVisualizar: (arquivos) => carregarArquivos(arquivos, { sobrepor: false }) })
  ligarPWA()
  try {
    await nv.attachToCanvas(tela)
  } catch (erro) {
    $('#vazio').replaceChildren(h('h1', {}, 'WebGL2 indisponível'), h('p', {}, 'Este navegador ou aparelho não oferece WebGL2, necessário para exibir as imagens. A conversão DICOM → NIfTI continua disponível.'), h('div', { class: 'linha-botoes centro' }, h('button', { class: 'btn primario', onclick: () => abrirConversor() }, 'Converter DICOM em NIfTI')))
    console.error(erro)
    return
  }
  ligarNiivue()
  restaurarPreferencias()
  nv.setDrawOpacity(0.8)
  marcarVisao()
  atualizar()
  nv.drawScene()
  $('#st-info').textContent = `Triplanar ${VERSAO} · uso em pesquisa e ensino`
  if (new URLSearchParams(location.search).get('acao') === 'dicom') abrirConversor()
  window.triplanar = { nv, carregarArquivos, carregarPorNome, definirVisao, executarScript: (c) => executarScript(c, appParaScripts, console.log) }
}

iniciar()
