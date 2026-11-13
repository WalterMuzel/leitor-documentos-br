/**
 * Teto de pixels (largura × altura) para o motor decodificar uma imagem — a
 * enviada como arquivo ou uma embutida num PDF. Decodificada, cada pixel ocupa
 * 4 bytes fora do heap do JavaScript: um PNG de poucos KB que declara
 * 30000×30000 viraria GBs de memória e derrubaria o processo. 64 MP ainda
 * cobre foto de celular de 50 MP.
 */
export const MAX_PIXELS_IMAGEM = 64_000_000

/**
 * Largura e altura lidas do cabeçalho de um PNG, JPEG ou WebP, sem decodificar
 * a imagem. `undefined` quando o cabeçalho não diz (formato desconhecido ou
 * arquivo truncado) — aí quem decide é o decodificador.
 */
export function dimensoesDaImagem(bytes: Buffer): { largura: number; altura: number } | undefined {
  try {
    // PNG: assinatura de 8 bytes e o IHDR logo depois (largura e altura em 32 bits).
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString("ascii", 12, 16) === "IHDR") {
      return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) }
    }
    // JPEG: anda pelos marcadores até o SOFn (C0–CF, menos C4, C8 e CC, que não são frame).
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let pos = 2
      while (pos + 9 < bytes.length) {
        if (bytes[pos] !== 0xff) return undefined
        const marcador = bytes[pos + 1]!
        if (marcador === 0xff) {
          pos++
          continue
        }
        if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
          return { altura: bytes.readUInt16BE(pos + 5), largura: bytes.readUInt16BE(pos + 7) }
        }
        pos += 2 + bytes.readUInt16BE(pos + 2)
      }
      return undefined
    }
    // WebP: RIFF....WEBP e o primeiro bloco diz o formato.
    if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
      const bloco = bytes.toString("ascii", 12, 16)
      if (bloco === "VP8X") return { largura: 1 + bytes.readUIntLE(24, 3), altura: 1 + bytes.readUIntLE(27, 3) }
      if (bloco === "VP8 ") return { largura: bytes.readUInt16LE(26) & 0x3fff, altura: bytes.readUInt16LE(28) & 0x3fff }
      if (bloco === "VP8L") {
        const b = bytes.readUInt32LE(21)
        return { largura: 1 + (b & 0x3fff), altura: 1 + ((b >> 14) & 0x3fff) }
      }
    }
  } catch {
    // Cabeçalho truncado: o decodificador vai reclamar sozinho.
  }
  return undefined
}

/** A imagem declara mais pixels do que o motor aceita decodificar? */
export function imagemGrandeDemais(bytes: Buffer): boolean {
  const dimensoes = dimensoesDaImagem(bytes)
  return dimensoes !== undefined && dimensoes.largura * dimensoes.altura > MAX_PIXELS_IMAGEM
}
