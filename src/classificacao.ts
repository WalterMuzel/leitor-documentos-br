import { normalizar } from "./normalizar.js"
import type { TipoDocumento } from "./tipos.js"

export interface ClassificacaoLocal {
  tipo: TipoDocumento
  confianca: number
  sinais: string[]
}

export interface RegraClassificacao {
  tipo: TipoDocumento
  /**
   * Uma lista dentro da lista é UM sinal: vale se qualquer um dos termos
   * aparecer. Termo que está dentro de outro ("registro de imoveis" em
   * "cartorio de registro de imoveis") ou variante do mesmo rótulo vai na
   * mesma lista: senão o mesmo trecho conta dois sinais e passa de 2/3 sozinho
   * (examples/checar-classificacao.ts confere).
   */
  sinais: (string | string[])[]
  /**
   * Sinais que outros documentos citam (o contrato cita o FGTS, o cartão do CPF
   * a Receita Federal, toda escritura tem outorgante e outorgado): só somam
   * junto de um sinal de `sinais`, nunca dão o tipo sozinhos.
   */
  fracos?: (string | string[])[]
  /** Termo no cabeçalho que diz que o documento é outro: a regra nem concorre. */
  vetoNoCabecalho?: string[]
}

const LIMIAR_MINIMO_SINAIS = 1
const SINAIS_PARA_CONFIANCA_MAXIMA = 3

/**
 * Documento interno da Caixa ("Grau de sigilo #EXTERNO", PCI, laudo da
 * engenharia): cita o projeto e a matrícula da obra, mas não é nenhum dos dois.
 * Cartório e prefeitura não escrevem isso.
 */
const VETO_DOCUMENTO_DO_BANCO = ["grau de sigilo"]

export const regras: RegraClassificacao[] = [
  {
    tipo: "cnh",
    sinais: [
      "carteira nacional de habilitacao",
      "permissao para dirigir",
      "detran",
      "senatran",
      "renach",
      "categoria hab",
      "driver license",
      "permiso de conduccion",
      // Rotulo da CNH-e: CNH escaneada pequena no meio da folha sai do OCR sem
      // o titulo, mas com os rotulos dos campos (conferido em 28/09/2026). Nada
      // de "nacional de transito": esta no rodape digital da CNH-e junto com
      // "senatran", e 2 sinais no texto direto fariam o motor pular a imagem.
      // "Data, local e UF de nascimento": o OCR troca letra no fim, ou cola "LOCALE".
      ["data local e uf de", "uf de nasc"],
      // Rotulos que o modelo antigo (verde) e o novo tem e que sobrevivem ao
      // OCR quando o cabecalho sai picotado (conferido em 02/10/2026).
      "org. emissor",
      "1a habilitacao", // "1ª" também: o normalizador troca o "ª" por "a"
    ],
    // A CTPS de papel também tem: sozinho, a carteira de trabalho virava CNH.
    fracos: ["assinatura do portador"],
  },
  {
    tipo: "rg",
    sinais: [
      "registro geral",
      "carteira de identidade",
      "secretaria de seguranca publica",
      "instituto de identificacao",
      // Verso do RG: o OCR costuma perder "registro geral" (letra miuda), mas
      // pega a assinatura do delegado e a lei do rodape.

      ["polegar direito", "polegar"],
      "delegado divisionario",
      "7.116 de 29/08/83",
      // O verso lista como campos os outros documentos ("CTPS · NIS/PIS/PASEP ·
      // IDENTIDADE PROFISSIONAL · CERT. MILITAR · TÍTULO ELEITOR"): sem estes,
      // "ctps" e "pasep" davam 2 sinais de CTPS contra 1 de RG (06/10/2026).
      "identidade profissional",
      "cert militar",
      "titulo eleitor",
    ],
    vetoNoCabecalho: ["cadastro de clientes"],
  },
  {
    // Sem sobreposição de propósito com certidao_estado_civil de propósito:
    // uma certidão de nascimento comum (prova de estado civil do próprio
    // comprador) e a certidão de nascimento de um dependente têm texto quase
    // idêntico — o que separa uma da outra é só a menção ao dependente. Não
    // dá pra confiar 100% nisso sem uma amostra real; a categoria/tipo é
    // sempre corrigível à mão na tela do processo.
    tipo: "certidao_nascimento_dependente",
    sinais: ["nascimento do dependente", "certidao de nascimento do menor", "representado por seu responsavel legal"],
  },
  {
    tipo: "certidao_estado_civil",
    sinais: [
      "certidao de nascimento",
      "certidao de casamento",
      "certidao de obito",
      // Sem "registro": o OCR costuma comer o comeco ("Ro CIVIL DAS PESSOAS...").
      "civil das pessoas naturais",
      "cartorio de registro civil",
      // Certidao de nascimento antiga (datilografada): o titulo sai ilegivel do
      // OCR, mas o corpo cita os avos e o declarante.
      "avos paternos",
      "avos maternos",
      "foi declarante",
      "oficial de registro",
      "registrando",
      "assentamento de nascimento",
      "livro a",
      "livro b",
    ],
    // Registro de pacto antenupcial (Livro 3 do Registro de Imóveis) cita a
    // certidão de casamento e o oficial de registro: empatava 3 a 3 (07/10/2026).
    vetoNoCabecalho: ["registro auxiliar", "cnm", "registro geral", "livro 2"],
  },
  {
    tipo: "pesquisa_cadastral",
    sinais: [
      ["pesquisa cadastral simplificada", "resultado da pesquisa cadastral", "pesquisa cadastral"],
      "consulta cadastral",
      "restricoes cadastrais",
      "protestos",
      "cheques sem fundo",
      "scpc",
    ],
  },
  {
    // Confirmado contra o formulario real da Caixa ("Cadastro de Clientes /
    // Formulario de Impressao") em 11/09/2026: sem os sinais especificos do
    // formulario, ele caia como comprovante de residencia — a ficha tem bloco
    // de endereco completo (CEP, logradouro, municipio) e ganhava por
    // quantidade de sinais de endereco.
    tipo: "ficha_cadastro",
    sinais: [
      "cadastro de clientes",
      "declaracao de propositos",
      "codigo do correspondente",
      "agencia de relacionamento",
      "caracteristica da renda",
      "ficha cadastro",
      "ficha cadastral",
      "dados cadastrais do proponente",
    ],
  },
  {
    // "Formulario de Impressao AVALIACAO DE RISCO" da Caixa/SIOPI — resultado
    // da simulacao (aprovada/reprovada), nao o cadastro do cliente. Confirmado
    // contra um real em 23/09/2026. Compartilha "agencia de relacionamento"
    // com ficha_cadastro, mas os sinais proprios daqui sao mais fortes (3+
    // contra 1) e ganham por contagem, nao por ordem no array.
    tipo: "avaliacao_risco",
    sinais: [
      "avaliacao de risco",
      "formulario de impressao",
      "dados do proponente",
      "dados da avaliacao",
      "resultado da avaliacao",
      "protocolo do cadastro",
      "codigo avaliacao",
      "siopi",
    ],
  },
  {
    // Formulario do banco preenchido para o cliente assinar (proposta de
    // financiamento, autorizacao de analise de credito do Bradesco). A
    // proposta cita "cartorio de registro de imoveis" e "matricula" e caia
    // como matricula com 100% — iria para Imovel e passaria pela analise de
    // garantia. Fica antes da matricula: empate vai para a primeira regra.
    tipo: "formulario_banco",
    sinais: [
      "proposta de financiamento imobiliario",
      "analises de credito e de avaliacao",
      "sem abreviacoes",
      "dados do 1º comprador",
      "compor renda",
      // Documentos da Caixa para construção (PCI e laudo da engenharia): citam
      // projeto aprovado, implantação, área permeável e liam como projeto ou
      // matrícula (07/10/2026).
      ["proposta de construcao individual", "laudo de analise"],
      "construcao em terreno proprio",
      // Santander: "Autorização do(s) Comprador(es) para Aquisição de Imóvel" e a confirmação de valores.
      ["autorizacao do(s) comprador(es)", "autorizacao do(s) cliente(s)", "autorizacao do(s) proponente(s)"],
      ["o(s) comprador(es) declara(m)", "o(s) cliente(s) declara(m)"],
      "confirmacao de valores",
      // Bradesco.
      "proposta credimovel",
      ["dados do(s) cliente(s) / proponente(s)", "vendedor(es) pessoa fisica/pessoa jur"],
      // Itaú: formulário em PDF e o formulário digital (rótulos em minúscula).
      ["formulario de vendedor pessoa", "formulario de comprador pessoa", "credito imobiliario itau"],
      ["dados do vendedor razao social", "dados cadastrais nome completo", "condicoes do imovel"],
      "durante a contratacao",
    ],
  },
  {
    // Simulacao de financiamento impressa do simulador do banco (Caixa:
    // "Simulador Credito Imobiliario CAIXA") ou print da proposta no portal
    // do banco (Bradesco: "Simular / Enviar Proposta" > "Detalhes da
    // proposta"). Sem esta regra, os dois caiam em extrato_fgts (a simulacao
    // da Caixa fala "FGTS" varias vezes) e extrato_bancario (o print so cita
    // "bradesco") com 33% — conferido com os dois reais em 28/09/2026.
    // Sinais sem pontuacao de proposito: o normalizador preserva "/".
    tipo: "simulacao_financiamento",
    sinais: [
      "simulador credito imobiliario",
      "cota maxima de financ",
      "somatorio das parcelas",
      "juros efetivos",
      "prazo escolhido",
      "ultima prestacao",
      "detalhes da proposta",
      "propostas enviadas",
      "enviar proposta",
      "analise de credito",
    ],
  },
  {
    // Confirmado contra a proposta real da Caixa em 11/09/2026 (antes caia
    // como certidao de estado civil, por causa do "Oficio de Registro de
    // Titulos e Documentos" citado nas clausulas gerais do contrato).
    tipo: "proposta_conta_corrente",
    sinais: [
      "proposta de abertura de conta",
      "adesao a produtos e servicos",
      "correspondente caixa aqui",
      "categoria da conta",
      "cheque especial",
    ],
  },
  {
    // "M.O." é o Formulário Cliente Crédito Imobiliário da Caixa (autorização
    // de forma de pagamento + proposta de seguro habitacional) — confirmado
    // contra um formulário MO real em 10/09/2026. O rótulo
    // "M.O." / "memorando de operacao" é jargão do corretor, não aparece no
    // texto do formulário em si — por isso os sinais de conteúdo são os
    // títulos de seção reais, e os termos de jargão ficam como reforço caso
    // apareçam numa variante diferente do formulário.
    tipo: "mo_ateste",
    sinais: [
      "autorizacao da forma de pagamento",
      "proposta do seguro habitacional",
      "tarifa de avaliacao de bens recebidos em garantia",
      "memorando de operacao",
      "m o ateste",
      "ateste da operacao",
    ],
  },
  {
    // DAMP da Caixa: "Declaracao para Enquadramento no Programa e Autorizacao
    // para Movimentacao e Utilizacao dos Recursos da Conta Vinculada do FGTS".
    // Confirmado contra DAMP real em 11/09/2026 — a expansao que estava aqui
    // antes ("Declaracao de Atividade e Meios de Pagamento") era um chute e
    // estava errada. O PDF vem com o conteudo em caminhos vetoriais: so da pra
    // ler renderizando a pagina (ver pdf.ts). Precisa de sinais fortes porque o
    // texto tambem traz PIS/PASEP e ocupacao do cliente, que sozinhos davam CTPS.
    tipo: "damp",
    sinais: [
      "declaracao para enquadramento no programa",
      "autorizacao para movimentacao e utilizacao",
      "solicitacao para movimentacao de conta vinculada",
      "cessao de direitos creditorios",
      "imovel objeto do financiamento",
      "situacao ocupacional",
      "damp",
      // Versão do Itaú, "Autorização para Movimentação de Conta Vinculada ao
      // FGTS — Aquisição de Moradia" (01/10/2026): campos do trabalhador dão 4
      // sinais de CTPS; o título, as instruções e a regra dos municípios dão 5.
      "autorizacao para movimentacao de conta vinculada",
      "formulario para movimentacao de conta vinculada",
      "utilizar o fgts no seu credito imobiliario",
      "municipios limitrofes",
      "integrantes da mesma regiao metropolitana",
      // Mesmo DAMP do Itaú, "Versão Varejo Central" (7-11 páginas): a 1ª página
      // é instrução e cita "carteira de trabalho"; as outras têm campos de
      // empregador e PASEP. Dava 4 sinais de CTPS contra 2 de DAMP — em 7 do
      // lote real só o nome do arquivo ("DAMP_...") salvava (06/10/2026).
      "versao varejo central",
      "este formulario deve ser preenchido por quem utilizara o fgts",
      "autorizo o itau a saque dos meus recursos no fgts",
      "declaracoes do titular da conta vinculada do fgts",
      "utilize uma via para cada comprador",
      "ocupacao laboral principal",
    ],
  },
  {
    tipo: "dps",
    sinais: ["dps", "declaracao pessoal de saude"],
  },
  {
    // Confirmado contra a tela real de consulta autorizada (Habitacao Caixa /
    // SIOPI) em 11/09/2026. Cuidado com "conta vinculada" sozinho: o DAMP
    // tambem fala de conta vinculada do FGTS.
    tipo: "autorizacao_fgts",
    sinais: [
      "conta vinculada autorizada pelo cliente",
      "dados da permissao de acesso",
      "dados do cliente no fgts",
      "consulta no fgts",
      "autorizacao de movimentacao do fgts",
      "autorizacao app fgts",
      "siopi",
    ],
    // Contrato de compra e venda e DAMP citam (review, 09/10/2026).
    fracos: ["conselho curador do fgts", "uso do fgts"],
  },
  {
    // Conta de luz/agua tem vocabulario proprio (leitura, medidor, tensao) que
    // nao aparecia aqui: uma conta real da CPFL em foto caia como "outro" —
    // o OCR corrompeu o nome da distribuidora ("CPFL" saiu ilegivel), e o
    // resto do texto nao batia nenhum sinal. Os termos do documento fiscal
    // de energia sobrevivem melhor ao OCR que a marca da empresa.
    tipo: "comprovante_residencia",
    sinais: [
      "fatura",
      "conta de consumo",
      ["nota fiscal de energia eletrica", "energia eletrica"],
      "kwh",
      "nf3e",
      "unidade consumidora",
      "leitura anterior",
      "proxima leitura",
      "tensao nominal",
      "tipo de fornecimento",
      "agua e esgoto",
      "hidrometro",
      "enel",
      "cpfl",
      "sabesp",
      "semae",
      "copasa",
      "comgas",
      "light sa",
      "telefonica brasil",
      "vivo fibra",
      "claro",
      ["codigo do cliente", "codigo cliente"],
      // Nota fiscal nacional de telecom (NFCom). Uma conta real da Claro caia
      // como extrato bancario: o verso traz o formulario de debito automatico
      // e a lista "pague nos bancos credenciados", 5 nomes de banco contra 3
      // sinais de fatura. Estes termos sao do documento fiscal, nao da marca.
      // O titulo ("Documento auxiliar da nota fiscal de FATURA de servico de
      // comunicacao eletronica") ja conta como "fatura": nao entra de novo.
      "nfcom",
      "periodo de uso",
    ],
  },
  {
    // Extrato do FGTS por vinculo empregaticio (emitido pela Caixa, gestora
    // do fundo). Precisa vir ANTES de ctps no array: os dois compartilham
    // sinais (lista o vinculo — empregador, data de admissao, PIS/PASEP,
    // "carteira de trabalho" como rotulo de campo), entao em empate quem
    // aparece primeiro ganha. A palavra "FGTS" nem sempre aparece escrita no
    // extrato em si — o cabecalho da Caixa e "CREDITO DE JAM" (juros e
    // atualizacao monetaria da conta vinculada) sao os sinais que realmente
    // aparecem, vistos num extrato real.
    // Sinais conferidos direto no texto extraido de um extrato real — o
    // pdf.js insere espaco extra em algumas palavras acentuadas desse layout
    // (ex.: "RESCISÓRIOS" vira "rescis o rios"), entao termos como "valor
    // para fins rescisorios" nunca batem; os que seguem sao os que realmente
    // aparecem intactos.
    tipo: "extrato_fgts",
    sinais: [
      "para uso da caixa",
      "credito de jam",
      "historico emitido",
      "data de opcao",
      "valor para fins",
      // Extrato emitido pelo empregador no Conectividade Social: layout
      // rotulado ("Nome:", "Cód. Estab.:"), sem os sinais do extrato impresso.
      // Um real empatava com ctps (2 a 2) e so ganhava pela ordem do array.
      "extrato de conta do fundo de garantia",
      "conectividade social",
      "valor base para fins",
    ],
    // Contrato de compra e venda que cita o FGTS virava extrato (review,
    // 09/10/2026); "tipo de conta" esta na declaracao de IR e na proposta de conta.
    fracos: ["fgts", "tipo de conta"],
  },
  {
    tipo: "ctps",
    sinais: [
      ["carteira de trabalho e previdencia social", "carteira de trabalho digital", "carteira de trabalho"],
      "ctps",
      "contrato de trabalho",
      "data de admissao",
      // "PIS/PASEP" e "PIS PASEP" aparecem dos dois jeitos; "pasep" cobre os dois
      // porque normalizar() nao mexe em pontuacao.
      "pasep",
      "numero de serie",
      "empregador",
    ],
    vetoNoCabecalho: ["movimentacao de conta vinculada"],
  },
  {
    tipo: "holerite",
    sinais: [
      "contracheque",
      "recibo de pagamento",
      "salario base",
      "vencimentos",
      "descontos",
      "inss",
    ],
    fracos: ["fgts"],
  },
  {
    tipo: "imposto_renda",
    sinais: [
      "declaracao de ajuste anual",
      "irpf",
      "imposto de renda da pessoa fisica",
      "recibo de entrega",
      // Termos abaixo vieram de uma declaracao real (DIRPF) que perdia pra
      // extrato_bancario/iptu: a lista antiga tinha poucos sinais e uma
      // declaracao de IR sempre lista bancos (bens e direitos, rendimentos)
      // e usa "exercicio"/"carne" (carne-leao) — termos genericos demais que
      // ganhavam por contagem bruta de sinais dos outros tipos.
      "identificacao do contribuinte",
      "ano-calendario",
      "natureza da ocupacao",
      "rendimentos tributaveis",
      "declaracao retificadora",
      "bens e direitos",
    ],
    // Vai no cartao do CPF, na CND e no cartao CNPJ: o cartao do CPF virava IR (review, 09/10/2026).
    fracos: ["receita federal do brasil"],
    vetoNoCabecalho: ["declaracao de isencao", "divergencia de endereco"],
  },
  {
    tipo: "extrato_bancario",
    sinais: [
      "extrato de conta corrente",
      "saldo anterior",
      "saldo em conta",
    ],
    // Nome de banco vale um sinal so, todos juntos (fatura e boleto listam os
    // bancos onde pagar), e e fraco: todo formulario e declaracao do banco traz
    // o nome dele. Sozinho, deu extrato a 24 documentos reais, nenhum era (12/10/2026).
    fracos: [["itau", "bradesco", "nubank", "santander", "banco do brasil", "caixa economica federal"]],
  },
  // Imóvel novo / construção (Caixa pede alvará, ART/RRT, projeto e habite-se).
  // Antes da matrícula, da CND e do IPTU: documento da prefeitura cita
  // "matrícula nº" e "prefeitura municipal", e o habite-se de São Vicente lia
  // CND com 67%; a matrícula averbada cita o habite-se, mas bate muito mais
  // sinais dela. Conferidos em 15 documentos reais (07/10/2026).
  {
    // Habite-se, carta de habitação (São Vicente), certificado de conclusão (São Paulo).
    // Fica antes do alvará: o certificado de São Paulo cita os alvarás da obra.
    tipo: "habite_se",
    sinais: [
      ["habite-se", "habite se", "carta de habitacao", "certificado de conclusao", "auto de conclusao", "termo de conclusao"],
      ["possa ser habitado", "pode ser habitado", "apto a ser habitado", "liberado para uso"],
      ["conclusao total", "conclusao parcial", "conclusao da obra", "obra concluida"],
      ["executada em conformidade", "autorizada pelo alvara"],
    ],
    vetoNoCabecalho: VETO_DOCUMENTO_DO_BANCO,
  },
  {
    tipo: "alvara_construcao",
    sinais: [
      ["alvara de construcao", "alvara de licenca", "licenca de construcao", "alvara de execucao", "alvara de aprovacao"],
      "edificacao nova",
      // "fica concedida li-": o OCR quebra "licença" no fim da linha.
      ["fica concedida a licenca", "fica concedida li", "concede licenca", "licenca para execucao", "licenca para construcao"],
      "autor do projeto",
      ["secretaria municipal de licenciamento", "secretaria de licenciamento", "obras particulares"],
    ],
    vetoNoCabecalho: VETO_DOCUMENTO_DO_BANCO,
  },
  {
    tipo: "projeto_aprovado",
    sinais: [
      ["projeto de aprovacao", "projeto aprovado", "projeto de construcao"],
      ["plantas", "planta baixa"],
      ["corte aa", "corte a-a", "corte bb", "corte b-b", "cortes"],
      "fachada",
      "implantacao",
      ["area permeavel", "quadro de areas", "taxa de ocupacao", "coeficiente de aproveitamento"],
      ["escala 1:", "esc: 1/", "esc. 1/", "1:100", "1 : 100"],
    ],
    vetoNoCabecalho: ["laudo de avaliacao", ...VETO_DOCUMENTO_DO_BANCO],
  },
  {
    // ART (CREA/CONFEA, engenheiro) e RRT (CAU, arquiteto): a mesma coisa para o banco.
    tipo: "art_rrt",
    sinais: [
      ["anotacao de responsabilidade tecnica", "registro de responsabilidade tecnica", "detalhes do rrt"],
      ["confea", "creasp", "conselho regional de engenharia"],
      ["cau/br", "caubr", "siccau", "conselho de arquitetura"],
      "1.025/2009",
      ["forma de participacao", "entidade de classe", "forma de registro"],
    ],
    vetoNoCabecalho: VETO_DOCUMENTO_DO_BANCO,
  },
  {
    tipo: "matricula_imovel",
    sinais: [
      "livro 2",
      "onus reais",
      // So de matricula: a certidao de casamento nao prenota, nao tem
      // transmitente/adquirente nem o Livro 2 - Registro Geral. Uma matricula
      // real com o cabecalho estragado no OCR perdia para certidao (3 a 2) com
      // o que ela cita dos donos: "certidao de casamento", "civil das pessoas
      // naturais", "oficial de registro" (05/10/2026).
      "prenotacao",
      "registro geral",
      "transmitente",
      "adquirente",
      "cnm",
    ],
    // Todo mundo cita a matrícula do imóvel e o cartório dela (contrato,
    // escritura, IPTU, DAMP), e toda certidão de registro civil desde 2010 traz
    // "MATRÍCULA" + 32 dígitos (a matrícula da certidão); a de casamento com
    // pacto cita o Registro de Imóveis. Sozinhos, os dois davam matrícula com
    // 67% a um contrato de compra e venda (review, 09/10/2026).
    fracos: ["matricula", ["cartorio de registro de imoveis", "registro de imoveis"]],
    // O Livro 3 do Registro de Imóveis (Registro Auxiliar) guarda pacto
    // antenupcial, convenção de condomínio, cédula: a certidão dele tem o mesmo
    // cabeçalho da matrícula ("consta a matrícula", CNM, prenotação), mas não é
    // a matrícula do imóvel, que fica no Livro 2. Registro de pacto real lia
    // matrícula com 100% (07/10/2026).
    vetoNoCabecalho: ["registro auxiliar", ...VETO_DOCUMENTO_DO_BANCO],
  },
  // Os três abaixo citam a matrícula do imóvel ("matrícula nº", "Registro de
  // Imóveis", "Livro 2") e liam como matrícula com 100% — iriam para a análise
  // de garantia (07/10/2026). Ficam depois da matrícula: empate vai para ela.
  {
    tipo: "procuracao",
    sinais: [
      "procuracao",
      "substabelec",
      ["seu bastante procurador", "sua bastante procuradora", "constitui e nomeia", "nomeia e constitui"],
      ["poderes especiais", "amplos poderes", "gerais poderes"],
    ],
    // Toda escritura tem outorgante e outorgado (review, 09/10/2026), e os
    // dois são a mesma palavra: um sinal só.
    fracos: [["outorgante", "outorgado", "outorgada"]],
    // Escritura de venda com o vendedor representado cita a procuração e o
    // "bastante procurador": pelo título, não é ela.
    vetoNoCabecalho: [
      "escritura de venda",
      "escritura publica de venda",
      "escritura de compra",
      "escritura publica de compra",
      "escritura de doacao",
      "escritura publica de doacao",
    ],
  },
  {
    // Escritura do pacto (Tabelião de Notas) e o registro dela no Livro 3 do
    // Registro de Imóveis. A escritura também tem "outorgantes" e "outorgados"
    // (um sinal fraco de procuração).
    tipo: "pacto_antenupcial",
    sinais: [
      "pacto antenupcial",
      "registro auxiliar",
      "reciprocamente outorgados",
      ["nubentes", "contraentes"],
      ["separacao total de bens", "separacao de bens", "comunhao universal", "participacao final nos aquestos"],
      ["futuro casamento", "pretendem se casar", "pretendem contrair"],
    ],
  },
  {
    // Peça de processo: alvará judicial (espólio, menor, interdito), formal de
    // partilha, sentença, termo de audiência, petição. Os reais do lote eram
    // de um divórcio com partilha do imóvel. Nada de "tribunal de justica": vai
    // no selo de toda certidão de cartório.
    tipo: "documento_judicial",
    sinais: [
      "juiz de direito",
      ["vara de familia", "vara da familia", "vara civel", "vara de sucessoes", "vara de orfaos"],
      ["transito em julgado", "transitou em julgado", "transitada em julgado"],
      ["alvara judicial", "formal de partilha", "termo de audiencia", "carta de sentenca"],
      ["inventariante", "inventariado", "espolio"],
      ["requerente", "requerido", "requerida"],
      ["meritissim", "mm. juiz", "mm juiz", "exmo. sr. dr. juiz"],
      ["deste juizo", "conta judicial"],
    ],
    // A averbação de divórcio na certidão de casamento (e o registro da partilha
    // na matrícula) repete a sentença: juiz de direito, vara, trânsito em
    // julgado. Duas certidões reais viravam documento judicial (07/10/2026).
    vetoNoCabecalho: ["certidao de casamento", "certidao de nascimento", "certidao de obito", "civil das pessoas naturais", "registro de imoveis"],
  },
  {
    // CND da Receita/PGFN, de pessoa ou de empresa (vendedor PJ). Antes da
    // municipal: tambem diz "certidao negativa de debitos", e empate vai pra
    // primeira. A "positiva com efeitos de negativa" nao diz "certidao
    // negativa" nenhuma vez — so batia "receita federal do brasil" (IR).
    tipo: "cnd_federal",
    sinais: [
      "tributos federais",
      "divida ativa da uniao",
      "fazenda nacional",
      "efeitos de negativa",
      "codigo de controle da certidao",
    ],
  },
  {
    // CRF: certificado de regularidade do FGTS da empresa, emitido no site da
    // Caixa. Cita "Fundo de Garantia" e caia em extrato do FGTS com 1 sinal.
    tipo: "crf_fgts",
    sinais: [
      "certificado de regularidade do fgts",
      "regularidade do empregador",
      "situacao regular perante o fundo de garantia",
      "certificacao numero",
      "consulta-crf",
    ],
  },
  {
    // Certidao negativa de debitos/tributos municipais: vem junto do IPTU no
    // dossie, mas e outro documento. Fica antes do iptu porque as duas regras
    // compartilham vocabulario de cadastro do imovel e empate vai pra primeira.
    tipo: "certidao_negativa_debitos",
    sinais: [
      ["certidao negativa de debitos", "certidao negativa de tributos", "certidao negativa"],
      "tributos imobiliarios",
      "fazenda municipal",
      "quite com",
      "ressalvado o direito da fazenda",
    ],
  },
  {
    // Cobre tambem a certidao de valor venal da prefeitura, que ocupa o mesmo
    // lugar no dossie (documento fiscal do imovel). Sem os sinais proprios
    // dela, uma certidao de valor venal real caia como matricula do imovel —
    // ela cita cartorio, matricula e averbacao no bloco de registro, e isso
    // bastava pra ganhar. Errar aqui e pior que parecer: o documento iria pro
    // lugar da matricula no dossie e ainda passaria pela analise de garantia.
    tipo: "iptu",
    sinais: [
      "imposto predial e territorial urbano",
      ["certidao de valor venal", "valor venal"],
      "inscricao cadastral",
      "area territorial",
      "carne",
      "exercicio",
      "guia de pagamento",
      // Ficha do imovel da prefeitura (vem grudada no carne do IPTU).
      "ficha do imovel",
      "administracao tributaria",
      "secretaria municipal de financas",
      "prefeitura municipal",
    ],
  },
  {
    // Depois do iptu de proposito: "junta comercial" sozinha aparece no rodape
    // de IPTU de imovel de empresa, e empate de 1 sinal vai pra regra que vem
    // antes. Contrato social de verdade bate 5-6 sinais, entao nao perde nada.
    tipo: "contrato_social",
    sinais: [
      "contrato social",
      "sociedade empresaria limitada",
      "capital social",
      "junta comercial",
      "quotas",
      "administracao da sociedade",
      "alteracao contratual",
    ],
  },
  {
    // Certidão simplificada da Junta Comercial (JUCESP): o resumo da empresa
    // — CNPJ, sede, sócios e administradores. Cita "junta comercial", mas os
    // sinais abaixo nenhum contrato social real teve (no máximo 1).
    tipo: "certidao_junta_comercial",
    sinais: [
      "certidao simplificada",
      "arquivamentos posteriores",
      "nome comercial",
      "socio e administrador",
      "fim das informacoes para nire",
    ],
  },
  {
    tipo: "cartao_cnpj",
    sinais: [
      "comprovante de inscricao e de situacao cadastral",
      "nome empresarial",
      "titulo do estabelecimento",
      "atividade economica principal",
      "natureza juridica",
      "ente federativo responsavel",
    ],
  },
]

/**
 * Sigla ou palavra curta (até 6 letras: "claro", "irpf", "fatura") vale
 * solta, não dentro de outra palavra: "claro" estava em "de-CLARO" — toda
 * declaração ("Eu, fulano, declaro...") virava conta da operadora —, "fatura"
 * em "faturamento" (nota fiscal virava comprovante de residência) e "quotas"
 * em "alíquotas". Número ou "_" ao lado não impede ("150kWh", "IRPF2026").
 * Palavra mais longa continua valendo dentro de outra: o OCR cola palavras
 * ("POLEGARDIREITO" num RG real) e o plural ("transmitentes") tem que bater.
 */
function contem(texto: string, termo: string): boolean {
  if (!/^[a-z]{1,6}$/.test(termo)) return texto.includes(termo)
  return new RegExp(`(?<![a-z])${termo}(?![a-z])`).test(texto)
}

/**
 * Começo do texto, onde fica o título. Só para veto (`vetoNoCabecalho`): peso
 * em dobro para todo sinal do cabeçalho foi testado e piorou holerite, extrato
 * do FGTS e simulação, que têm rótulos de campo no topo ("CTPS", "data de
 * admissão", nome do banco) — 07/10/2026.
 */
const CABECALHO_CARACTERES = 500

/**
 * Certidão de estado civil é curta: nos documentos reais (1.723), mediana de 1
 * página e ~3 mil caracteres, nenhuma passando de ~6 mil, e as de 3 páginas são
 * casamento + divórcio. Matrícula tem mediana de 4 páginas e ~11 mil caracteres —
 * e cita a certidão de casamento dos donos, o que a fazia perder para certidão.
 * Documento grande com sinal PRÓPRIO de matrícula (livro 2, ônus reais,
 * prenotação, transmitente, adquirente, CNM) não é certidão de estado civil.
 * "Matrícula" e "Registro de Imóveis" sozinhos não bastam (são `fracos`): a
 * certidão tem os dois, e a de 4 páginas, ou com o texto do Paddle e do
 * Tesseract juntos, virava matrícula (review, 09/10/2026).
 */
const CERTIDAO_MAX_CARACTERES = 7000
const CERTIDAO_MAX_PAGINAS = 3

export interface OpcoesClassificacao {
  /** Total de páginas do PDF, quando se sabe. */
  paginas?: number
}

export function classificarTextoLocal(textoOriginal: string, opcoes: OpcoesClassificacao = {}): ClassificacaoLocal {
  const texto = normalizar(textoOriginal)

  let melhorTipo: TipoDocumento = "outro"
  let melhorPontuacao = 0
  let melhoresSinais: string[] = []
  let sinaisDeMatricula: string[] = []

  const cabecalho = texto.slice(0, CABECALHO_CARACTERES)

  const achados = (sinais: RegraClassificacao["sinais"] = []) =>
    sinais.flatMap((sinal) => {
      const achado = (Array.isArray(sinal) ? sinal : [sinal]).find((termo) => contem(texto, normalizar(termo)))
      return achado ? [achado] : []
    })

  for (const regra of regras) {
    if (regra.vetoNoCabecalho?.some((termo) => contem(cabecalho, termo))) continue
    const proprios = achados(regra.sinais)
    const sinaisEncontrados = proprios.length > 0 ? [...proprios, ...achados(regra.fracos)] : []
    if (regra.tipo === "matricula_imovel") sinaisDeMatricula = sinaisEncontrados
    if (sinaisEncontrados.length > melhorPontuacao) {
      melhorTipo = regra.tipo
      melhorPontuacao = sinaisEncontrados.length
      melhoresSinais = sinaisEncontrados
    }
  }

  const grande = textoOriginal.length >= CERTIDAO_MAX_CARACTERES || (opcoes.paginas ?? 0) > CERTIDAO_MAX_PAGINAS
  // sinaisDeMatricula só não é vazio com um sinal próprio (ver `fracos`).
  if (melhorTipo === "certidao_estado_civil" && grande && sinaisDeMatricula.length > 0) {
    melhorTipo = "matricula_imovel"
    melhorPontuacao = sinaisDeMatricula.length
    melhoresSinais = sinaisDeMatricula
  }

  if (melhorPontuacao < LIMIAR_MINIMO_SINAIS) {
    return { tipo: "outro", confianca: 0, sinais: [] }
  }

  const confianca = Math.min(melhorPontuacao / SINAIS_PARA_CONFIANCA_MAXIMA, 1)
  return { tipo: melhorTipo, confianca, sinais: melhoresSinais }
}
