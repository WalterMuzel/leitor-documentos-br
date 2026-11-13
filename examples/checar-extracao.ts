/**
 * Extração de campos com texto inventado (nomes e números fictícios; CPF
 * 529.982.247-25 e CNPJ 11.222.333/0001-81 são exemplos com dígito válido).
 *   npm run checar-extracao
 */
import assert from "node:assert/strict"
import {
  analisarMatricula,
  extrairCpf,
  extrairCtpsDigital,
  extrairDataNascimentoRotulada,
  extrairEmpresa,
  extrairEnderecoMatricula,
  extrairExtratoFgts,
  extrairFiliacao,
  extrairIdentidade,
  extrairLocalNascimento,
  extrairNacionalidade,
} from "../src/extracao.js"
import { extrairDados, extrairNomeTitular, titularDoComprovante } from "../src/dados.js"

// ---------------------------------------------------------------------------
// Pessoa: RG, CNH, CTPS, extrato do FGTS

{
  // RG de SP: rótulos partidos em duas linhas, com o valor no meio.
  const novo = extrairIdentidade("REGISTRO 12.345.678-9 DATA DE 13/12/2012 GERAL EXPEDIÇAO NOME FULANA DE TAL", "rg");
  assert.equal(novo?.numero, "123456789");
  assert.equal(novo?.emissao, "2012-12-13");
  // Modelo antigo: mês abreviado; sem "SSP/SP" impresso, o cabeçalho diz quem emitiu.
  const antigo = extrairIdentidade(
    "ESTADO DE SÃO PAULO SECRETARIA DA SEGURANÇA PÚBLICA REGISTRO GERAL 1.234.567-8 DATA DE EXPEDIÇÃO 13/DEZ/2012",
    "rg",
  );
  assert.deepEqual(antigo, { tipo: "RG", numero: "12345678", emissao: "2012-12-13", orgaoEmissor: "SSP", uf: "SP" });
  // Sem rótulo nenhum: a data colada ao número, nunca a de nascimento.
  assert.equal(
    extrairIdentidade("DE NASCIMENTO 01/02/1960 NATURALIDADE X 13/12/2012 VIA 1.234.567-8", "rg")?.emissao,
    "2012-12-13",
  );
  // Nascimento: o OCR perde o "DATA" do rótulo; "certidão de nascimento" não é rótulo.
  assert.equal(extrairDataNascimentoRotulada("FILIAÇÃO FULANO DE NASCIMENTO 01/02/1960"), "1960-02-01");
  assert.equal(extrairDataNascimentoRotulada("DOC ORIGEM CERTIDÃO DE NASCIMENTO 01/02/1960"), undefined);
  // O RG de SP imprime o CPF com barra.
  assert.equal(extrairCpf("CPF 529982247/25"), "52998224725");
}

{
  // CNH: registro com dígito verificador certo sai; com um dígito trocado pelo OCR, fica vazio.
  const cnh = (registro: string) => `CARTEIRA NACIONAL DE HABILITACAO 5 Nº REGISTRO ${registro} 9 CAT HAB AB`;
  assert.equal(extrairIdentidade(cnh("12345678900"), "cnh")?.numero, "12345678900");
  assert.equal(extrairIdentidade(cnh("12345678980"), "cnh")?.numero, undefined);
  // O "Nº" lido torto pelo OCR ("a° REGISTRO") não perde o número.
  assert.equal(extrairIdentidade("5 a° REGISTRO -9 CAT HAB 12345678900 B", "cnh")?.numero, "12345678900");
  // RG lido pelo Paddle: a cidade entre "NASCIMENTO" e a data.
  assert.deepEqual(extrairLocalNascimento("DATA DE NASCIMENTO SANTOS - SP 01/02/1960 DOC ORIGEM"), { cidade: "Santos", uf: "SP" });
  // "BRASILEIRO(A)" da CNH vira "Brasileira", como nas outras leituras.
  assert.equal(extrairNacionalidade("NACIONALIDADE\nBRASILEIRO(A)"), "Brasileira");
}

{
  // CTPS digital: contrato em aberto dá o empregador.
  const ctps = extrairCtpsDigital(
    "Contratos de trabalho 01/02/2025 - Aberto Empregador COMERCIO FICTICIO LTDA CNPJ RAIZ: 11.222.333 Estabelecimento X",
  );
  assert.equal(ctps.empregador, "COMERCIO FICTICIO LTDA");
}

// CNH digital: a marca d'água cobre o rótulo "FILIAÇÃO" e vira palavra com
// maiúscula no meio; o nome do pai sai colado numa palavra só (ilegível, mas
// segura a posição); o carimbo "ASSINADO DIGITALMENTE" não é a mãe.
{
  const cnhDigital = (meio: string) =>
    `CARTEIRA NACIONAL DE HABILITAÇÃO\nNACIONALIDADE\ncYanmaG n Yel\n${meio}\n7 ASSINATURA DO PORTADOR\nASSINADO DIGITALMENTE\nDEPARTAMENTO ESTADUAL DE TRÂNSITO\nSAO PAULO, SP`;
  assert.equal(extrairNacionalidade(cnhDigital("PEDRO HENRIQUE ALVES\nMARIA CLARA ALVES")), undefined);
  assert.deepEqual(extrairFiliacao(cnhDigital("PEDRO HENRIQUE ALVES\nMARIA CLARA ALVES")), { pai: "Pedro Henrique Alves", mae: "Maria Clara Alves" });
  assert.deepEqual(extrairFiliacao(cnhDigital("PEDROHENRIQUEALVES\nMARIA CLARA ALVES")), { mae: "Maria Clara Alves" });
  // Um nome só, com rótulo: não dá para saber se é pai ou mãe — e o carimbo não completa o par.
  assert.equal(extrairFiliacao("CARTEIRA NACIONAL DE HABILITAÇÃO\nFILIAÇÃO\nMARIA CLARA ALVES\nASSINADO DIGITALMENTE"), undefined);
}

{
  // Extrato completo do app da Caixa: saldo ligado à conta pela página; conta zerada fica de fora.
  const extrato =
    "1,00 2,00 Pag: 1/3 SALDO: R$ 1.234,56 HISTÓRICO NOME: FULANA DE TAL EMPRESA: EMPRESA UM LTDA NÚMERO DA CONTA: 9970000000001 / 111 SP " +
    "Pag: 2/3 SALDO: R$ 0,00 NOME: FULANA DE TAL EMPRESA: EMPRESA DOIS NÚMERO DA CONTA: 9970000000002 / 222 SP Pag: 3/3 TOTAL";
  const lida = extrairExtratoFgts(extrato);
  assert.deepEqual(lida.contasFgts, [{ codigoEmpregador: "9970000000001", conta: "111", valor: 1234.56 }]);
  assert.equal(lida.nome, "FULANA DE TAL");
}

// ---------------------------------------------------------------------------
// Matrícula: endereço e garantia

{
  // Endereço do imóvel na matrícula: número colado na rua e unidade com ponto de milhar.
  const colado = extrairEnderecoMatricula(
    "IMÓVEL: APARTAMENTO N. 1.204, no 12o pavimento, situado na Rua Exemplo ns. 100 e 102 (loja), no 9o Subdistrito — BAIRRO FICTÍCIO. PROPRIETÁRIA: X",
  );
  assert.deepEqual([colado?.logradouro, colado?.numero, colado?.complemento], ["Rua Exemplo", "100", "Apartamento 1204"]);
  const virgula = extrairEnderecoMatricula("IMÓVEL: casa, situada na Rua Exemplo, nº 55, bairro Centro. PROPRIETÁRIO: X");
  assert.deepEqual([virgula?.logradouro, virgula?.numero, virgula?.bairro], ["Rua Exemplo", "55", "Centro"]);
  const nestaCidade = extrairEnderecoMatricula(
    "IMÓVEL: Apartamento no 61, do Bloco D, situado nesta cidade, na Rua Exemplo, no 1020, Parque Tal. PROPRIETÁRIO: X",
  );
  assert.deepEqual([nestaCidade?.logradouro, nestaCidade?.numero, nestaCidade?.complemento], ["Rua Exemplo", "1020", "Apartamento 61, Bloco D"]);
}

{
  // Garantia sem baixa depois → ativa; cancelada depois → baixada; nova depois da baixa → ativa de novo.
  const garantia = "R.2 - ALIENAÇÃO FIDUCIÁRIA: o imóvel foi alienado fiduciariamente ao Banco Fictício S.A."
  const baixa =
    "AV.3 - CANCELAMENTO DE PROPRIEDADE FIDUCIÁRIA: fica cancelado o registro, por quitação. " +
    "Protocolo nº 1.234, de 02 de fevereiro de 2020. Emolumentos conforme tabela. O Escrevente Autorizado."
  const nova = "R.5 - ALIENAÇÃO FIDUCIÁRIA ao Banco Exemplo S.A., credor fiduciário."
  assert.equal(analisarMatricula(garantia).garantiaAtiva, true)
  assert.equal(analisarMatricula(`${garantia} ${baixa}`).garantiaAtiva, false)
  assert.equal(analisarMatricula(`${garantia} ${baixa}`).garantiaBaixada, true)
  assert.equal(analisarMatricula(`${garantia} ${baixa} ${nova}`).garantiaAtiva, true)
  assert.equal(analisarMatricula("IMÓVEL: casa. PROPRIETÁRIO: X").garantiaAtiva, false)
}

// ---------------------------------------------------------------------------
// Empresa: CND federal, CRF, Junta Comercial, contrato social

const CNPJ = "11.222.333/0001-81";
const CPF = "529.982.247-25";

// CND federal de empresa: CNPJ e razão social; sem endereço.
assert.deepEqual(
  extrairEmpresa(`CERTIDÃO POSITIVA COM EFEITOS DE NEGATIVA DE DÉBITOS RELATIVOS AOS TRIBUTOS FEDERAIS\nNome: EMPRESA EXEMPLO PARTICIPACOES LTDA CNPJ: ${CNPJ} Ressalvado o direito`, "cnd_federal"),
  { cnpj: "11222333000181", razaoSocial: "EMPRESA EXEMPLO PARTICIPACOES LTDA" },
);

// CND federal de pessoa física: nada de empresa.
assert.deepEqual(extrairEmpresa(`Nome: FULANO DE TAL CPF: ${CPF} Ressalvado o direito`, "cnd_federal"), {});

// CRF: o OCR quebra "Razão social:" em volta do nome.
assert.deepEqual(
  extrairEmpresa(`Consulta Regularidade do Empregador\n${CNPJ}\nRazão\nEMPRESA EXEMPLO LTDA\nsocial:\nR EXEMPLO 10 / CENTRO / SANTOS / SP / 11010-000`, "crf_fgts"),
  { cnpj: "11222333000181", razaoSocial: "EMPRESA EXEMPLO LTDA", cepSede: "11010000" },
);

// Certidão simplificada da Junta: a sede e o administrador, com o CPF dele.
assert.deepEqual(
  extrairEmpresa(
    `CERTIDÃO SIMPLIFICADA NOME COMERCIAL EMPRESA EXEMPLO LTDA TITULO DE ESTABELECIMENTO C.N.P.J. ENDEREÇO NÚMERO ${CNPJ} RUA EXEMPLO 10 BAIRRO CENTRO SANTOS SP 11010-000 SÓCIO E ADMINISTRADOR NOME MARIA EXEMPLO SOUZA ENDEREÇO RUA EXEMPLO 10 CPF CARGO QUANTIDADE COTAS ${CPF} SÓCIO E ADMINISTRADOR`,
    "certidao_junta_comercial",
  ),
  {
    cnpj: "11222333000181",
    razaoSocial: "EMPRESA EXEMPLO LTDA",
    cepSede: "11010000",
    representanteNome: "MARIA EXEMPLO SOUZA",
    representanteCpf: "52998224725",
  },
);

// Contrato: a sede da cláusula "terá sede e foro" (não a da sócia que vem antes) e quem representa.
assert.deepEqual(
  extrairEmpresa(
    `EMPRESA SOCIA LTDA, com sede na Rua Outra, nº 5, CEP 01001-000, neste ato representada por seu administrador, Sr. JOAO EXEMPLO LIMA, brasileiro, inscrito no CPF/MF sob nº ${CPF}. CLÁUSULA 2ª — A Sociedade terá sede e foro na Rua Exemplo, nº 10, Centro, Santos — SP — CEP 11010-000.`,
    "contrato_social",
  ),
  { cepSede: "11010000", representanteNome: "JOAO EXEMPLO LIMA", representanteCpf: "52998224725" },
);

// Contrato assinado: "NOME (Sócio-Administrador)".
assert.equal(
  extrairEmpresa(`MARIA EXEMPLO SOUZA, brasileira, CPF ${CPF}. ... MARIA EXEMPLO SOUZA (Sócio-Administrador)`, "contrato_social").representanteNome,
  "MARIA EXEMPLO SOUZA",
);


// ---------------------------------------------------------------------------
// extrairDados: o tipo liga os extratores e devolve campos com rótulo

const campo = (dados: ReturnType<typeof extrairDados>, rotulo: string) => dados.campos.find((c) => c.rotulo === rotulo)

{
  // Nome do titular pelo rótulo, com acento preservado e partículas em minúscula.
  assert.equal(extrairNomeTitular("2 e 1 NOME E SOBRENOME\nJOÃO DA SILVA SAURO\n3 DATA, LOCAL"), "João da Silva Sauro")
  assert.equal(extrairNomeTitular("REPÚBLICA FEDERATIVA DO BRASIL"), undefined)

  const cnh = extrairDados(
    "cnh",
    "CARTEIRA NACIONAL DE HABILITAÇÃO\nNOME\nFULANA DE TAL SOUZA\nCPF 529.982.247-25\n5 Nº REGISTRO 12345678900 9 CAT HAB AB\nDEPARTAMENTO ESTADUAL DE TRÂNSITO\nLOCAL SAO PAULO, SP",
  )
  assert.equal(campo(cnh, "Nome")?.valor, "Fulana de Tal Souza")
  assert.deepEqual(campo(cnh, "CPF"), { rotulo: "CPF", valor: "529.982.247-25", conferido: true })
  assert.equal(campo(cnh, "Nº do registro da CNH")?.valor, "12345678900")
  assert.equal(campo(cnh, "Órgão emissor")?.valor, "DETRAN/SP")
}

{
  const matricula = extrairDados(
    "matricula_imovel",
    "REGISTRO DE IMÓVEIS DA COMARCA DE SANTOS. MATRÍCULA Nº 12.345. IMÓVEL: casa, situada na Rua Exemplo, nº 55, bairro Centro, " +
      "no município de Santos. R.2 - ALIENAÇÃO FIDUCIÁRIA ao Banco Fictício S.A.",
  )
  assert.equal(campo(matricula, "Nº da matrícula")?.valor, "12.345")
  assert.equal(campo(matricula, "Endereço do imóvel")?.valor, "Rua Exemplo, 55 — Centro")
  assert.equal(campo(matricula, "Garantia (alienação/hipoteca)")?.alerta, true)
  assert.equal(campo(matricula, "Cidade (pelo texto)")?.valor, "Santos")
  assert.equal(matricula.mencoesCidade?.[0]?.origem, "descricao")
}

{
  // Comprovante: o CEP de quem mora é o que vem logo depois do nome do titular, não o da empresa (depois do CNPJ).
  const conta =
    "COMPANHIA FICTÍCIA DE ENERGIA S.A. CNPJ 11.222.333/0001-81 Av. Central, 1000 - CEP 01001-000 - São Paulo - SP " +
    "NOTA FISCAL MARIA EXEMPLO DA SILVA RUA DAS FLORES 120 - CEP 11060-001 - SANTOS - SP Vencimento: 15/11/2026"
  assert.deepEqual(titularDoComprovante(conta), { nome: "Maria Exemplo da Silva", cep: "11060001" })
  assert.equal(campo(extrairDados("comprovante_residencia", conta), "CEP de quem mora")?.valor, "11060-001")
}

{
  // Tipo sem extrator próprio: CPF, CNPJ e cidade citados.
  const outro = extrairDados("outro", "Fulano, CPF 529.982.247-25, empresa 11.222.333/0001-81, Santos - SP")
  assert.ok(campo(outro, "CPF citado")?.conferido)
  assert.ok(campo(outro, "CNPJ citado")?.conferido)
  // Sem texto, sem campos.
  assert.deepEqual(extrairDados("cnh", "  ").campos, [])
}

console.log("extração: ok")
