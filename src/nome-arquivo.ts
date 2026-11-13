import { normalizar } from "./normalizar.js"
import type { TipoDocumento } from "./tipos.js"

interface RegraNomeArquivo {
  tipo: TipoDocumento
  /**
   * Conjuntos de tokens do nome do arquivo (sem extensão, cortado em qualquer
   * caractere não alfanumérico). Bate quando TODOS os tokens de ALGUM conjunto
   * estão no nome — conjunto de um token só é o caso simples ("damp"), e
   * conjunto maior serve pra exigir contexto: "fgts" sozinho aparece tanto na
   * autorização quanto no extrato, então só vale acompanhado de "autoriza".
   *
   * Token terminado em "*" casa por prefixo. Serve pra fugir de acento: o nome
   * do arquivo chega com a acentuação corrompida com alguma frequência
   * (encoding de zip, de outro sistema operacional, de cliente antigo) —
   * "Autorização" já chegou aqui como "Autoriza??o", e "autorizacao" inteiro
   * nunca casaria. O prefixo ASCII "autoriza*" casa dos dois jeitos. Prefixo
   * curto demais é perigoso ("mo*" pegaria "moradia"), então só onde o token
   * é longo o bastante pra ser específico.
   */
  conjuntos: string[][]
  /** Tokens que anulam a regra (mesmo "*" de prefixo): o nome fala de outra coisa. */
  exceto?: string[]
}

/**
 * Tipo pelo nome do arquivo. Quando o nome diz o tipo, é ele que vale
 * (`comFallbackDeNomeArquivo`, index.ts): o conteúdo só confere.
 *
 * Existe porque alguns documentos são ilegíveis pro motor hoje mas o nome do
 * arquivo já diz o tipo — caso real: DAMP da Caixa vem com o conteúdo
 * desenhado como caminhos vetoriais (sem texto nem imagem grande o bastante
 * pra OCR), mas o corretor sempre nomeia o arquivo "DAMP_<cliente>.pdf".
 *
 * Exige TOKEN inteiro batendo, não substring — "mo" como substring aparece
 * dentro de palavras comuns ("documento", "como", "Tatiana" não, mas
 * "Guilherme" sim); como token isolado (separado por _, -, espaço, ponto)
 * o risco de falso positivo é muito menor.
 *
 * Quando duas regras batem, vale a primeira da lista — menos as de token
 * curto ambíguo (`TOKENS_AMBIGUOS`), que só valem se nenhuma outra bater.
 */
const regras: RegraNomeArquivo[] = [
  { tipo: "damp", conjuntos: [["damp"]] },
  { tipo: "mo_ateste", conjuntos: [["mo"]] },
  { tipo: "autorizacao_fgts", conjuntos: [["autoriza*", "fgts"]] },
  { tipo: "holerite", conjuntos: [["holerite"], ["contracheque"]] },
  // "CTPSContratosDigitais_<CPF>": o nome com que o app da Carteira de Trabalho Digital salva.
  { tipo: "ctps", conjuntos: [["ctps"], ["carteira", "trabalho"], ["ctpscontratosdigitais"]] },
  // "IR 2025", "Recibo IR", "Declaração IRPF" e o nome da Receita ("<CPF>-IRPF-A-2026-2025-REC").
  // "Isenção IR" é a declaração de isento, outro documento.
  { tipo: "imposto_renda", conjuntos: [["ir"], ["irpf"], ["imposto", "renda"]], exceto: ["isen*"] },
  // Foto de RG é o caso mais comum de OCR sair vazio: papel amassado, plástico
  // refletindo, foto torta. Dois RGs reais de teste saíram com zero caractere.
  { tipo: "rg", conjuntos: [["rg"]] },
  // Antes da certidão: "Certidão casamento sem pacto" é a certidão ("exceto"),
  // mas "Registro pacto antenupcial" e "Certidão inexistência de pacto" não.
  // Não "procura*": "CNH procurador" é a CNH. "procura" sozinho é "Procura??o" com o acento perdido.
  { tipo: "procuracao", conjuntos: [["procuracao"], ["procura"]] },
  { tipo: "pacto_antenupcial", conjuntos: [["pacto"]], exceto: ["casamento"] },
  { tipo: "documento_judicial", conjuntos: [["partilha"], ["inventario"], ["sentenca"], ["alvara", "judicial"]] },
  // Processo real com 75 documentos nomeados "FULANA - CNH", "FULANO E
  // BELTRANA - CASAMENTO", "... - ENDEREÇO" (28/09/2026): scan ruim de CNH e
  // de certidão caía em "outro" com o tipo escrito no nome.
  { tipo: "cnh", conjuntos: [["cnh"]] },
  // Antes da certidão: "Matricula 12345 averbacao.pdf" é a matrícula (averbação tem nas duas).
  { tipo: "matricula_imovel", conjuntos: [["matricula"]] },
  {
    tipo: "certidao_estado_civil",
    conjuntos: [["casamento"], ["nascimento"], ["obito"], ["divorcio"], ["averba*"]],
  },
  // "endere*": "ENDEREÇO" chega de vários jeitos (ver o comentário do "*").
  // "Declaração - divergência de endereço" é uma declaração, não o comprovante.
  { tipo: "comprovante_residencia", conjuntos: [["endere*"], ["comprovante", "resid*"], ["residencia"], ["comp", "resid*"], ["comp", "res"]], exceto: ["declara*", "diverg*"] },
  // "CND" sozinho não diz qual: "CND Vendedor.pdf" é a federal, "CND IPTU" a
  // municipal. Sem contexto no nome, decide o conteúdo.
  { tipo: "certidao_negativa_debitos", conjuntos: [["cnd", "iptu"], ["cnd", "imovel"], ["cnd", "municipal"], ["negativa", "iptu"]] },
  { tipo: "cnd_federal", conjuntos: [["cnd", "federal"], ["cnd", "receita"], ["cnd", "pj"]] },
  { tipo: "crf_fgts", conjuntos: [["crf"]] },
  { tipo: "certidao_junta_comercial", conjuntos: [["jucesp"], ["junta", "comercial"], ["certidao", "simplificada"]] },
  { tipo: "contrato_social", conjuntos: [["contrato", "social"], ["alteracao", "contratual"]] },
  { tipo: "iptu", conjuntos: [["iptu"], ["valor", "venal"]] },
  { tipo: "habite_se", conjuntos: [["habite*"], ["carta", "habitacao"]] },
  // "ALVARA.pdf" sozinho não diz qual: o alvará judicial também chega assim.
  { tipo: "alvara_construcao", conjuntos: [["alvara", "constru*"], ["alvara", "execu*"], ["alvara", "aprova*"], ["alvara", "licen*"]] },
  { tipo: "projeto_aprovado", conjuntos: [["projeto"]] },
  { tipo: "art_rrt", conjuntos: [["art"], ["rrt"]] },
  // "BRADESCO PRICE": simulação salva com o sistema de amortização no nome.
  { tipo: "simulacao_financiamento", conjuntos: [["simulacao"], ["price"], ["sac"]] },
  // A pesquisa cadastral da Caixa Aqui vem com o conteúdo em caminhos vetoriais
  // (mesmo caso do DAMP): só é legível renderizando a página. Fica aqui para
  // host sem o canvas nativo. "PC" é a abreviação que o corretor usa no nome.
  { tipo: "pesquisa_cadastral", conjuntos: [["pesquisa", "cadastral"], ["pc"]] },
  // Palavras que quem anexa já escreve e o conteúdo confirmou em 1.676 arquivos reais (12/10/2026):
  // "cadastro" 70 de 70, "conta corrente" 32 de 32, "dps" 34 de 37, "extrato fgts" 21 de 21,
  // "avaliação de risco" 15 de 15. No fim da lista: perdem para qualquer regra acima.
  { tipo: "dps", conjuntos: [["dps"]] },
  { tipo: "proposta_conta_corrente", conjuntos: [["conta", "corrente"]] },
  { tipo: "extrato_fgts", conjuntos: [["extrato", "fgts"]] },
  { tipo: "avaliacao_risco", conjuntos: [["avaliacao", "risco"]] },
  { tipo: "ficha_cadastro", conjuntos: [["cadastro"], ["ficha"]] },
]

function tokenizar(nomeArquivo: string): string[] {
  const semExtensao = nomeArquivo.replace(/\.[a-z0-9]+$/i, "")
  return normalizar(semExtensao)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Token curto que também é palavra comum, abreviação de outra coisa ou
 * iniciais ("IR", "MO", "Art.", "PC", "SAC"): sozinho vale, mas perde para
 * qualquer outra regra que bata. "Comprovante de residencia - IR.pdf" é o
 * comprovante — o nome diz por extenso; "IR" ali pode ser iniciais ou o
 * motivo do envio. Pegar o primeiro da lista dava IR (review, 09/10/2026).
 */
const TOKENS_AMBIGUOS = new Set(["ir", "mo", "art", "pc", "sac"])
const ambiguo = (conjunto: string[]) => conjunto.length === 1 && TOKENS_AMBIGUOS.has(conjunto[0]!)

export function classificarNomeArquivoLocal(
  nomeArquivo: string,
  /**
   * O tipo que o conteúdo firme diz. Nome com dois tipos ("IPTU Endereço",
   * "CND IPTU") aparece em 1,6% dos arquivos reais: vale o que o conteúdo
   * confirma e, sem isso, o primeiro da lista.
   */
  confirmadoPeloConteudo?: TipoDocumento,
): { tipo: TipoDocumento; sinais: string[] } | null {
  const tokens = tokenizar(nomeArquivo)

  for (const aceitaAmbiguo of [false, true]) {
    let primeira: { tipo: TipoDocumento; sinais: string[] } | null = null
    for (const regra of regras) {
      if (regra.exceto?.some((alvo) => bate(tokens, alvo))) continue
      const conjuntoBatido = regra.conjuntos.find(
        (conjunto) => (aceitaAmbiguo || !ambiguo(conjunto)) && conjunto.every((alvo) => bate(tokens, alvo)),
      )
      if (!conjuntoBatido) continue
      const achada = { tipo: regra.tipo, sinais: [`nome do arquivo: "${conjuntoBatido.join(" ")}"`] }
      if (regra.tipo === confirmadoPeloConteudo) return achada
      primeira ??= achada
    }
    if (primeira) return primeira
  }

  return null
}

function bate(tokens: string[], alvo: string): boolean {
  if (!alvo.endsWith("*")) return tokens.includes(alvo)
  const prefixo = alvo.slice(0, -1)
  return tokens.some((token) => token.startsWith(prefixo))
}
