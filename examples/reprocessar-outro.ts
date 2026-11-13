// Analise pontual (nao faz parte da lib): reprocessa os documentos de um tipo
// do relatorio de lote e imprime so a contagem por tipo novo.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { lerDocumentoLocal } from "../src/index.js"

const MEDIA_TYPE: Record<string, string> = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
}

async function main() {
  const [relatorio, raiz, tipoFiltro = "outro"] = process.argv.slice(2)
  const alvos = (await readFile(relatorio, "utf8"))
    .split(/\r?\n/)
    .map((l) => l.split(" | "))
    .filter((c) => c.length > 3 && c[2] === tipoFiltro)
    .map((c) => c[0])

  const contagem = new Map<string, number>()
  for (const nome of alvos) {
    const mediaType = MEDIA_TYPE[path.extname(nome).toLowerCase()]
    if (!mediaType) continue
    const bytes = await readFile(path.join(raiz, nome)).catch(() => null)
    if (!bytes) continue
    const { tipo, sinais } = await lerDocumentoLocal(bytes, mediaType, { nomeArquivo: path.basename(nome) })
    contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1)
    if (tipo !== tipoFiltro) console.log(`mudou: ${tipoFiltro} -> ${tipo} | sinais: ${sinais.join(", ")}`)
  }
  console.log(`reprocessados: ${[...contagem.values()].reduce((a, b) => a + b, 0)} (antes: ${tipoFiltro})`)
  for (const [tipo, n] of [...contagem].sort((a, b) => b[1] - a[1])) console.log(`${n}\t${tipo}`)
}

main().catch((erro) => { console.error("Falha:", erro); process.exit(1) })
