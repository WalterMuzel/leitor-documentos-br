const CODIGO_INICIO_DIACRITICOS = 0x0300
const CODIGO_FIM_DIACRITICOS = 0x036f

function removerAcentos(valor: string): string {
  let resultado = ""
  for (const caractere of valor) {
    const codigo = caractere.codePointAt(0) ?? 0
    if (codigo < CODIGO_INICIO_DIACRITICOS || codigo > CODIGO_FIM_DIACRITICOS) {
      resultado += caractere
    }
  }
  return resultado
}

/**
 * NFKD, não NFD: desfaz também a ligadura que o PDF e o OCR às vezes trazem
 * ("ﬁcha" vira "ficha") e o indicador ordinal ("1ª" vira "1a", "nº" vira "no").
 */
export function normalizar(valor: string): string {
  return removerAcentos(valor.toLowerCase().normalize("NFKD"))
    .replace(/\s+/g, " ")
    .trim()
}
