// Testes das partes do Triplanar que não dependem do navegador:
// gravação/leitura de .zip, detecção de DICOM e tradução dos scripts do MRIcroGL.
import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { crc32, criarZip, lerZip, ehDicom, fmt, semExtensao } from '../js/util.js'
import { traduzir, criarGL, executarScript } from '../js/script.js'

test('crc32 confere com o valor de referência', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

test('criarZip grava um .zip que lerZip lê de volta', async () => {
  const a = new Uint8Array([1, 2, 3, 4, 5])
  const b = new TextEncoder().encode('{"Modality":"MR"}')
  const zip = criarZip([
    { nome: 'sub/série_ção.nii.gz', dados: a },
    { nome: 'x.json', dados: b }
  ])
  const arquivos = await lerZip(new File([zip], 'saida.zip'))
  assert.deepEqual(arquivos.map((f) => f._webkitRelativePath), ['saida/sub/série_ção.nii.gz', 'saida/x.json'])
  assert.deepEqual(new Uint8Array(await arquivos[0].arrayBuffer()), a)
  assert.equal(await arquivos[1].text(), '{"Modality":"MR"}')
})

test('lerZip descomprime entradas deflate e ignora pastas e lixo do macOS', async () => {
  const conteudo = Buffer.from('DICOM '.repeat(500))
  const comp = deflateRawSync(conteudo)
  const partes = []
  const central = []
  let pos = 0
  const entrada = (nome, dados, metodo, tamReal, crc) => {
    const n = Buffer.from(nome)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(metodo, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dados.length, 18)
    local.writeUInt32LE(tamReal, 22)
    local.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(metodo, 10)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(dados.length, 20)
    c.writeUInt32LE(tamReal, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(pos, 42)
    partes.push(local, n, dados)
    central.push(c, n)
    pos += 30 + n.length + dados.length
  }
  entrada('estudo/', Buffer.alloc(0), 0, 0, 0)
  entrada('estudo/IM0001', comp, 8, conteudo.length, crc32(conteudo))
  entrada('__MACOSX/estudo/._IM0001', Buffer.from('x'), 0, 1, crc32(Buffer.from('x')))
  const tamCentral = central.reduce((s, p) => s + p.length, 0)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(3, 8)
  fim.writeUInt16LE(3, 10)
  fim.writeUInt32LE(tamCentral, 12)
  fim.writeUInt32LE(pos, 16)
  const arquivos = await lerZip(new File([Buffer.concat([...partes, ...central, fim])], 'paciente.zip'))
  assert.equal(arquivos.length, 1)
  assert.equal(arquivos[0]._webkitRelativePath, 'paciente/estudo/IM0001')
  assert.equal(await arquivos[0].text(), conteudo.toString())
})

test('lerZip recusa arquivo que não é zip', async () => {
  await assert.rejects(lerZip(new File([new Uint8Array(200)], 'ruim.zip')), /inválido/)
})

test('ehDicom reconhece extensão, assinatura DICM e arquivos sem extensão', async () => {
  const comAssinatura = new Uint8Array(200)
  comAssinatura.set([0x44, 0x49, 0x43, 0x4d], 128)
  assert.equal(await ehDicom(new File([new Uint8Array(10)], 'a.dcm')), true)
  assert.equal(await ehDicom(new File([new Uint8Array(10)], 'A.IMA')), true)
  assert.equal(await ehDicom(new File([comAssinatura], 'MR.1.3.12.2.1107.5.2.32.2014031012493950715786673')), true)
  assert.equal(await ehDicom(new File([comAssinatura], 'imagem.bin')), true)
  assert.equal(await ehDicom(new File([new Uint8Array(200)], 'IM0001')), true) // sem extensão nem assinatura
  assert.equal(await ehDicom(new File([comAssinatura], 'cerebro.nii.gz')), false)
  assert.equal(await ehDicom(new File([new Uint8Array(200)], 'cerebro.nii')), false)
  assert.equal(await ehDicom(new File([new Uint8Array(200)], 'volume.mif')), false)
  assert.equal(await ehDicom(new File([new Uint8Array(20)], 'IM0001')), false) // pequeno demais
})

test('fmt e semExtensao', () => {
  assert.equal(fmt(3.14159, 2), '3.14')
  assert.equal(fmt(2, 4), '2')
  assert.equal(fmt(NaN), '—')
  assert.equal(fmt(0.0000371), '3.710e-5')
  assert.equal(semExtensao('T1_mprage.nii.gz'), 'T1_mprage')
  assert.equal(semExtensao('a.b.nrrd'), 'a.b')
})

test('traduzir converte a sintaxe mínima de Python dos scripts do MRIcroGL', () => {
  const js = traduzir("import gl\n# comentário\ngl.loadimage('spm152')\ngl.overlayloadsmooth(True)\ngl.backcolor(255, 255, 255)\n")
  assert.equal(js, "\n// comentário\ngl.loadimage('spm152')\ngl.overlayloadsmooth(true)\ngl.backcolor(255, 255, 255)\n")
})

function appFalso() {
  const chamadas = []
  const vol = (nome) => ({ id: nome, name: nome, colormap: 'gray', colormapNegative: '', cal_min: 0, cal_max: 1, global_max: 12, opacity: 1 })
  const nv = {
    volumes: [],
    opts: {},
    colormaps: () => ['gray', 'red', 'blue', 'warm', 'ct_bones'],
    updateGLVolume: () => chamadas.push('update'),
    drawScene: () => {},
    setOpacity: (i, o) => (nv.volumes[i].opacity = o),
    setColormapNegative: (id, c) => (nv.volumes.find((v) => v.id === id).colormapNegative = c),
    setClipPlane: (c) => chamadas.push(['clip', c]),
    setRenderAzimuthElevation: (a, e) => chamadas.push(['camera', a, e])
  }
  const app = {
    nv,
    atualizar: () => {},
    redefinir: () => (nv.volumes = []),
    carregarPorNome: async (nome, sobrepor) => {
      await new Promise((r) => setTimeout(r, 5)) // garante que a fila respeita a ordem
      if (!sobrepor) nv.volumes = []
      nv.volumes.push(vol(nome + nv.volumes.length))
    },
    definirCores: (v, nome) => (v.colormap = nome),
    definirVisao: (v) => chamadas.push(['visao', v]),
    irParaMM: (mm) => chamadas.push(['mm', mm])
  }
  return { app, nv, chamadas }
}

test('script básico do MRIcroGL roda em ordem e separa faixas positiva e negativa', async () => {
  const { app, nv, chamadas } = appFalso()
  const saida = []
  await executarScript(
    `import gl
gl.resetdefaults()
gl.loadimage('spm152')
gl.overlayload('spmMotor')
gl.minmax(1, 4, 4)
gl.opacity(1, 50)
gl.overlayload('spmMotor')
gl.minmax(2, -4, -4)
gl.colorname(2, "3blue")
gl.orthoviewmm(37, -14, 47)
gl.clipazimuthelevation(0.4, 0, 160)
`,
    app,
    (t) => saida.push(t)
  )
  assert.equal(nv.volumes.length, 3)
  const [, pos, neg] = nv.volumes
  assert.equal(pos.cal_min, 4)
  assert.ok(pos.cal_max > 4 && pos.cal_max < 4.01) // min = max vira limiar de cor única
  assert.equal(pos.opacity, 0.5)
  assert.equal(pos.colormapNegative, '')
  assert.equal(neg.colormapNegative, 'blue') // "3blue" do MRIcroGL
  assert.equal(neg.cal_maxNeg, -4)
  assert.ok(neg.cal_minNeg < -4)
  assert.ok(neg.cal_min > neg.global_max) // a faixa positiva fica fora dos dados
  assert.deepEqual(chamadas.find((c) => c[0] === 'mm'), ['mm', [37, -14, 47]])
  assert.deepEqual(chamadas.find((c) => c[0] === 'clip')[1].map((v) => +v.toFixed(3)), [0.1, 0, 160])
  assert.deepEqual(saida, [])
})

test('função sem equivalente avisa uma vez; erro informa a chamada que falhou', async () => {
  const { app } = appFalso()
  const saida = []
  await assert.rejects(
    executarScript("gl.shadername('MIP')\ngl.shadername('x')\ngl.loadimage('a')\ngl.colorname(0, 'naoexiste')\n", app, (t) => saida.push(t)),
    /gl\.colorname\(\): esquema de cores "naoexiste" não encontrado/
  )
  assert.equal(saida.length, 1)
  assert.match(saida[0], /gl\.shadername\(\) não está disponível/)
})

test('valores de retorno ficam disponíveis com await', async () => {
  const { app } = appFalso()
  const { gl, terminar } = criarGL(app, () => {})
  gl.loadimage('a')
  gl.overlayload('b')
  assert.equal(await gl.overlaycount(), 1)
  assert.match(await gl.version(), /Triplanar/)
  await assert.rejects(gl.opacity(7, 50), /camada 7 não existe/)
  await terminar()
})
