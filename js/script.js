// Console de scripts: reimplementa em JavaScript a API "gl" de automação do MRIcroGL.
// Scripts simples escritos para o MRIcroGL (import gl + chamadas gl.*) rodam sem alteração:
// cada chamada entra em uma fila e é executada em ordem.

import { aplicarRemocaoDeClusters } from './ferramentas.js'

export const EXEMPLOS = {
  'Básico (fundo + ativações)': `import gl
gl.resetdefaults()
# abre a imagem de fundo
gl.loadimage('spm152')
# sobreposição: regiões positivas
gl.overlayload('spmMotor')
gl.minmax(1, 4, 4)
gl.opacity(1, 50)
# sobreposição: regiões negativas
gl.overlayload('spmMotor')
gl.minmax(2, -4, -4)
gl.colorname(2, '3blue')
gl.orthoviewmm(37, -14, 47)
`,
  Mosaico: `import gl
gl.resetdefaults()
gl.loadimage('spm152')
gl.overlayload('spmMotor')
gl.minmax(1, 4, 4)
gl.opacity(1, 50)
gl.mosaic("A L+ -24 -16 16 40; 48 56 S X R 0")
`,
  'Plano de corte no 3D': `import gl
gl.resetdefaults()
gl.loadimage('spm152')
gl.overlayload('spmMotor')
gl.minmax(1, 4, 4)
gl.opacity(1, 50)
gl.view(64)
gl.clipazimuthelevation(0.4, 0, 160)
`,
  'Angio-RM em 3D': `import gl
gl.resetdefaults()
gl.loadimage('chris_MRA')
gl.view(64)
gl.azimuthelevation(120, 20)
`,
  'Tomografia com cores': `import gl
gl.resetdefaults()
gl.loadimage('CT_Philips')
gl.colorname(0, 'CT_Bones')
gl.view(64)
gl.clipazimuthelevation(0.35, 0, 130)
`,
  'Girar e capturar': `import gl
gl.loadimage('mni152')
gl.view(64)
for (let a = 0; a <= 360; a += 30) {
  gl.azimuthelevation(a, 15)
  gl.wait(120)
}
gl.savebmp('rotacao.png')
`
}

/** Converte a sintaxe mínima de Python dos scripts do MRIcroGL para JavaScript. */
export function traduzir(codigo) {
  return codigo
    .split('\n')
    .map((linha) => {
      if (/^\s*(import|from)\s+\w+/.test(linha) && !/['"`(]/.test(linha)) return ''
      if (/^\s*#/.test(linha)) return linha.replace('#', '//')
      return linha.replace(/\b(True|False|None)\b/g, (m) => ({ True: 'true', False: 'false', None: 'null' })[m])
    })
    .join('\n')
}

export function criarGL(app, escrever) {
  const nv = app.nv
  let fila = Promise.resolve()
  let cancelado = false
  const avisados = new Set()
  const negativas = new WeakSet() // camadas exibindo só a faixa negativa
  const camada = (i) => {
    const v = nv.volumes[i]
    if (!v) throw new Error(`camada ${i} não existe (há ${nv.volumes.length} imagem(ns) aberta(s))`)
    return v
  }
  const cor = (r, g, b, a = 255) => [r / 255, g / 255, b / 255, a / 255]

  const f = {
    version: () => 'Triplanar 1.0 (API compatível com MRIcroGL 1.2)',
    resetdefaults: () => app.redefinir(),
    loadimage: (nome) => app.carregarPorNome(nome, false),
    overlayload: (nome) => app.carregarPorNome(nome, true),
    drawload: (nome) => app.carregarDesenhoPorNome(nome),
    overlaycloseall: () => app.fecharSobreposicoes(),
    overlaycount: () => Math.max(0, nv.volumes.length - 1),
    minmax: (i, mn, mx) => {
      const v = camada(i)
      // No MRIcroGL, min = max define um limiar de cor única; faixas negativas mostram só os valores abaixo de zero.
      const [a, b] = [Math.min(mn, mx), Math.max(mn, mx)]
      const eps = a === b ? Math.max(1e-6, Math.abs(a) * 1e-4) : 0
      if (i > 0 && b <= 0 && a < 0) {
        // Faixa negativa: usa o mapa de cores negativo do NiiVue e empurra a faixa positiva para fora dos dados.
        const fora = Math.abs(v.global_max || 1) * 10 + 1
        if (!negativas.has(v)) v.colormapNegative = v.colormap
        negativas.add(v)
        v.cal_minNeg = a - eps
        v.cal_maxNeg = b
        v.cal_min = fora
        v.cal_max = fora * 2
      } else {
        if (negativas.delete(v)) v.colormapNegative = ''
        v.cal_minNeg = NaN
        v.cal_maxNeg = NaN
        v.cal_min = a
        v.cal_max = b + eps
      }
      nv.updateGLVolume()
    },
    opacity: (i, pct) => {
      camada(i)
      nv.setOpacity(i, Math.min(100, Math.max(0, pct)) / 100)
    },
    colorname: (i, nome) => {
      const v = camada(i)
      const alvo = String(nome).replace(/^\d+/, '').toLowerCase()
      const achado = nv.colormaps().find((c) => c.toLowerCase() === alvo)
      if (!achado) throw new Error(`esquema de cores "${nome}" não encontrado`)
      if (negativas.has(v)) nv.setColormapNegative(v.id, achado)
      else app.definirCores(v, achado)
    },
    invertcolor: (i, b) => {
      camada(i).colormapInvert = !!b
      nv.updateGLVolume()
    },
    volume: (i, vol) => nv.setFrame4D(camada(i).id, vol),
    colorbarposition: (p) => {
      nv.opts.isColorbar = p > 0
      nv.drawScene()
    },
    backcolor: (r, g, b) => {
      nv.opts.backColor = cor(r, g, b)
      nv.drawScene()
    },
    linecolor: (r, g, b) => nv.setCrosshairColor(cor(r, g, b)),
    linewidth: (w) => nv.setCrosshairWidth(w * 0.5), // 1 no MRIcroGL ≈ 0,5% do campo de visão
    view: (v) => app.definirVisao({ 1: 'axial', 2: 'coronal', 4: 'sagital', 8: 'sagitalE', 16: 'mpr', 32: 'mosaico', 64: 'render' }[v] || 'mpr'),
    mosaic: (s) => app.definirMosaico(String(s)),
    orthoviewmm: (x, y, z) => {
      app.definirVisao('mpr')
      app.irParaMM([x, y, z])
    },
    azimuthelevation: (a, e) => nv.setRenderAzimuthElevation(a, e),
    viewaxial: (superior) => nv.setRenderAzimuthElevation(0, superior ? 90 : -90),
    viewcoronal: (posterior) => nv.setRenderAzimuthElevation(posterior ? 0 : 180, 0),
    viewsagittal: (esquerda) => nv.setRenderAzimuthElevation(esquerda ? 90 : 270, 0),
    cameradistance: (z) => nv.setScale(Math.max(0.1, 2.25 / Math.max(0.1, z))),
    clipazimuthelevation: (prof, azi, elev) => nv.setClipPlane(prof <= 0 ? [2, 0, 0] : [0.5 - Math.min(1, prof), azi, elev]),
    overlayadditiveblending: (v) => nv.setAdditiveBlend(!!v),
    overlayloadsmooth: (v) => nv.setInterpolation(!v),
    extract: (b = 1, s = 1, t = 5) => nv.removeHaze(t, 0),
    removesmallclusters: (i, limiar, mm, viz = 3) => {
      camada(i)
      aplicarRemocaoDeClusters(nv, i, limiar, mm, { 1: 6, 2: 18, 3: 26 }[viz] || 26)
    },
    savebmp: (nome = 'captura.png') => app.capturar(String(nome)),
    saveimg: (nome = 'imagem.nii.gz') => app.salvarVolume(0, String(nome)),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    modalmessage: (msg) => alert(String(msg)),
    fullscreen: (b) => app.telaCheia(!!b),
    toolformvisible: (b) => app.painelVisivel(!!b),
    quit: () => {
      cancelado = true
    }
  }

  const gl = new Proxy(
    {},
    {
      get(_, nome) {
        if (typeof nome !== 'string' || nome === 'then') return undefined
        const fn = f[nome]
        if (!fn) {
          return (...args) => {
            if (!avisados.has(nome)) {
              avisados.add(nome)
              escrever(`aviso: gl.${nome}() não está disponível na versão web e foi ignorado.`, 'aviso')
            }
            return Promise.resolve()
          }
        }
        return (...args) => {
          const p = fila.then(async () => {
            if (cancelado) return undefined
            try {
              const r = await fn(...args)
              app.atualizar()
              return r
            } catch (erro) {
              throw new Error(`gl.${nome}(): ${erro.message || erro}`)
            }
          })
          fila = p.catch(() => {})
          return p
        }
      }
    }
  )
  return {
    gl,
    cancelar: () => (cancelado = true),
    /** Espera o esvaziamento da fila. */
    terminar: () => fila
  }
}

const FuncaoAssincrona = Object.getPrototypeOf(async function () {}).constructor

/** Executa um script (JavaScript ou Python mínimo do MRIcroGL). */
export async function executarScript(codigo, app, escrever) {
  const ctx = criarGL(app, escrever)
  const pendentes = []
  const gl = new Proxy(ctx.gl, {
    get(alvo, nome) {
      const fn = alvo[nome]
      if (typeof fn !== 'function') return fn
      return (...args) => {
        const p = fn(...args)
        p.catch(() => {}) // o erro é relatado ao final, por allSettled
        pendentes.push(p)
        return p
      }
    }
  })
  const print = (...args) => escrever(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
  const corpo = traduzir(codigo)
  const fn = new FuncaoAssincrona('gl', 'print', 'nv', corpo)
  await fn(gl, print, app.nv)
  // Propaga o primeiro erro de qualquer chamada gl.* enfileirada.
  const resultados = await Promise.allSettled(pendentes)
  await ctx.terminar()
  const falha = resultados.find((r) => r.status === 'rejected')
  if (falha) throw falha.reason
  return ctx
}
