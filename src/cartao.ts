import { PSM } from "tesseract.js"

import { classificarTextoLocal } from "./classificacao.js"
import { criarWorker } from "./ocr-imagem.js"
import type { CanvasNativo } from "./pdf.js"

// Borda ignorada ao procurar o documento na folha: scanner deixa linha escura
// e sombra na margem, e elas esticariam o recorte até a folha inteira.
const MARGEM_IGNORADA = 0.04
// Linha/coluna faz parte do documento quando mais de 10% dela é escura — o
// grão do papel não chega nisso, o cartão chega.
const FRACAO_ESCURA_MINIMA = 0.1
const LIMIAR_ESCURO = 200
// Nos exemplos reais, as leituras que prestavam tinham 43-68 de confiança do
// Tesseract; as de lixo, 23-38.
const CONFIANCA_MINIMA_TENTATIVA = 40

// Na ordem de quem mais acertou nos exemplos reais: CNH de pé (bloco único
// lê melhor o fundo com textura), depois RG deitado. Para no primeiro que
// classifica.
const TENTATIVAS: { giro: number; modo: PSM }[] = [
  { giro: 0, modo: PSM.SPARSE_TEXT },
  { giro: 0, modo: PSM.SINGLE_BLOCK },
  { giro: 90, modo: PSM.SPARSE_TEXT },
  { giro: 270, modo: PSM.SPARSE_TEXT },
]

/**
 * Último recurso para documento de bolso (CNH, RG) escaneado pequeno no meio
 * de uma folha A4, ou de lado. O OCR da folha inteira volta VAZIO nesses
 * casos (conferido em 28/09/2026 com CNH e RG reais: zero caractere, e o
 * documento só era reconhecido pelo nome do arquivo). Recortar o documento e
 * trocar o modo de segmentação resolve; o RG deitado só sai girando.
 *
 * Devolve o texto de todas as tentativas feitas, juntas — lixo de uma
 * tentativa não forma as frases que a classificação procura.
 */
export async function lerComoCartao(imagem: Buffer, canvasNativo: CanvasNativo): Promise<string> {
  const origem = await canvasNativo.loadImage(imagem)
  const folha = canvasNativo.createCanvas(origem.width, origem.height)
  const contextoFolha = folha.getContext("2d")
  contextoFolha.fillStyle = "#ffffff"
  contextoFolha.fillRect(0, 0, folha.width, folha.height)
  contextoFolha.drawImage(origem, 0, 0)
  const { x, y, largura, altura } = recorteDoConteudo(contextoFolha.getImageData(0, 0, folha.width, folha.height))

  const worker = await criarWorker()
  const textos: string[] = []
  try {
    for (const { giro, modo } of TENTATIVAS) {
      const deitado = giro % 180 !== 0
      const saida = canvasNativo.createCanvas(deitado ? altura : largura, deitado ? largura : altura)
      const contexto = saida.getContext("2d")
      contexto.fillStyle = "#ffffff"
      contexto.fillRect(0, 0, saida.width, saida.height)
      contexto.translate(saida.width / 2, saida.height / 2)
      contexto.rotate((giro * Math.PI) / 180)
      contexto.drawImage(folha, x, y, largura, altura, -largura / 2, -altura / 2, largura, altura)

      await worker.setParameters({ tessedit_pageseg_mode: modo })
      const { data } = await worker.recognize(Buffer.from(await saida.encode("png")))
      // Tentativa de lado errado sai como lixo de baixa confiança, e lixo
      // junta sinal curto por acaso ("dps" no meio de um RG, no lote real).
      if (data.confidence >= CONFIANCA_MINIMA_TENTATIVA) textos.push(data.text)
      if (classificarTextoLocal(textos.join("\n")).tipo !== "outro") break
    }
  } finally {
    await worker.terminate()
  }
  return textos.join("\n").trim()
}

/** A caixa do que não é papel em branco, pela projeção de pixels escuros em linhas e colunas. */
function recorteDoConteudo({ data, width, height }: { data: Uint8ClampedArray; width: number; height: number }) {
  const mx = Math.round(width * MARGEM_IGNORADA)
  const my = Math.round(height * MARGEM_IGNORADA)
  const porLinha = new Array<number>(height).fill(0)
  const porColuna = new Array<number>(width).fill(0)
  for (let py = my; py < height - my; py++) {
    for (let px = mx; px < width - mx; px++) {
      const i = (py * width + px) * 4
      if ((data[i]! + data[i + 1]! + data[i + 2]!) / 3 < LIMIAR_ESCURO) {
        porLinha[py]!++
        porColuna[px]!++
      }
    }
  }
  const faixa = (contagem: number[], minimo: number): [number, number] => {
    let fim = contagem.length - 1
    while (fim >= 0 && contagem[fim]! <= minimo) fim--
    return [contagem.findIndex((v) => v > minimo), fim]
  }
  const [y0, y1] = faixa(porLinha, (width - 2 * mx) * FRACAO_ESCURA_MINIMA)
  const [x0, x1] = faixa(porColuna, (height - 2 * my) * FRACAO_ESCURA_MINIMA)
  // Nada destacado do fundo (folha toda escrita, ou foto do documento
  // ocupando tudo): lê a imagem inteira.
  if (y0 < 0 || x0 < 0 || x1 - x0 < 50 || y1 - y0 < 50) return { x: 0, y: 0, largura: width, altura: height }
  return { x: x0, y: y0, largura: x1 - x0 + 1, altura: y1 - y0 + 1 }
}
