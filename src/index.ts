import { classificarTextoLocal } from "./classificacao.js"
import { imagemGrandeDemais } from "./dimensoes-imagem.js"
import { classificarNomeArquivoLocal } from "./nome-arquivo.js"
import { ocrImagem } from "./ocr-imagem.js"
import { LeitorPaddle, paddleDisponivel } from "./ocr-paddle.js"
import { lerComoCartao } from "./cartao.js"
import { carregarCanvas, lerConteudoPdf } from "./pdf.js"
import type { TipoDocumento } from "./tipos.js"
import { extrairDados, type DadosDocumento } from "./dados.js"

export type { TipoDocumento } from "./tipos.js"
export { tiposDocumento } from "./tipos.js"
export { extrairDados, extrairNomeTitular, type CampoLido, type DadosDocumento } from "./dados.js"
export { completarComConsultas, cidadeDaMatricula, enderecoPorCep, type Municipio } from "./lugares.js"
/** Os extratores um a um (CPF, CNH, filiação, matrícula, holerite…), para quem quiser montar o próprio fluxo. */
export * as extracao from "./extracao.js"

export type MetodoLeitura =
  | "texto_pdf"
  | "ocr_imagem_pdf"
  | "ocr_pagina_pdf"
  | "ocr_imagem"
  | "sem_texto"
  | "nao_suportado"
  | "erro"
  /** PDF que pede senha para abrir: não tem como ler, e quem anexa precisa mandar a versão sem senha. */
  | "protegido_por_senha"
  | "nome_arquivo"

export interface ResultadoLeitura {
  texto: string
  metodo: MetodoLeitura
  tipo: TipoDocumento
  confianca: number
  sinais: string[]
  /**
   * O tipo que o nome do arquivo diz, quando diz. Com este campo, `tipo` é o
   * do nome e quem consome pode agir sem olhar a confiança, que continua
   * sendo a do conteúdo (é ela que decide se o OCR sobe para o Paddle).
   */
  tipoPeloNome?: TipoDocumento
  /**
   * Só quando o nome diz um tipo e o conteúdo, firme (2+ sinais), diz outro:
   * vale o do nome e aqui vai o que o motor leu — quem consome avisa e oferece
   * a troca, nunca troca sozinho.
   */
  tipoPeloConteudo?: TipoDocumento
  /** Qual OCR leu (só quando houve OCR). "paddle+tesseract": o Paddle saiu fraco e os dois textos vão juntos. */
  ocr?: "tesseract" | "paddle" | "paddle+tesseract"
  /**
   * Os dados do documento (CPF, nº da CNH, filiação, proprietários da
   * matrícula, renda do holerite…), já com rótulo legível — ver `dados.ts`.
   * Ausente quando não há texto ou com `extrairDados: false`.
   */
  dados?: DadosDocumento
}

export interface OpcoesLeitura {
  /** Tempo maximo em ms antes de desistir e devolver metodo "erro". Padrao: 60000. */
  timeoutMs?: number
  /**
   * Nome original do arquivo enviado: quem sobe o documento às vezes já nomeia
   * o arquivo com o tipo (ex: "DAMP_cliente.pdf"), e alguns documentos vêm
   * ilegíveis pro motor (ver comentário sobre DAMP em classificacao.ts).
   * Quando o nome diz o tipo, vale o nome (ver `comFallbackDeNomeArquivo`).
   */
  nomeArquivo?: string
  /**
   * Tipos em que o documento inteiro importa, não só o bastante pra
   * classificar — ex: matrícula de imóvel, em que a baixa da alienação
   * fiduciária é uma averbação no fim. Para esses, depois de classificar um
   * PDF, o motor passa OCR em todas as páginas escaneadas (até 40, algumas em
   * paralelo). Leva de segundos a mais de um minuto, por isso é quem consome
   * que escolhe.
   */
  leituraCompleta?: readonly TipoDocumento[]
  /**
   * Motor de OCR. Padrão: "tesseract". Com "paddle" (PaddleOCR, ver
   * ocr-paddle.ts) o OCR é feito por ele e, quando a leitura sai fraca (sem
   * tipo ou com um sinal só), o Tesseract lê de novo e os dois textos vão
   * juntos. Sem as dependências ou os modelos do Paddle instalados, vale o
   * Tesseract, sem erro.
   *
   * Com "auto": lê com o Tesseract e só sobe para o Paddle onde ele compensa
   * (ver `deveSubirParaPaddle`) — o Paddle lê CNH e RG bem melhor, mas leva
   * ~2,6x mais tempo; nos outros tipos o tipo já saía certo e o ganho era ~0.
   * Medido em 120 documentos reais: 27% menos tempo que o Paddle em tudo, com 97%
   * dos campos lidos (06/10/2026).
   */
  ocr?: "tesseract" | "paddle" | "auto"
  /** Extrai os campos do documento depois de classificar (padrão: true). Local e rápido: só regras sobre o texto. */
  extrairDados?: boolean
}

const TIMEOUT_PADRAO_MS = 60_000
const IMAGENS_SUPORTADAS = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"])
// Mesma escala do limiar de conteúdo (1 sinal batido de 3 possíveis) — comunica que é
// um match mais fraco (nome do arquivo, não confirmado pelo conteúdo), sem inventar
// uma escala paralela.
const CONFIANCA_CLASSIFICACAO_POR_NOME = 1 / 3

function semClassificacao(metodo: MetodoLeitura): ResultadoLeitura {
  return { texto: "", metodo, tipo: "outro", confianca: 0, sinais: [] }
}

/** A partir daqui o conteúdo é firme: é o limiar em que quem consome pode renomear e mover sozinho (2/3). */
const SINAIS_CONTEUDO_FIRME = 2

/**
 * O nome manda, o motor confere (decisão do Walter, 12/10/2026). Quem anexa
 * quase sempre nomeia certo: em 1.676 arquivos reais o nome dizia o tipo em
 * 71% e estava errado em 0,5%, e nos 16 em que o conteúdo firme discordava
 * o nome tinha razão em 11. Trocar o que a pessoa escreveu atrapalha mais
 * do que ajuda.
 * - o nome não diz o tipo: vale o conteúdo;
 * - nome e conteúdo concordam: vale, com `tipoPeloNome`;
 * - discordam: vale o nome. O conteúdo firme (2+ sinais) vai em
 *   `tipoPeloConteudo`, para avisar e oferecer a troca. Conteúdo fraco não
 *   avisa: nas 6 vezes em que discordou do nome, estava errado.
 * Conteúdo vazio, ou um sinal só do passo "cartão" (cartao.ts): o tipo veio
 * só do nome, e o método diz isso.
 */
export function comFallbackDeNomeArquivo(
  resultado: ResultadoLeitura,
  nomeArquivo: string | undefined,
  viaCartao = false,
): ResultadoLeitura {
  if (!nomeArquivo) return resultado
  const firme = resultado.sinais.length >= SINAIS_CONTEUDO_FIRME
  const peloNome = classificarNomeArquivoLocal(nomeArquivo, firme ? resultado.tipo : undefined)
  if (!peloNome) return resultado
  if (peloNome.tipo === resultado.tipo) return { ...resultado, tipoPeloNome: peloNome.tipo }

  return {
    ...resultado,
    metodo: resultado.tipo === "outro" || (viaCartao && !firme) ? "nome_arquivo" : resultado.metodo,
    tipo: peloNome.tipo,
    confianca: CONFIANCA_CLASSIFICACAO_POR_NOME,
    sinais: peloNome.sinais,
    tipoPeloNome: peloNome.tipo,
    ...(firme ? { tipoPeloConteudo: resultado.tipo } : {}),
  }
}

/**
 * Leitura do Paddle que dispensa o Tesseract: 3 sinais (confiança máxima). Com
 * 2, uma matrícula real saía IPTU ("valor venal", "prefeitura municipal" na
 * página 1) e o motor parava de ler as páginas antes de achar a matrícula.
 */
const SINAIS_PADDLE_FIRME = 3

/**
 * Tipos que levam o Tesseract junto mesmo com o Paddle firme: numa certidão de
 * nascimento datilografada real, o Paddle classificou (avós, declarante) mas
 * pulou a linha do registrado — sem o nome, o documento perdia o dono (02/10/2026).
 * CNH: na CNH digital a marca d'água passa por cima do nº de registro e o
 * Paddle erra dígitos; o Tesseract às vezes acerta, e quem consome fica com o
 * que fecha o dígito verificador (05/10/2026).
 */
const SEMPRE_COM_TESSERACT = new Set<TipoDocumento>(["certidao_estado_civil", "cnh"])

/**
 * Com `ocr: "paddle"`: lê com o Paddle e, se a leitura não sai firme (ver
 * `SINAIS_PADDLE_FIRME`), também com o Tesseract, e junta os dois textos — a
 * regra que mediu melhor nos documentos reais (o Paddle lê pior certidão
 * antiga fotografada; o Tesseract, pior CNH e RG deitado).
 */
/** Tipos em que o Paddle lê muito melhor (nº do documento, CPF, datas): sobem sempre. */
const TIPOS_QUE_SOBEM_PARA_PADDLE = new Set<TipoDocumento>(["rg", "cnh"])
const CONFIANCA_QUE_SOBE_PARA_PADDLE = 0.5

/**
 * No modo "auto", o resultado do Tesseract basta? Sobe para o Paddle quando é RG
 * ou CNH, ou quando o Tesseract não está firme (confiança abaixo de 50%, sem
 * tipo incluso). PDF com texto não sobe: não passou por OCR.
 *
 * PDF que já passou pela leitura completa (tipo do conteúdo em
 * `leituraCompleta`, a matrícula) também não sobe: o Paddle classificaria de
 * novo, repetiria a leitura completa de até 40 páginas e uma das duas iria
 * fora (review, 09/10/2026).
 */
export function deveSubirParaPaddle(resultado: ResultadoLeitura, leituraCompleta?: readonly TipoDocumento[]): boolean {
  if (resultado.metodo === "texto_pdf") return false
  if (resultado.metodo.endsWith("_pdf") && leituraCompleta?.includes(resultado.tipoPeloConteudo ?? resultado.tipo)) return false
  return TIPOS_QUE_SOBEM_PARA_PADDLE.has(resultado.tipo) || resultado.confianca < CONFIANCA_QUE_SOBE_PARA_PADDLE
}

async function processar(bytes: Buffer, mediaType: string, opcoes: OpcoesLeitura): Promise<ResultadoLeitura> {
  const lidoPor = (resultado: ResultadoLeitura, ocr: ResultadoLeitura["ocr"]): ResultadoLeitura =>
    resultado.metodo.startsWith("ocr_") ? { ...resultado, ocr } : resultado
  const comTesseract = async () => lidoPor(await lerUmaVez(bytes, mediaType, { ...opcoes, ocr: "tesseract" }), "tesseract")
  if (opcoes.ocr === undefined || opcoes.ocr === "tesseract" || !(await paddleDisponivel())) return comTesseract()

  // "auto": o Tesseract primeiro; o Paddle só onde compensa — e a leitura do Tesseract é reaproveitada.
  let viaTesseractPronto: ResultadoLeitura | undefined
  if (opcoes.ocr === "auto") {
    viaTesseractPronto = await comTesseract()
    if (!deveSubirParaPaddle(viaTesseractPronto, opcoes.leituraCompleta)) return viaTesseractPronto
  }

  const viaPaddle = await lerUmaVez(bytes, mediaType, { ...opcoes, ocr: "paddle" })
  const firme = viaPaddle.sinais.length >= SINAIS_PADDLE_FIRME && !SEMPRE_COM_TESSERACT.has(viaPaddle.tipo)
  if (viaPaddle.metodo === "texto_pdf" || firme) return lidoPor(viaPaddle, "paddle")

  const viaTesseract = viaTesseractPronto ?? (await comTesseract())
  // Matrícula (leitura completa) fica inteira com o Tesseract: o tipo dela foi
  // decidido antes da leitura completa, e reclassificar o texto juntado traz
  // de volta a matrícula que virava certidão (ver pdf.ts).
  if (opcoes.leituraCompleta?.includes(viaTesseract.tipo)) return viaTesseract
  const texto = [viaPaddle.texto, viaTesseract.texto].filter(Boolean).join("\n")
  if (!texto) return viaTesseract
  const metodo = [viaPaddle.metodo, viaTesseract.metodo].find((m) => m.startsWith("ocr_")) ?? viaTesseract.metodo
  return lidoPor(
    comFallbackDeNomeArquivo({ texto, metodo, ...classificarTextoLocal(texto) }, opcoes.nomeArquivo),
    viaPaddle.texto && viaTesseract.texto ? "paddle+tesseract" : viaPaddle.texto ? "paddle" : "tesseract",
  )
}

async function lerUmaVez(bytes: Buffer, mediaType: string, opcoes: OpcoesLeitura): Promise<ResultadoLeitura> {
  const { nomeArquivo } = opcoes
  if (mediaType === "application/pdf") {
    const resultado = await lerConteudoPdf(bytes, { leituraCompleta: opcoes.leituraCompleta, ocr: opcoes.ocr === "paddle" ? "paddle" : "tesseract" })
    if (resultado.metodo === "sem_texto") {
      return comFallbackDeNomeArquivo(semClassificacao("sem_texto"), nomeArquivo)
    }
    // Com leitura completa, o tipo já veio decidido de antes dela (ver pdf.ts).
    const classificacao = resultado.classificacao ?? classificarTextoLocal(resultado.texto)
    return comFallbackDeNomeArquivo(
      { texto: resultado.texto, metodo: resultado.metodo, ...classificacao },
      nomeArquivo,
      resultado.viaCartao,
    )
  }

  // Imagem que declara mais pixels do que o teto não é decodificada (viraria
  // GBs fora do heap): fica como formato não suportado, e o nome do arquivo
  // ainda pode dizer o tipo.
  if (IMAGENS_SUPORTADAS.has(mediaType) && imagemGrandeDemais(bytes)) {
    return comFallbackDeNomeArquivo(semClassificacao("nao_suportado"), nomeArquivo)
  }

  if (IMAGENS_SUPORTADAS.has(mediaType) && opcoes.ocr === "paddle") {
    // O Paddle resolve foto de lado e documento pequeno sem o passo cartão.
    const { texto } = await new LeitorPaddle().reconhecer(bytes)
    return comFallbackDeNomeArquivo({ texto, metodo: "ocr_imagem", ...classificarTextoLocal(texto) }, nomeArquivo)
  }

  if (IMAGENS_SUPORTADAS.has(mediaType)) {
    let { texto } = await ocrImagem(bytes)
    let viaCartao = false
    // Foto do documento de lado ou pequena na imagem (ver cartao.ts).
    if (classificarTextoLocal(texto).tipo === "outro") {
      const canvasNativo = await carregarCanvas()
      if (canvasNativo) {
        texto = [texto, await lerComoCartao(bytes, canvasNativo)].filter(Boolean).join("\n")
        viaCartao = true
      }
    }
    const classificacao = classificarTextoLocal(texto)
    return comFallbackDeNomeArquivo(
      { texto, metodo: "ocr_imagem", ...classificacao },
      nomeArquivo,
      viaCartao,
    )
  }

  // Formato que o motor não lê (HEIC, Word): o nome do arquivo ainda diz o tipo, como num PDF sem texto.
  return comFallbackDeNomeArquivo(semClassificacao("nao_suportado"), nomeArquivo)
}

/**
 * Le e classifica um documento localmente (sem IA). Nunca lanca excecao — em caso de
 * erro ou timeout, devolve `metodo: "erro"`. O timeout e "soft": ele devolve o controle
 * pra quem chamou, mas nao cancela um OCR ja em andamento por baixo dos panos.
 */
export async function lerDocumentoLocal(
  bytes: Buffer,
  mediaType: string,
  opcoes: OpcoesLeitura = {},
): Promise<ResultadoLeitura> {
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS
  let timeoutId: NodeJS.Timeout | undefined

  const timeout = new Promise<ResultadoLeitura>((resolve) => {
    timeoutId = setTimeout(() => resolve(semClassificacao("erro")), timeoutMs)
    timeoutId.unref()
  })

  try {
    const resultado = await Promise.race([processar(bytes, mediaType, opcoes), timeout])
    if (opcoes.extrairDados === false || !resultado.texto) return resultado
    return { ...resultado, dados: extrairDados(resultado.tipo, resultado.texto) }
  } catch (erro) {
    if ((erro as { name?: string } | undefined)?.name === "PasswordException") return semClassificacao("protegido_por_senha")
    console.error("Erro ao ler documento localmente:", erro)
    return semClassificacao("erro")
  } finally {
    clearTimeout(timeoutId)
  }
}
