export interface ImagemPdf {
  largura: number
  altura: number
  canais: 3 | 4
  pixels: Uint8ClampedArray
}

const AREA_MINIMA_PIXELS = 50_000 // ignora icones/QR codes pequenos, mantem fotos/paginas escaneadas

// Marca d'agua de selo digital (ex: certidao de matricula do TJSP) costuma vir como
// tira estreita e comprida de texto rotacionado 90° ("Documento gerado oficialmente
// via www.ri...") ou de logo, repetida em toda pagina do documento — grande o
// suficiente pra passar no AREA_MINIMA_PIXELS, mas nunca perto da proporcao de uma
// foto ou de uma pagina escaneada de verdade. Confirmado visualmente numa matricula
// real: tiras como 272x1285 (razao ~4,7) e 60x1480 (razao ~24,7) eram só isso —
// nenhum conteudo do documento em si, só ruido pro OCR.
const RAZAO_MAXIMA_LADO_A_LADO = 3

// Imagem do tamanho de uma página escaneada: scanner a 200 dpi numa A4 já dá
// ~1700x2400. As peças de uma matrícula escaneada em faixas (1800x1149) também
// passam; ícone, QR code e tira de marca d'água, não.
const AREA_MINIMA_IMAGEM_DE_PAGINA = 1_000_000

/**
 * A página traz um escaneamento? O texto próprio da página não responde isso:
 * certidão digital de cartório carimba "valide este documento…" em toda folha,
 * então a página tem 150+ caracteres de texto e o conteúdo de verdade — a
 * matrícula escaneada — é uma imagem. Olha só as dimensões de cada imagem
 * desenhada, sem copiar pixels.
 */
export async function paginaTemImagemGrande(pagina: any, pdfjsLib: any): Promise<boolean> {
  const opList = await pagina.getOperatorList()

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i]
    const args = opList.argsArray[i]
    // paintImageXObject: [objId, largura, altura]. paintImageMaskXObject (scan
    // preto e branco desenhado como máscara): [{ width, height, ... }].
    const [largura, altura] =
      fn === pdfjsLib.OPS.paintImageXObject
        ? [args[1], args[2]]
        : fn === pdfjsLib.OPS.paintImageMaskXObject
          ? [args[0]?.width, args[0]?.height]
          : [0, 0]
    if (!largura || !altura) continue

    const razaoLadoALado = Math.max(largura, altura) / Math.min(largura, altura)
    if (largura * altura >= AREA_MINIMA_IMAGEM_DE_PAGINA && razaoLadoALado <= RAZAO_MAXIMA_LADO_A_LADO) return true
  }

  return false
}

/**
 * Extrai as imagens grandes (RGB/RGBA) desenhadas numa pagina de PDF, sem renderizar
 * a pagina inteira (evita depender de um canvas nativo).
 */
export async function extrairImagensGrandes(pagina: any, pdfjsLib: any): Promise<ImagemPdf[]> {
  const opList = await pagina.getOperatorList()
  const imagens: ImagemPdf[] = []

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== pdfjsLib.OPS.paintImageXObject) continue

    const objId = opList.argsArray[i][0]
    try {
      const objeto = pagina.objs.get(objId)
      const ehRgbOuRgba = objeto.kind === 2 || objeto.kind === 3
      const area = objeto.width * objeto.height
      const razaoLadoALado = Math.max(objeto.width, objeto.height) / Math.min(objeto.width, objeto.height)

      if (ehRgbOuRgba && area >= AREA_MINIMA_PIXELS && razaoLadoALado <= RAZAO_MAXIMA_LADO_A_LADO) {
        imagens.push({
          largura: objeto.width,
          altura: objeto.height,
          canais: objeto.kind === 3 ? 4 : 3,
          pixels: objeto.data,
        })
      }
    } catch {
      // objeto ainda nao resolvido nesta pagina - ignora
    }
  }

  return imagens
}
