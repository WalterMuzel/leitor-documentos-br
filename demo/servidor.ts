/**
 * Demo local do leitor: uma página para arrastar um documento e ver o que o
 * motor lê. Sem dependências novas — só node:http.
 *
 *   npm run demo            → http://localhost:3000
 *   PORT=8080 npm run demo
 *
 * O documento não sai da máquina. Saem só, se a opção estiver ligada na
 * página, o CEP (endereço na BrasilAPI) e a lista de municípios do IBGE
 * (baixada uma vez) — e o idioma do Tesseract, na primeira execução.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { completarComConsultas, lerDocumentoLocal } from "../src/index.js"
import { nomeDoTipo } from "./nomes-tipos.js"

const PORTA = Number(process.env.PORT ?? 3000)
const TAMANHO_MAXIMO = 25 * 1024 * 1024
const PASTA = path.dirname(fileURLToPath(import.meta.url))

const MEDIA_TYPE_POR_EXTENSAO: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = []
    let total = 0
    req.on("data", (parte: Buffer) => {
      total += parte.length
      if (total > TAMANHO_MAXIMO) {
        reject(new Error("Arquivo maior que 25 MB"))
        req.destroy()
        return
      }
      partes.push(parte)
    })
    req.on("end", () => resolve(Buffer.concat(partes)))
    req.on("error", reject)
  })
}

function json(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(corpo))
}

async function lerDocumento(req: IncomingMessage, res: ServerResponse, url: URL) {
  const nomeArquivo = decodeURIComponent(String(req.headers["x-nome-arquivo"] ?? "documento"))
  const extensao = path.extname(nomeArquivo).toLowerCase()
  const mediaType = MEDIA_TYPE_POR_EXTENSAO[extensao] ?? String(req.headers["content-type"] ?? "")
  const ocrPedido = url.searchParams.get("ocr")
  const ocr = ocrPedido === "paddle" || ocrPedido === "auto" ? ocrPedido : "tesseract"
  const consultar = url.searchParams.get("consultas") === "1"

  const bytes = await lerCorpo(req)
  const inicio = Date.now()
  const resultado = await lerDocumentoLocal(bytes, mediaType, { nomeArquivo, ocr, timeoutMs: 180_000 })
  const dados = resultado.dados && consultar ? await completarComConsultas(resultado.tipo, resultado.texto, resultado.dados) : resultado.dados
  const segundos = (Date.now() - inicio) / 1000

  json(res, 200, {
    arquivo: nomeArquivo,
    tamanhoBytes: bytes.length,
    segundos,
    ...resultado,
    nomeTipo: nomeDoTipo(resultado.tipo),
    nomeTipoPeloConteudo: resultado.tipoPeloConteudo ? nomeDoTipo(resultado.tipoPeloConteudo) : undefined,
    campos: dados?.campos ?? [],
    dados: undefined,
  })
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(await readFile(path.join(PASTA, "index.html")))
      return
    }
    if (req.method === "POST" && url.pathname === "/api/ler") {
      await lerDocumento(req, res, url)
      return
    }
    json(res, 404, { erro: "Não encontrado" })
  } catch (erro) {
    json(res, 400, { erro: (erro as Error).message })
  }
})

servidor.listen(PORTA, "127.0.0.1", () => {
  console.log(`Leitor de documentos — demo rodando em http://localhost:${PORTA}`)
})
