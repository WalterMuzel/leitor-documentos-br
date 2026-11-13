import zlib from "node:zlib"

let tabelaCrc32: Uint32Array | undefined

function crc32(buffer: Buffer): number {
  if (!tabelaCrc32) {
    const tabela = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      tabela[n] = c >>> 0
    }
    tabelaCrc32 = tabela
  }

  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc = tabelaCrc32[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(tipo: string, dados: Buffer): Buffer {
  const tamanho = Buffer.alloc(4)
  tamanho.writeUInt32BE(dados.length, 0)
  const tipoBuf = Buffer.from(tipo, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([tipoBuf, dados])), 0)
  return Buffer.concat([tamanho, tipoBuf, dados, crc])
}

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Codifica pixels crus (RGB ou RGBA, 8 bits por canal) num PNG valido, sem dependencias externas. */
export function codificarPng(
  largura: number,
  altura: number,
  canais: 3 | 4,
  pixels: Uint8ClampedArray,
): Buffer {
  const tipoCor = canais === 4 ? 6 : 2
  const ihdrDados = Buffer.alloc(13)
  ihdrDados.writeUInt32BE(largura, 0)
  ihdrDados.writeUInt32BE(altura, 4)
  ihdrDados[8] = 8
  ihdrDados[9] = tipoCor
  const ihdr = chunk("IHDR", ihdrDados)

  const stride = largura * canais
  const bruto = Buffer.alloc((stride + 1) * altura)
  const pixelsBuffer = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  for (let y = 0; y < altura; y++) {
    bruto[y * (stride + 1)] = 0
    pixelsBuffer.copy(bruto, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }

  const idat = chunk("IDAT", zlib.deflateSync(bruto))
  const iend = chunk("IEND", Buffer.alloc(0))
  return Buffer.concat([ASSINATURA_PNG, ihdr, idat, iend])
}
