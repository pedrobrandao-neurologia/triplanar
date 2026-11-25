# Avisos de terceiros

O Triplanar distribui e deriva de:

- **NiiVue** 0.69.0 — `vendor/niivue/niivue.min.js` (BSD 2-Clause, © 2021 Niivue). Licença em `vendor/niivue/LICENSE`. O pacote embute suas dependências (gl-matrix, fflate, nifti-reader-js, zarrita e outras, sob licenças MIT/BSD).
- **dcm2niix** v1.0.20261029 compilado para WebAssembly — `vendor/dcm2niix/` (BSD 2-Clause, © Chris Rorden; inclui OpenJPEG, CharLS e outros). Licença e avisos em `vendor/dcm2niix/LICENSE` e `vendor/dcm2niix/NOTICES`.
- **MRIcroGL** 1.2 (BSD 2-Clause, © 2014-2019 Chris Rorden) — a organização dos menus, as opções do conversor, a sintaxe de mosaico, os nomes das funções `gl.*` e os scripts de exemplo em `js/script.js` seguem o MRIcroGL. Nenhum código binário do MRIcroGL é distribuído. Conforme a licença, o nome MRIcroGL não é usado para endossar este projeto.

As imagens-padrão (MNI152, SPM152 etc.) não são distribuídas aqui: o aplicativo as baixa de `github.com/rordenlab/MRIcroGL` quando o usuário pede; suas licenças estão em `Resources/standard/README.md` daquele repositório.
