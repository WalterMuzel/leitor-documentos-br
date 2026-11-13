import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { ResultadoOcrImagem } from "./ocr-imagem.js"

/**
 * OCR com PaddleOCR (PP-OCRv5, modelo latino) rodando em ONNX — opcional, atrás
 * de `opcoes.ocr: "paddle"`. Medido contra o Tesseract em documentos reais
 * (spike de 30/09-01/10/2026): lê bem melhor CNH e RG fotografado ou deitado e
 * acha CEP em comprovante escaneado; lê pior certidão antiga fotografada — por
 * isso quem chama mantém o Tesseract de reserva (ver index.ts).
 *
 * Dependências e modelos são opcionais: sem `ppu-paddle-ocr`/`onnxruntime-node`
 * instalados, ou sem os modelos em `modelos/` (`npm run baixar-modelos-paddle`),
 * `paddleDisponivel()` diz que não e o motor segue só com o Tesseract.
 *
 * Três coisas aqui são do jeito do Paddle, não do pacote:
 * - reconhecer caixa por caixa (`per-box`): o padrão junta as caixas de uma
 *   linha num recorte só e cola rótulo com valor ("NOMEFULANO");
 * - orientação pela confiança do próprio reconhecimento: de lado ou de cabeça
 *   para baixo ele "lê" lixo com confiança 0,06-0,32; de pé, 0,53-0,91. A forma
 *   das caixas não denuncia o giro;
 * - linhas montadas pelo CENTRO vertical das caixas e colunas separadas pelo
 *   vão: pelo topo (o agrupamento do pacote), o rótulo pequeno caía na linha
 *   errada e a extração (extracao.ts) — calibrada no Tesseract — lia a filiação trocada.
 */

const DIRETORIO_MODELOS = fileURLToPath(new URL("../modelos/", import.meta.url))
export const MODELOS_PADDLE = {
  detection: `${DIRETORIO_MODELOS}PP-OCRv5_mobile_det_infer.onnx`,
  recognition: `${DIRETORIO_MODELOS}latin_PP-OCRv5_mobile_rec_infer.onnx`,
  charactersDictionary: `${DIRETORIO_MODELOS}ppocrv5_latin_dict.txt`,
}

// Ajustados em documentos reais (spike de 30/09-01/10/2026) — mudar sem medir de novo pode piorar.
// ponytail: limiares medidos em poucas dezenas de documentos; recalibrar com mais exemplos.
/** Abaixo disso a imagem está de lado ou de cabeça para baixo: tenta os outros giros. */
const CONFIANCA_DE_PE = 0.5
/** Caixa reconhecida com menos que isso é ruído (o padrão do pacote). */
const CONFIANCA_MINIMA_CAIXA = 0.5
/** Vão entre caixas, em alturas de linha, a partir do qual são colunas diferentes. */
const VAO_ENTRE_COLUNAS = 1.5
/** Sem reduzir a imagem até aqui: o modo "auto" do pacote encolhia CNH e perdia letra miúda. */
const LADO_MAXIMO_DETECCAO = 2560

type Caixa = { text: string; confidence: number; box: { x: number; y: number; width: number; height: number } }
type Servico = { recognize(imagem: ArrayBuffer, opcoes: object): Promise<{ lines: Caixa[][]; confidence: number }> }

// Um serviço por thread, criado no primeiro uso e mantido: carregar os modelos
// custa ~0,4 s e centenas de MB, a cada documento seria desperdício.
let servico: Promise<Servico | undefined> | undefined
// Uma imagem por vez: o onnxruntime já usa todos os núcleos numa só, e duas
// juntas dobrariam o pico de memória.
let fila: Promise<unknown> = Promise.resolve()

async function carregar(): Promise<Servico | undefined> {
  if (!Object.values(MODELOS_PADDLE).every((arquivo) => existsSync(arquivo))) return undefined
  try {
    const { PaddleOcrService } = await import("ppu-paddle-ocr")
    const s = new PaddleOcrService({
      model: MODELOS_PADDLE,
      recognition: { strategy: "per-box" },
      detection: { maxSideLength: LADO_MAXIMO_DETECCAO },
      // Sem a reserva de memória do onnxruntime: pico de ~1,9 GB em vez de 2,5-3,7 GB
      // em documentos reais, texto idêntico e tempo dentro do ruído (medido 02/10/2026).
      session: { enableCpuMemArena: false },
    } as ConstructorParameters<typeof PaddleOcrService>[0])
    await s.initialize()
    return s as unknown as Servico
  } catch (erro) {
    console.error("PaddleOCR indisponível, seguindo com o Tesseract:", erro)
    return undefined
  }
}

export async function paddleDisponivel(): Promise<boolean> {
  return Boolean(await (servico ??= carregar()))
}

async function girar(png: Buffer, graus: number): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas")
  const img = await loadImage(png)
  const deitado = graus % 180 !== 0
  const canvas = createCanvas(deitado ? img.height : img.width, deitado ? img.width : img.height)
  const contexto = canvas.getContext("2d")
  contexto.translate(canvas.width / 2, canvas.height / 2)
  contexto.rotate((graus * Math.PI) / 180)
  contexto.drawImage(img, -img.width / 2, -img.height / 2)
  return Buffer.from(await canvas.encode("png"))
}

/** Linhas pelo centro vertical; dentro da linha, da esquerda para a direita, quebrando nas colunas. */
export function montarTexto(caixas: Caixa[]): string {
  const centro = (c: Caixa) => c.box.y + c.box.height / 2
  const linhas: Caixa[][] = []
  for (const c of [...caixas].sort((a, b) => centro(a) - centro(b))) {
    const ancora = linhas.at(-1)?.[0]
    if (ancora && Math.abs(centro(c) - centro(ancora)) <= Math.min(c.box.height, ancora.box.height) / 2) linhas.at(-1)!.push(c)
    else linhas.push([c])
  }
  const saida: string[] = []
  for (const linha of linhas) {
    const boas = linha.filter((c) => c.confidence >= CONFIANCA_MINIMA_CAIXA).sort((a, b) => a.box.x - b.box.x)
    const altura = boas.reduce((s, c) => s + c.box.height, 0) / (boas.length || 1)
    let pedaco: Caixa[] = []
    for (const c of boas) {
      const ultima = pedaco.at(-1)
      if (ultima && c.box.x - (ultima.box.x + ultima.box.width) > VAO_ENTRE_COLUNAS * altura) {
        saida.push(pedaco.map((p) => p.text).join(" "))
        pedaco = []
      }
      pedaco.push(c)
    }
    if (pedaco.length) saida.push(pedaco.map((p) => p.text).join(" "))
  }
  return saida.filter(Boolean).join("\n")
}

async function lerOrientado(s: Servico, png: Buffer): Promise<ResultadoOcrImagem> {
  const ler = async (imagem: Buffer) => {
    const r = await s.recognize(imagem.buffer.slice(imagem.byteOffset, imagem.byteOffset + imagem.byteLength) as ArrayBuffer, {
      noCache: true,
      minimumConfidence: 0,
    })
    return { texto: montarTexto(r.lines.flat()), confianca: r.confidence }
  }
  let melhor = await ler(png)
  if (melhor.confianca >= CONFIANCA_DE_PE) return melhor
  for (const graus of [90, 270, 180]) {
    const outra = await ler(await girar(png, graus))
    if (outra.confianca > melhor.confianca) melhor = outra
  }
  return melhor
}

/** Mesma forma do `LeitorOcr` (ocr-imagem.ts), para o resto do motor não saber qual dos dois está lendo. */
export class LeitorPaddle {
  async reconhecer(bytes: Buffer): Promise<ResultadoOcrImagem> {
    const s = await (servico ??= carregar())
    if (!s) throw new Error("PaddleOCR indisponível")
    const resultado = fila.then(() => lerOrientado(s, bytes))
    fila = resultado.catch(() => undefined)
    return resultado
  }

  /** Uma imagem por vez (ver `fila`): não há workers a subir. */
  async garantirWorkers(_total: number): Promise<void> {}

  /** O serviço fica carregado para o próximo documento. */
  async encerrar(): Promise<void> {}
}
