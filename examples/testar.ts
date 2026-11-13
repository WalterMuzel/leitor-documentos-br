import { readFile } from "node:fs/promises"
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
  const caminho = args.find((a) => !a.startsWith("--"))
  if (!caminho) {
    console.error("Uso: npm run testar -- [--paddle] caminho/do/arquivo.pdf")
    process.exit(1)
  }

  const extensao = path.extname(caminho).toLowerCase()
  const mediaType = EXTENSAO_PARA_MEDIA_TYPE[extensao]
  if (!mediaType) {
    console.error(`Extensao nao suportada: ${extensao}`)
    process.exit(1)
  }

  console.log(`Lendo ${caminho} (${mediaType}, OCR: ${ocr})...`)
  const bytes = await readFile(caminho)
  const inicio = Date.now()
  const resultado = await lerDocumentoLocal(bytes, mediaType, { nomeArquivo: path.basename(caminho), ocr, timeoutMs: 600_000 })

  console.log("\n--- Resultado ---")
  console.log("Metodo:", resultado.metodo)
  console.log("OCR usado:", (resultado as { ocr?: string }).ocr ?? "nenhum (texto direto do PDF)")
  console.log("Tipo detectado:", resultado.tipo)
  if (resultado.tipoPeloConteudo) console.log(`ALERTA: o nome do arquivo diz ${resultado.tipo}, o conteudo parece ${resultado.tipoPeloConteudo}`)
  console.log("Confianca:", `${Math.round(resultado.confianca * 100)}%`)
  console.log("Sinais:", resultado.sinais)
  console.log("Tempo:", `${((Date.now() - inicio) / 1000).toFixed(1)} s`)
  if (resultado.dados?.campos.length) {
    console.log("\n--- Dados ---")
    for (const campo of resultado.dados.campos) {
      console.log(`${campo.rotulo}: ${campo.valor}${campo.conferido ? "  ✓" : ""}${campo.alerta ? "  ⚠" : ""}`)
    }
  }
  console.log(`\n--- Texto extraido (primeiros 2000 de ${resultado.texto.length} caracteres) ---\n`)
  console.log(resultado.texto.slice(0, 2000))
}

main().catch((erro) => {
  console.error("Falha ao rodar teste:", erro)
  process.exit(1)
})
