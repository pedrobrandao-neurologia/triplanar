# Triplanar

PWA em português para visualizar neuroimagem e **converter DICOM em NIfTI** direto no navegador. Reúne as
funções centrais do [MRIcroGL](https://github.com/rordenlab/MRIcroGL) (v1.2.20220720) numa página que
funciona offline e pode ser instalada no computador, no tablet ou no celular.

**As imagens não saem do aparelho.** A leitura, a conversão e a renderização acontecem localmente; não há servidor.

> Uso em pesquisa e ensino. Não é um dispositivo médico e não deve ser usado para diagnóstico.

## Como usar

Depois do merge na `main`, o workflow `.github/workflows/pages.yml` publica o app no GitHub Pages
(`https://pedrobrandao-neurologia.github.io/triplanar/`). Para rodar localmente, sirva a pasta por HTTP
(módulos ES, Web Worker e service worker não funcionam em `file://`):

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000`. No Chrome/Edge aparece o botão **Instalar app**; no iPhone/iPad, use
Compartilhar → Adicionar à Tela de Início.

## O que faz

| Área | Funções |
|---|---|
| **DICOM → NIfTI** | Pasta, arquivos soltos ou `.zip`; lista as séries antes de converter; nome de saída com `%p`, `%s`, `%t`…; saída `.nii.gz`, `.nii` ou `.nrrd`; sidecar BIDS (anonimizado ou completo); mesclar fatias 2D; ignorar derivadas/localizadores; recorte 3D; escala Philips; registro do dcm2niix; baixar cada arquivo, tudo em `.zip` ou gravar numa pasta |
| **Abrir** | NIfTI (`.nii`, `.nii.gz`, par `.hdr/.img`), NRRD, MGH/MGZ, MIF, MHA/MHD, AFNI `HEAD/BRIK` e DICOM (convertido em memória); arrastar e soltar; imagens-padrão do MRIcroGL (MNI152, SPM152, T2, angio-RM, TC, mapa de fMRI) |
| **Visões** | Multiplanar A+C+S, A+C+S+3D, axial, coronal, sagital (inclusive nariz à esquerda), renderização 3D e mosaico (mesma sintaxe de texto do MRIcroGL) |
| **Camadas** | Sobreposições com esquema de cores, faixa mais escuro/mais claro, opacidade, inversão, cores para valores negativos, ordem das camadas, mistura aditiva; volumes 4D com animação e gráfico temporal |
| **3D** | Plano de corte (profundidade, azimute, elevação), recorte em cunha, câmera, iluminação e opacidade pelas bordas |
| **Desenho (VOI)** | Caneta, retângulo, elipse, preenchimento, borracha, desfazer, clique para segmentar, Otsu automático, GrowCut, interpolação entre fatias; abrir e salvar VOI em NIfTI |
| **Ferramentas** | Cabeçalho NIfTI, histograma, estatísticas descritivas (volume inteiro ou dentro do desenho), tabela de clusters com pico e centro de massa, remover clusters pequenos, remover névoa, reamostrar para 256³ a 1 mm, medir distância e ângulo |
| **Salvar** | Volume em NIfTI, captura PNG, copiar imagem, cena `.nvd` |
| **Scripts** | Console com a API `gl.*` do MRIcroGL em JavaScript. Scripts simples do MRIcroGL (`import gl` + chamadas `gl.*`) rodam sem alteração |

### O que não foi portado

- Shaders de renderização trocáveis (`shadername`, matcaps), `cutout` e MIP: o motor web tem um único modo de renderização volumétrica.
- "Extract Brain" (depende do FSL BET), integração com AFNI/FSL e scripts Python completos (só chamadas `gl.*`, não bibliotecas Python).
- Conversão de pilhas TIFF e correlação por semente em fMRI.

## Como foi feito

O executável enviado (`MRIcroGL.exe`, Lazarus/FreePascal) foi inspecionado para levantar menus, opções do
conversor e a lista de funções de script. O MRIcroGL e o dcm2niix são de código aberto (BSD), então nada
precisou ser descompilado: o app usa os equivalentes web mantidos pelo mesmo grupo.

- [NiiVue](https://github.com/niivue/niivue) 0.69.0 — visualização WebGL2 (`vendor/niivue`).
- [dcm2niix](https://github.com/rordenlab/dcm2niix) v1.0.20261029 em WebAssembly, com OpenJPEG e CharLS (`vendor/dcm2niix`).

Sem etapa de build: HTML, CSS e módulos ES.

```
triplanar/
├── index.html            interface
├── manifest.webmanifest  instalação (PWA)
├── sw.js                 cache offline — troque VERSAO ao atualizar vendor/
├── css/app.css
├── js/app.js             visualizador, menus, painel
├── js/dicom.js           conversor DICOM → NIfTI
├── js/ferramentas.js     cabeçalho, histograma, estatísticas, clusters
├── js/script.js          API gl.* (scripts)
├── js/util.js            utilitários, leitura e gravação de .zip
├── vendor/               NiiVue e dcm2niix (com licenças)
└── tests/                testes das partes que não dependem do navegador (npm test)
```

As imagens-padrão não estão no repositório: são baixadas do repositório do MRIcroGL no primeiro uso e
guardadas no cache do navegador. Cada uma tem licença própria (várias são CC BY-NC 4.0).

## Privacidade no nome dos arquivos

O nome de saída padrão do dcm2niix (`%f_%p_%t_%s`) inclui o nome da pasta de origem, que muitas vezes é o
nome do paciente. `%n` e `%i` gravam nome e ID do paciente. Para compartilhar, prefira `%p_%s` e mantenha o
sidecar BIDS em "Sim, anonimizado".

## Licença dos componentes

Ver `vendor/niivue/LICENSE`, `vendor/dcm2niix/LICENSE`, `vendor/dcm2niix/NOTICES` e `THIRD_PARTY_NOTICES.md`. O Triplanar é um projeto independente e não é endossado pelos autores do MRIcroGL.
