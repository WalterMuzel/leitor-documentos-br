// Baixa os modelos do PaddleOCR (PP-OCRv5 detecção + reconhecimento latino,
// ~12,8 MB) para modelos/, que fica fora do git. Só é preciso para
// `opcoes.ocr: "paddle"` (ver src/ocr-paddle.ts).
import { mkdir, stat, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

const BASE = "https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main"
const ARQUIVOS = {
  "PP-OCRv5_mobile_det_infer.onnx": `${BASE}/detection/PP-OCRv5_mobile_det_infer.onnx`,
  "latin_PP-OCRv5_mobile_rec_infer.onnx": `${BASE}/recognition/multi/latin/v5/latin_PP-OCRv5_mobile_rec_infer.onnx`,
  "ppocrv5_latin_dict.txt": `${BASE}/recognition/multi/latin/v5/ppocrv5_latin_dict.txt`,
}

const destino = fileURLToPath(new URL("../modelos/", import.meta.url))
await mkdir(destino, { recursive: true })
for (const [nome, url] of Object.entries(ARQUIVOS)) {
  const caminho = destino + nome
  if (await stat(caminho).then((s) => s.size > 0, () => false)) {
    console.log(`já existe: ${nome}`)
    continue
  }
  const resposta = await fetch(url)
  if (!resposta.ok) throw new Error(`${nome}: HTTP ${resposta.status}`)
  const bytes = Buffer.from(await resposta.arrayBuffer())
  await writeFile(caminho, bytes)
  console.log(`baixado: ${nome} (${(bytes.length / 1e6).toFixed(1)} MB)`)
}
