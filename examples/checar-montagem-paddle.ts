// Checagem da montagem do texto do Paddle (src/ocr-paddle.ts): npx tsx examples/checar-montagem-paddle.ts
import assert from "node:assert/strict"
import { montarTexto } from "../src/ocr-paddle.js"

const caixa = (text: string, x: number, y: number, width: number, height = 20, confidence = 0.9) => ({
  text,
  confidence,
  box: { x, y, width, height },
})

// Rótulo pequeno um pouco acima do valor: pelo centro, linhas diferentes e na ordem certa.
assert.equal(
  montarTexto([caixa("FULANO DE TAL", 10, 40, 200), caixa("FILIACAO", 10, 22, 60, 10), caixa("NOME", 10, 0, 40, 10)]),
  "NOME\nFILIACAO\nFULANO DE TAL",
)
// Mesma altura, vão grande: duas colunas, duas linhas. Vão pequeno: mesma linha.
assert.equal(montarTexto([caixa("CICLANO", 10, 0, 100), caixa("SP", 400, 0, 30)]), "CICLANO\nSP")
assert.equal(montarTexto([caixa("RUA", 10, 0, 40), caixa("FICTICIA", 60, 0, 80)]), "RUA FICTICIA")
// Caixa com confiança baixa fica de fora.
assert.equal(montarTexto([caixa("OK", 10, 0, 30), caixa("lixo", 50, 0, 30, 20, 0.2)]), "OK")

console.log("montagem do Paddle: ok")
