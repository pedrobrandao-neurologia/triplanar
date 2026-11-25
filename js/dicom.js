// Conversão DICOM → NIfTI com o dcm2niix (WebAssembly). Nada sai do aparelho:
// os arquivos são lidos e convertidos dentro do navegador, em um Web Worker.

import { convert, listSeries, exitCodes } from '../vendor/dcm2niix/index.jpeg.js'
import { $, h, aviso, baixar, prefs, tamanhoLegivel, criarZip, lerZip, arquivosDoDrop } from './util.js'
import { dialogo } from './ferramentas.js'

const MENSAGENS_SAIDA = {
  [exitCodes.ok]: 'Conversão concluída.',
  [exitCodes.error]: 'O dcm2niix relatou um erro.',
  [exitCodes.noValidFiles]: 'Nenhum arquivo DICOM válido foi encontrado.',
  [exitCodes.corruptFile]: 'Há arquivo DICOM corrompido.',
  [exitCodes.someOkSomeBad]: 'Algumas séries foram convertidas; outras falharam.',
  [exitCodes.incompleteVolumes]: 'Convertido, mas há volumes incompletos (faltam fatias).',
  [exitCodes.invalidParam]: 'Parâmetro inválido (confira o nome do arquivo de saída).'
}

const estado = {
  entrada: [], // File[] escolhidos
  series: [], // listagem prévia (listSeries)
  resultado: null, // ConvertResult
  aborto: null,
  aoVisualizar: null // (File[]) => void, definido pelo app
}

export function configurarConversor({ aoVisualizar }) {
  estado.aoVisualizar = aoVisualizar
  const dlg = $('#dlg-dicom')

  $('#dcm-nome').value = prefs.get('dcm.nome', '%f_%p_%t_%s')
  $('#dcm-formato').value = prefs.get('dcm.formato', 'niigz')
  $('#dcm-bids').value = prefs.get('dcm.bids', 'anon')
  $('#dcm-mesclar').value = prefs.get('dcm.mesclar', '2')
  for (const id of ['ignorar', 'recortar', 'philips', 'escala', 'detalhado']) {
    $(`#dcm-${id}`).checked = prefs.get(`dcm.${id}`, id === 'philips')
  }

  $('#dcm-pasta').addEventListener('click', () => $('#inp-dcm-pasta').click())
  $('#dcm-arquivos').addEventListener('click', () => $('#inp-dcm-arquivos').click())
  for (const id of ['#inp-dcm-pasta', '#inp-dcm-arquivos']) {
    $(id).addEventListener('change', async (e) => {
      const arquivos = Array.from(e.target.files || [])
      e.target.value = ''
      if (arquivos.length) await definirEntrada(arquivos)
    })
  }

  const zona = $('#dcm-soltar')
  zona.addEventListener('dragover', (e) => {
    e.preventDefault()
    zona.classList.add('ativo')
  })
  zona.addEventListener('dragleave', () => zona.classList.remove('ativo'))
  zona.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    zona.classList.remove('ativo')
    await definirEntrada(await arquivosDoDrop(e.dataTransfer))
  })

  $('#dcm-converter').addEventListener('click', () => executar())
  $('#dcm-cancelar').addEventListener('click', () => estado.aborto?.abort())
  $('#dcm-zipar').addEventListener('click', () => baixarZip())
  $('#dcm-salvar-pasta').addEventListener('click', () => salvarEmPasta())
  $('#dcm-salvar-pasta').hidden = !('showDirectoryPicker' in window)
  $('#dcm-fechar').addEventListener('click', () => dlg.close())
  dlg.addEventListener('close', () => estado.aborto?.abort())
}

export async function abrirConversor(arquivos) {
  const dlg = $('#dlg-dicom')
  if (!dlg.open) dlg.showModal()
  if (arquivos?.length) await definirEntrada(arquivos)
}

/** Expande .zip e guarda os arquivos de entrada; lista as séries encontradas. */
async function definirEntrada(arquivos) {
  const expandidos = await expandirZips(arquivos)
  estado.entrada = expandidos
  estado.series = []
  estado.resultado = null
  $('#dcm-resultados').replaceChildren()
  $('#dcm-acoes-resultado').hidden = true
  $('#dcm-log').textContent = ''
  const total = expandidos.reduce((s, f) => s + f.size, 0)
  $('#dcm-resumo').textContent = `${expandidos.length} arquivo(s) · ${tamanhoLegivel(total)}`
  $('#dcm-converter').disabled = expandidos.length === 0
  const caixa = $('#dcm-series')
  caixa.replaceChildren(h('p', { class: 'suave' }, 'Lendo cabeçalhos DICOM…'))
  try {
    estado.series = await listSeries(expandidos, { args: ['-ba', 'y'] })
    desenharSeries()
  } catch (erro) {
    caixa.replaceChildren(
      h('p', { class: 'suave' }, 'Não foi possível listar as séries antes da conversão; todas serão convertidas.')
    )
    console.warn('listSeries falhou:', erro)
  }
}

export async function expandirZips(arquivos) {
  const saida = []
  for (const f of arquivos) {
    if (/\.zip$/i.test(f.name)) {
      try {
        saida.push(...(await lerZip(f)))
      } catch (erro) {
        aviso(`${f.name}: ${erro.message}`, 'erro')
      }
    } else saida.push(f)
  }
  return saida
}

function desenharSeries() {
  const caixa = $('#dcm-series')
  const visiveis = estado.series.filter((s) => s.Rows > 1 && s.Columns > 1)
  if (!visiveis.length) {
    caixa.replaceChildren(h('p', { class: 'suave' }, 'Nenhuma série de imagem reconhecida nesses arquivos.'))
    return
  }
  const tabela = h(
    'table',
    { class: 'tabela' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, h('input', { type: 'checkbox', checked: true, 'aria-label': 'Selecionar todas', onchange: (e) => marcarTodas(e.target.checked) })),
        h('th', {}, 'Nº'),
        h('th', {}, 'Descrição'),
        h('th', {}, 'Mod.'),
        h('th', {}, 'Arquivos'),
        h('th', {}, 'Matriz')
      )
    ),
    h(
      'tbody',
      {},
      visiveis.map((s) =>
        h(
          'tr',
          {},
          h('td', {}, h('input', { type: 'checkbox', checked: true, class: 'dcm-serie', value: s.CRC, 'aria-label': `Série ${s.SeriesNumber}` })),
          h('td', {}, s.SeriesNumber),
          h('td', {}, s.SeriesDescription || s.ProtocolName || '(sem descrição)'),
          h('td', {}, s.Modality || '—'),
          h('td', {}, s.Files),
          h('td', {}, `${s.Columns}×${s.Rows}`)
        )
      )
    )
  )
  caixa.replaceChildren(h('p', { class: 'suave' }, `${visiveis.length} série(s) encontrada(s). Desmarque as que não quer converter.`), tabela)
}

function marcarTodas(valor) {
  for (const c of document.querySelectorAll('.dcm-serie')) c.checked = valor
}

/** Monta a linha de comando do dcm2niix a partir do formulário. */
export function argumentosDoFormulario() {
  const sn = (id) => ($(`#dcm-${id}`).checked ? 'y' : 'n')
  const formato = $('#dcm-formato').value
  const bids = $('#dcm-bids').value
  const nome = ($('#dcm-nome').value || '%f_%p_%t_%s').trim()
  const args = ['-f', nome]
  if (formato === 'nrrd') args.push('-e', 'y', '-z', 'n')
  else args.push('-z', formato === 'niigz' ? 'y' : 'n')
  args.push('-b', bids === 'nao' ? 'n' : 'y', '-ba', bids === 'completo' ? 'n' : 'y')
  args.push('-i', sn('ignorar'), '-x', sn('recortar'), '-p', sn('philips'))
  if ($('#dcm-mesclar').value !== '2') args.push('-m', $('#dcm-mesclar').value) // 2 = automático, o padrão do dcm2niix
  if ($('#dcm-escala').checked) args.push('-l', 'y')
  args.push('-v', sn('detalhado'))

  prefs.set('dcm.nome', nome)
  prefs.set('dcm.formato', formato)
  prefs.set('dcm.bids', bids)
  prefs.set('dcm.mesclar', $('#dcm-mesclar').value)
  for (const id of ['ignorar', 'recortar', 'philips', 'escala', 'detalhado']) prefs.set(`dcm.${id}`, $(`#dcm-${id}`).checked)
  return args
}

async function executar() {
  if (!estado.entrada.length) return
  const args = argumentosDoFormulario()
  const caixas = Array.from(document.querySelectorAll('.dcm-serie'))
  const marcadas = caixas.filter((c) => c.checked).map((c) => c.value)
  if (caixas.length && !marcadas.length) {
    aviso('Selecione ao menos uma série.', 'erro')
    return
  }
  if (caixas.length && marcadas.length < caixas.length) {
    if (marcadas.length > 16) {
      aviso('O dcm2niix aceita no máximo 16 séries escolhidas por vez. Marque todas ou até 16.', 'erro')
      return
    }
    for (const crc of marcadas) args.push('-n', crc)
  }

  const log = $('#dcm-log')
  const barra = $('#dcm-progresso')
  log.textContent = `dcm2niix ${args.join(' ')}\n`
  barra.hidden = false
  barra.removeAttribute('value')
  $('#dcm-converter').disabled = true
  $('#dcm-cancelar').hidden = false
  $('#dcm-resultados').replaceChildren()
  $('#dcm-acoes-resultado').hidden = true
  estado.aborto = new AbortController()
  try {
    const resultado = await convert(estado.entrada, {
      args,
      signal: estado.aborto.signal,
      onLog: (texto) => {
        if (/^Progress: /.test(texto)) return
        log.textContent += texto + '\n'
        log.scrollTop = log.scrollHeight
      },
      onProgress: (fracao) => (barra.value = fracao)
    })
    estado.resultado = resultado
    const msg = MENSAGENS_SAIDA[resultado.exitCode] || `dcm2niix terminou com o código ${resultado.exitCode}.`
    const ok = resultado.exitCode === exitCodes.ok
    aviso(resultado.files.length ? `${msg} ${resultado.series.length} imagem(ns) gerada(s).` : msg, ok ? 'ok' : 'erro')
    desenharResultados()
  } catch (erro) {
    if (erro?.name === 'AbortError') aviso('Conversão cancelada.')
    else {
      aviso(`Falha na conversão: ${erro.message || erro}`, 'erro')
      log.textContent += `\nERRO: ${erro.message || erro}\n`
    }
  } finally {
    barra.hidden = true
    $('#dcm-cancelar').hidden = true
    $('#dcm-converter').disabled = false
    estado.aborto = null
  }
}

function desenharResultados() {
  const r = estado.resultado
  const caixa = $('#dcm-resultados')
  if (!r || !r.files.length) {
    caixa.replaceChildren(h('p', { class: 'suave' }, 'Nenhum arquivo foi gerado. Veja o registro abaixo.'))
    return
  }
  const linhas = r.series.map((s) => {
    const extras = [s.sidecar, s.bval, s.bvec].filter(Boolean)
    const dims = s.json ? [s.json.SeriesDescription || s.json.ProtocolName, s.json.Modality].filter(Boolean).join(' · ') : ''
    return h(
      'li',
      { class: 'resultado' },
      h('div', { class: 'resultado-nome' }, h('strong', {}, s.image.name), h('span', { class: 'suave' }, ` ${tamanhoLegivel(s.image.size)}${dims ? ' · ' + dims : ''}`)),
      extras.length ? h('div', { class: 'suave pequeno' }, 'Acompanha: ' + extras.map((f) => f.name.replace(s.stem, '…')).join(', ')) : null,
      h(
        'div',
        { class: 'linha-botoes' },
        h('button', { class: 'btn primario', onclick: () => visualizar(s) }, 'Visualizar'),
        h('button', { class: 'btn', onclick: () => baixar(s.image, s.image.name) }, 'Baixar NIfTI'),
        s.sidecar ? h('button', { class: 'btn', onclick: () => baixar(s.sidecar, s.sidecar.name) }, 'Baixar JSON') : null,
        s.sidecar ? h('button', { class: 'btn', onclick: () => mostrarSidecar(s) }, 'Ver sidecar BIDS') : null
      )
    )
  })
  const soltos = r.files.filter((f) => !r.series.some((s) => [s.image, s.sidecar, s.bval, s.bvec].includes(f)))
  if (soltos.length) {
    linhas.push(
      h(
        'li',
        { class: 'resultado' },
        h('div', { class: 'suave' }, 'Outros arquivos gerados:'),
        h('div', { class: 'linha-botoes' }, soltos.map((f) => h('button', { class: 'btn', onclick: () => baixar(f, f.name) }, f.name)))
      )
    )
  }
  caixa.replaceChildren(h('ul', { class: 'lista-resultados' }, linhas))
  $('#dcm-acoes-resultado').hidden = false
}

function visualizar(serie) {
  if (/\.(nii|nii\.gz|nrrd)$/i.test(serie.image.name) && estado.aoVisualizar) {
    $('#dlg-dicom').close()
    estado.aoVisualizar([serie.image])
  } else aviso('Este formato não pode ser aberto diretamente no visualizador.', 'erro')
}

async function mostrarSidecar(serie) {
  const texto = await serie.sidecar.text()
  dialogo(`Sidecar BIDS — ${serie.sidecar.name}`, h('pre', { class: 'registro alto', tabIndex: 0 }, texto), [
    { rotulo: 'Baixar JSON', acao: () => baixar(serie.sidecar, serie.sidecar.name) }
  ])
}

async function baixarZip() {
  const r = estado.resultado
  if (!r?.files.length) return
  try {
    const itens = []
    for (const f of r.files) itens.push({ nome: f.relativePath || f.name, dados: new Uint8Array(await f.arrayBuffer()) })
    baixar(criarZip(itens), 'nifti_convertido.zip')
  } catch (erro) {
    aviso(erro.message, 'erro')
  }
}

async function salvarEmPasta() {
  const r = estado.resultado
  if (!r?.files.length) return
  let pasta
  try {
    pasta = await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    return // usuário cancelou
  }
  try {
    for (const f of r.files) {
      const partes = (f.relativePath || f.name).split('/')
      let dir = pasta
      for (const p of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
      const alvo = await dir.getFileHandle(partes.at(-1), { create: true })
      const escrita = await alvo.createWritable()
      await escrita.write(f)
      await escrita.close()
    }
    aviso(`${r.files.length} arquivo(s) salvo(s) em "${pasta.name}".`, 'ok')
  } catch (erro) {
    aviso(`Não foi possível salvar: ${erro.message}`, 'erro')
  }
}

/**
 * Converte DICOM em memória só para visualização (sem compressão nem sidecar).
 * @returns {Promise<File[]>} imagens NIfTI, uma por série
 */
export async function converterParaVisualizar(arquivos, aoProgresso) {
  const entrada = await expandirZips(arquivos)
  const r = await convert(entrada, { args: ['-z', 'n', '-b', 'n', '-f', '%p_%s'], onProgress: aoProgresso })
  if (!r.series.length) {
    throw new Error(MENSAGENS_SAIDA[r.exitCode] || `dcm2niix terminou com o código ${r.exitCode} sem gerar imagens.`)
  }
  return r.series.map((s) => s.image)
}
