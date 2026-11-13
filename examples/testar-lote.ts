import { appendFile, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { lerDocumentoLocal } from "../src/index.js"

const EXTENSAO_PARA_MEDIA_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

async function main() {
  const args = process.argv.slice(2)
  // --paddle: o motor novo (PaddleOCR com o Tesseract de reserva), como o sistema de produção usa.
  const ocr = args.includes("--paddle") ? "paddle" : "tesseract"
  const [pasta = "fixtures", saida] = args.filter((a) => !a.startsWith("--"))
  const arquivos = (await readdir(pasta, { recursive: true })).filter((nome) => {
    const extensao = path.extname(nome).toLowerCase()
    return extensao in EXTENSAO_PARA_MEDIA_TYPE
  })

  if (arquivos.length === 0) {
    console.error(`Nenhum arquivo suportado encontrado em ${pasta}`)
    process.exit(1)
  }

  // Com um arquivo de saída (3º argumento), grava nele e pula o que já está lá — permite retomar.

  const jaFeitos = new Set(
    saida
      ? (await readFile(saida, "utf8").catch(() => "")).split(/\r?\n/).map((linha) => linha.split(" | ")[0])
      : [],
  )
  const escrever = async (linha: string) => {
    console.log(linha)
    if (saida) await appendFile(saida, linha + "\n")
  }

  if (!jaFeitos.has("Arquivo")) {
    await escrever(["Arquivo", "Metodo", "OCR", "Tipo", "Confianca", "Sinais", "Segundos"].join(" | "))
  }

  for (const nome of arquivos.sort()) {
    if (jaFeitos.has(nome)) continue
    const caminho = path.join(pasta, nome)
    const extensao = path.extname(nome).toLowerCase()
    const mediaType = EXTENSAO_PARA_MEDIA_TYPE[extensao]
    const inicio = Date.now()
    try {
      const bytes = await readFile(caminho)
      const resultado = await lerDocumentoLocal(bytes, mediaType, { nomeArquivo: path.basename(nome), ocr, timeoutMs: 600_000 })
      await escrever(
        [
          nome,
          resultado.metodo,
          (resultado as { ocr?: string }).ocr ?? "-",
          resultado.tipo,
          `${Math.round(resultado.confianca * 100)}%`,
          String(resultado.sinais.length),
          ((Date.now() - inicio) / 1000).toFixed(1),
        ].join(" | "),
      )
    } catch (erro) {
      await escrever([nome, "ERRO", "", String(erro), "", "", ""].join(" | "))
    }
  }
}

main().catch((erro) => {
  console.error("Falha ao rodar teste em lote:", erro)
  process.exit(1)
})
