import { createRequire } from "node:module"
import { dirname } from "node:path"

import { lerComoCartao } from "./cartao.js"
import { classificarTextoLocal } from "./classificacao.js"
import { MAX_PIXELS_IMAGEM } from "./dimensoes-imagem.js"
import { extrairImagensGrandes, paginaTemImagemGrande } from "./imagens-pdf.js"
import { LeitorOcr } from "./ocr-imagem.js"
import { LeitorPaddle, paddleDisponivel } from "./ocr-paddle.js"
import { codificarPng } from "./png.js"
import type { TipoDocumento } from "./tipos.js"

export interface ResultadoPdf {
  texto: string
  metodo: "texto_pdf" | "ocr_imagem_pdf" | "ocr_pagina_pdf" | "sem_texto"
  /**
   * Só quando a leitura completa rodou: a classificação feita ANTES dela, que
   * vale no lugar de reclassificar o texto do documento inteiro (ver
   * `lerDocumento`).
   */
  classificacao?: ReturnType<typeof classificarTextoLocal>
  /** O texto só classificou com o passo "cartão" (ver `comFallbackDeNomeArquivo` em index.ts). */
  viaCartao?: boolean
}

export interface OpcoesPdf {
  /** Ver `OpcoesLeitura.leituraCompleta` em index.ts. */
  leituraCompleta?: readonly TipoDocumento[]
  /** Ver `OpcoesLeitura.ocr` em index.ts. */
  ocr?: "tesseract" | "paddle"
}

/** O que o motor usa de um leitor de OCR — Tesseract (`LeitorOcr`) ou Paddle (`LeitorPaddle`). */
type Ocr = Pick<LeitorOcr, "reconhecer" | "garantirWorkers" | "encerrar">

async function escolherOcr(opcoes: OpcoesPdf): Promise<Ocr> {
  return opcoes.ocr === "paddle" && (await paddleDisponivel()) ? new LeitorPaddle() : new LeitorOcr()
}

export type CanvasNativo = typeof import("@napi-rs/canvas")

const MAX_PAGINAS = 15
const MIN_CARACTERES_POR_PAGINA = 20
const MAX_IMAGENS_OCR = 6
// Abaixo disso por página, PDF de texto que não classificou é renderizado (ver lerDocumento).
const MIN_CARACTERES_FORMULARIO_VETORIAL = 300
// Renderizar custa segundos por pagina (desenho + OCR); pra CLASSIFICAR, so as
// primeiras paginas candidatas entram — formulario traz o titulo na pagina 1.
const MAX_PAGINAS_RENDERIZADAS = 3
// ~216 dpi numa pagina A4: abaixo disso o OCR comeca a perder letra pequena.
const ESCALA_RENDERIZACAO = 3
// A pagina desenhada nao passa deste lado maior (px). Uma A4 a 3x tem 2526; um
// escaneamento de tamanho A0 (2192x2752 pt) virava 6576x8256 px — PNG de 29 MB, e
// uma pagina de passaporte levava 151 s (06/10/2026). A3 fica em ~154 dpi, o
// bastante para o texto maior dela.
const LADO_MAXIMO_RENDERIZACAO_PX = 3600
// Exige 2+ sinais de palavra-chave antes de confiar no texto direto do PDF e pular o
// fallback de OCR — um unico sinal isolado costuma vir de texto de capa/certificacao
// (ex: rodape "SENATRAN" numa CNH digital cujo conteudo real esta numa imagem embutida).
const CONFIANCA_MINIMA_PARA_CONFIAR_NO_TEXTO_DIRETO = 2 / 3
// Leitura completa (ex: matricula). Uma matricula escaneada real leva 4-10 s de
// OCR por pagina; em serie, uma de 8 paginas passava de 45 s.
const MAX_PAGINAS_LEITURA_COMPLETA = 40
const OCRS_EM_PARALELO = 2

// pdf.js decodifica parte dos formatos de imagem de scanner com WebAssembly,
// carregado de `wasmUrl` — e no Node ninguem passa isso por padrao. Sem ele a
// imagem sai em branco na renderizacao, sem erro nenhum: numa matricula real
// escaneada em preto e branco (CCITT), a pagina desenhada so trazia o carimbo
// digital do rodape. As fontes padrao entram pelo mesmo motivo (texto de PDF
// que nao embute a fonte).
const DIRETORIO_PDFJS = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")).replace(/\\/g, "/")
const RECURSOS_PDFJS = {
  wasmUrl: `${DIRETORIO_PDFJS}/wasm/`,
  standardFontDataUrl: `${DIRETORIO_PDFJS}/standard_fonts/`,
}

/**
 * Le o conteudo textual de um PDF, do caminho mais barato pro mais caro:
 *
 * 1. Camada de texto (PDF nato-digital) — rapido, sem OCR.
 * 2. OCR nas imagens grandes embutidas (documento oficial digital cujo conteudo
 *    real e uma imagem — ex: CNH digital), sem renderizar a pagina.
 * 3. Renderizar a pagina inteira e passar OCR, quando o documento ainda nao
 *    classificou. Existe porque ha documento com o conteudo desenhado como
 *    caminhos vetoriais — sem operador de texto e sem imagem — e os passos 1 e
 *    2 nao enxergam nada (DAMP e pesquisa cadastral da Caixa Aqui), e scan que
 *    o passo 2 nao pega (tons de cinza, preto e branco, pagina em faixas).
 * 4. So para os tipos em `opcoes.leituraCompleta`: depois de classificar, OCR
 *    de TODAS as paginas escaneadas, e o texto remontado na ordem das paginas.
 */
export async function lerConteudoPdf(bytes: Uint8Array, opcoes: OpcoesPdf = {}): Promise<ResultadoPdf> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs")
  // pdf.js roda em modo "fake worker" (thread principal) no Node. Por padrao ele resolve
  // o caminho do worker via workerSrc e importa dinamicamente — resolucao de caminho que
  // bundlers (Turbopack, webpack) frequentemente rompem. Registrar o worker direto em
  // globalThis.pdfjsWorker e o padrao suportado pelo proprio pdf.js pra evitar essa
  // resolucao: PDFWorker usa esse objeto global antes de tentar importar por workerSrc.
  const globalComWorker = globalThis as typeof globalThis & { pdfjsWorker?: unknown }
  // @ts-expect-error pdf.worker.mjs nao publica .d.ts, mas o import funciona em runtime.
  globalComWorker.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs")

  // Cópia: o pdf.js toma posse da memória que recebe e deixa o Buffer de quem
  // chamou inutilizável ("detached ArrayBuffer"). Ler o mesmo documento de
  // novo — o Tesseract de reserva depois do Paddle — dava erro e texto vazio.
  const dados = new Uint8Array(bytes)
  // Imagem embutida acima do teto não é decodificada pelo pdf.js (ver dimensoes-imagem.ts).
  const carregamento = pdfjsLib.getDocument({ data: dados, ...RECURSOS_PDFJS, maxImageSize: MAX_PIXELS_IMAGEM })
  const documento = await carregamento.promise

  try {
    const ocr = await escolherOcr(opcoes)
    try {
      return await lerDocumento(documento, pdfjsLib, ocr, opcoes)
    } finally {
      await ocr.encerrar()
    }
  } finally {
    // Libera o documento (páginas, fontes, imagens decodificadas): quem chama
    // costuma ser uma thread que vive muito e lê documento atrás de documento.
    // No pdf.js 6 quem destrói é a tarefa de carregamento.
    await carregamento.destroy()
  }
}

async function lerDocumento(documento: any, pdfjsLib: any, ocr: Ocr, opcoes: OpcoesPdf): Promise<ResultadoPdf> {
  const totalPaginas = Math.min(documento.numPages, MAX_PAGINAS)

  const paginas: any[] = []
  const textoPorPagina: string[] = []
  for (let numero = 1; numero <= totalPaginas; numero++) {
    const pagina = await documento.getPage(numero)
    paginas.push(pagina)
    textoPorPagina.push(await textoDaPagina(pagina))
  }

  const textoDireto = textoPorPagina.join("\n").trim()
  const mediaPorPagina = textoDireto.length / totalPaginas
  const classificacaoDireta =
    mediaPorPagina >= MIN_CARACTERES_POR_PAGINA ? classificarTextoLocal(textoDireto, { paginas: documento.numPages }) : null
  const confiaNoTextoDireto =
    classificacaoDireta !== null &&
    classificacaoDireta.confianca >= CONFIANCA_MINIMA_PARA_CONFIAR_NO_TEXTO_DIRETO

  // Quais páginas tentam OCR nas imagens embutidas. Quando o texto direto do
  // documento inteiro já é confiável pra classificar, só entram as páginas que
  // INDIVIDUALMENTE não têm texto próprio suficiente — um documento pode ter
  // capa e fechamento digitais (texto de sobra pra classificar com confiança)
  // e o corpo real escaneado (ex: matrícula de imóvel "atualizada": só a
  // certidão de abertura/fechamento é nato-digital, o histórico de registro
  // no meio é imagem). Sem esse filtro por página, a confiança já satisfeita
  // pelas 2 páginas digitais fazia o motor nunca sequer tentar OCR no corpo
  // escaneado — silenciosamente, sem erro nenhum. Quando o texto direto
  // GLOBAL não é confiável, tenta em todas as páginas, como sempre foi.
  const indicesParaOcr = confiaNoTextoDireto
    ? textoPorPagina
        .map((texto, indice) => (texto.trim().length < MIN_CARACTERES_POR_PAGINA ? indice : -1))
        .filter((indice) => indice >= 0)
    : textoPorPagina.map((_, indice) => indice)

  const textosOcr: string[] = []
  let imagensProcessadas = 0

  for (const indice of indicesParaOcr) {
    if (imagensProcessadas >= MAX_IMAGENS_OCR) break
    const imagens = await extrairImagensGrandes(paginas[indice], pdfjsLib)

    for (const imagem of imagens) {
      if (imagensProcessadas >= MAX_IMAGENS_OCR) break
      const png = codificarPng(imagem.largura, imagem.altura, imagem.canais, imagem.pixels)
      const resultado = await ocr.reconhecer(png)
      textosOcr.push(resultado.texto)
      imagensProcessadas++
    }
  }

  const textoOcr = textosOcr.join("\n").trim()
  let resultado = montarResultado(confiaNoTextoDireto, textoDireto, textoOcr)
  const renderizadas = new Map<number, string>()

  // Um sinal só também renderiza: numa alteração contratual escaneada em tons
  // de cinza, as imagens lidas eram só os carimbos coloridos da Junta (1
  // sinal, "junta comercial") e o corpo do contrato nunca passava pelo OCR.
  if (classificarTextoLocal(resultado.texto, { paginas: documento.numPages }).sinais.length < 2) {
    const candidatas: number[] = []
    for (let indice = 0; indice < paginas.length; indice++) {
      if (await precisaDeOcr(paginas[indice], textoPorPagina[indice]!, pdfjsLib)) candidatas.push(indice)
    }
    // Pouco texto e nenhum scan: formulário com o modelo desenhado em vetor e
    // só os campos preenchidos como texto (autorização do Bradesco real: 254
    // caracteres em 2 páginas, só nomes, datas e CPFs). Desenhada, a página lê.
    if (candidatas.length === 0 && mediaPorPagina < MIN_CARACTERES_FORMULARIO_VETORIAL) {
      candidatas.push(...paginas.map((_, indice) => indice))
    }
    // Pagina com texto de sobra, sem scan, que mesmo assim nao classificou e
    // documento de tipo desconhecido — renderizar nao acrescentaria nada.
    const canvasNativo = candidatas.length > 0 ? await carregarCanvas() : undefined
    if (!canvasNativo) return resultado

    await ocrDePaginasRenderizadas(paginas, candidatas, resultado.texto, canvasNativo, ocr, renderizadas)
    const textoRenderizado = [...renderizadas.values()].join("\n").trim()
    if (textoRenderizado) {
      resultado = { texto: [resultado.texto, textoRenderizado].filter(Boolean).join("\n"), metodo: "ocr_pagina_pdf" }
    }

    // Ainda nada: pode ser CNH/RG pequeno no meio da folha, ou de lado (ver
    // cartao.ts). Só no Tesseract: o Paddle acha texto pequeno na folha e
    // resolve o giro sozinho, e o cartão é feito de modos de leitura do Tesseract.
    if (ocr instanceof LeitorOcr && classificarTextoLocal(resultado.texto).tipo === "outro") {
      const folha = await renderizarPagina(paginas[candidatas[0]!], canvasNativo)
      const textoCartao = await lerComoCartao(folha, canvasNativo)
      if (textoCartao) {
        resultado = {
          texto: [resultado.texto, textoCartao].filter(Boolean).join("\n"),
          metodo: "ocr_pagina_pdf",
          viaCartao: true,
        }
      }
    }
  }

  // O tipo fica decidido aqui, ANTES da leitura completa — o resto do
  // documento só enriquece o texto, nunca reclassifica. Matrícula qualifica as
  // partes citando "certidão de casamento", "Registro Civil das Pessoas
  // Naturais", "livro B": com o texto inteiro, uma matrícula real passava a
  // ganhar como certidão de estado civil (4 sinais contra 2).
  const classificacao = classificarTextoLocal(resultado.texto, { paginas: documento.numPages })
  if (!opcoes.leituraCompleta?.includes(classificacao.tipo)) return resultado

  // A leitura completa (matrícula, até 40 páginas) fica com o Tesseract, duas
  // páginas em paralelo: o Paddle lê uma imagem por vez, a ~6 s cada nesta CPU,
  // e matrícula datilografada o Tesseract já lê bem.
  const ocrCompleta = ocr instanceof LeitorPaddle ? new LeitorOcr() : ocr
  try {
    const completo = await lerTodasAsPaginas(documento, pdfjsLib, ocrCompleta, renderizadas)
    return { ...(completo ?? resultado), classificacao }
  } finally {
    if (ocrCompleta !== ocr) await ocrCompleta.encerrar()
  }
}

function montarResultado(confiaNoTextoDireto: boolean, textoDireto: string, textoOcr: string): ResultadoPdf {
  if (confiaNoTextoDireto) {
    // O texto global já é confiável pra classificar o documento — o OCR das
    // páginas esparsas só ENRIQUECE o conteúdo, nunca decide o tipo.
    const textoCompleto = textoOcr.length > 0 ? `${textoDireto}\n${textoOcr}` : textoDireto
    return { texto: textoCompleto, metodo: textoOcr.length > 0 ? "ocr_imagem_pdf" : "texto_pdf" }
  }
  if (textoOcr.length > 0) return { texto: textoOcr, metodo: "ocr_imagem_pdf" }
  if (textoDireto.length > 0) return { texto: textoDireto, metodo: "texto_pdf" }
  return { texto: "", metodo: "sem_texto" }
}

// Tolerancia (pontos) pra tratar dois itens como da mesma linha visual: um
// formulario gerado por sistema (ex: "Formulario de Impressao" da Caixa) pode
// desenhar rotulo e valor da mesma linha com baseline levemente diferente.
const TOLERANCIA_MESMA_LINHA_PT = 6

/**
 * Ordem de leitura (cima pra baixo, esquerda pra direita) a partir da posicao
 * de cada item — a ordem do stream do PDF nem sempre e a ordem visual. Um
 * formulario de avaliacao de risco real (Caixa/SIOPI) desenhava o VALOR antes
 * do ROTULO ("TR 520.000,00 PRICE ... Indexador Codigo Avaliacao"): sem
 * reordenar, rotulo e valor ficavam longe um do outro no texto e nao dava pra
 * casar um com o outro.
 *
 * ponytail: comparador de "mesma linha" nao e uma ordem total (a vs b perto,
 * b vs c perto, a vs c longe quebraria), mas as linhas reais tem ~20pt de
 * distancia entre si contra 6pt de tolerancia — na pratica nao colide. Se um
 * documento futuro tiver linhas mais proximas que isso, agrupar por cluster
 * de y em vez de tolerancia par-a-par.
 */
async function textoDaPagina(pagina: any): Promise<string> {
  const conteudo = await pagina.getTextContent()
  const itens: { x: number; y: number; texto: string }[] = conteudo.items
    .filter((item: any) => "str" in item && item.str)
    .map((item: any) => ({ x: item.transform[4] as number, y: item.transform[5] as number, texto: item.str as string }))
  itens.sort((a, b) => (Math.abs(a.y - b.y) > TOLERANCIA_MESMA_LINHA_PT ? b.y - a.y : a.x - b.x))
  return itens.map((item) => item.texto).join(" ")
}

/** Página sem texto próprio, ou com um scan — o carimbo digital de uma certidão não conta como conteúdo. */
async function precisaDeOcr(pagina: any, texto: string, pdfjsLib: any): Promise<boolean> {
  return texto.trim().length < MIN_CARACTERES_POR_PAGINA || (await paginaTemImagemGrande(pagina, pdfjsLib))
}

/**
 * O canvas vem de `@napi-rs/canvas` (binario nativo, opcional): se o host nao
 * tiver o binario, o import falha e o motor segue sem renderizar em vez de
 * quebrar a leitura inteira.
 */
export async function carregarCanvas(): Promise<CanvasNativo | undefined> {
  try {
    return await import("@napi-rs/canvas")
  } catch {
    return undefined
  }
}

export async function renderizarPagina(pagina: any, canvasNativo: CanvasNativo): Promise<Buffer> {
  const base = pagina.getViewport({ scale: 1 })
  const escala = Math.min(ESCALA_RENDERIZACAO, LADO_MAXIMO_RENDERIZACAO_PX / Math.max(base.width, base.height))
  const viewport = pagina.getViewport({ scale: escala })
  const canvas = canvasNativo.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const contexto = canvas.getContext("2d")
  // Fundo branco explicito: o canvas nasce transparente, e o OCR le
  // transparente como preto.
  contexto.fillStyle = "#ffffff"
  contexto.fillRect(0, 0, canvas.width, canvas.height)
  await pagina.render({ canvasContext: contexto, canvas, viewport }).promise
  return Buffer.from(await canvas.encode("png"))
}

/** Renderiza as candidatas em ordem e para assim que o texto já classifica. Guarda o OCR de cada página em `saida`. */
async function ocrDePaginasRenderizadas(
  paginas: any[],
  indices: number[],
  textoAnterior: string,
  canvasNativo: CanvasNativo,
  ocr: Ocr,
  saida: Map<number, string>,
): Promise<void> {
  for (const indice of indices.slice(0, MAX_PAGINAS_RENDERIZADAS)) {
    const png = await renderizarPagina(paginas[indice], canvasNativo)
    saida.set(indice, (await ocr.reconhecer(png)).texto)

    // Cada página custa segundos, e este caminho existe pra classificar: assim
    // que o texto já basta, para. Formulário de banco traz o título na página
    // 1 — num DAMP real de 3 páginas, renderizar todas levava ~17 s pela API.
    const confianca = classificarTextoLocal([textoAnterior, ...saida.values()].join("\n")).confianca
    if (confianca >= CONFIANCA_MINIMA_PARA_CONFIAR_NO_TEXTO_DIRETO) break
  }
}

/**
 * Leitura completa: OCR de toda página escaneada (reaproveitando as que a
 * classificação já leu) e o texto remontado página a página — texto próprio
 * seguido do OCR. A ordem importa: na matrícula, o que decide se a alienação
 * fiduciária ainda vale é o que vem DEPOIS dela no texto.
 *
 * Devolve `undefined` quando não há canvas ou nenhuma página precisou de OCR —
 * aí quem chamou fica com o resultado que já tinha.
 */
async function lerTodasAsPaginas(
  documento: any,
  pdfjsLib: any,
  ocr: Ocr,
  jaLidas: Map<number, string>,
): Promise<ResultadoPdf | undefined> {
  const canvasNativo = await carregarCanvas()
  if (!canvasNativo) return undefined

  const total = Math.min(documento.numPages, MAX_PAGINAS_LEITURA_COMPLETA)
  const diretos: string[] = []
  const ocrs = new Map(jaLidas)
  const emAndamento = new Set<Promise<void>>()
  await ocr.garantirWorkers(OCRS_EM_PARALELO)

  for (let indice = 0; indice < total; indice++) {
    const pagina = await documento.getPage(indice + 1)
    const direto = await textoDaPagina(pagina)
    diretos.push(direto)
    if (ocrs.has(indice) || !(await precisaDeOcr(pagina, direto, pdfjsLib))) continue

    const png = await renderizarPagina(pagina, canvasNativo)
    const tarefa: Promise<void> = ocr
      .reconhecer(png)
      .then((resultado) => void ocrs.set(indice, resultado.texto))
      // Uma página que falha no OCR fica só com o texto próprio — não derruba o documento.
      .catch(() => undefined)
      .finally(() => emAndamento.delete(tarefa))
    emAndamento.add(tarefa)
    // Desenhar é mais rápido que reconhecer: sem esse freio, as páginas
    // renderizadas se acumulariam na memória esperando um worker livre.
    if (emAndamento.size >= OCRS_EM_PARALELO * 2) await Promise.race(emAndamento)
  }
  await Promise.all(emAndamento)

  if (ocrs.size === 0) return undefined

  const texto = diretos.map((direto, indice) => [direto, ocrs.get(indice)].filter(Boolean).join("\n")).join("\n")
  return { texto: texto.trim(), metodo: "ocr_pagina_pdf" }
}
