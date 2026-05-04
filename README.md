# Verificador Decreto nº 10.278/2020 com veraPDF

Protótipo com frontend HTML e backend Node.js para validação efetiva de PDF/A por veraPDF.

## O que muda nesta versão

A página não aprova PDF/A apenas por presença de metadados `pdfaid`. Para documento textual, ela tenta enviar o PDF ao endpoint `/api/validate-pdfa`. O backend executa o veraPDF CLI, interpreta o relatório XML e devolve o resultado ao navegador.

Sem o backend ativo, o relatório informa que a validação PDF/A está indisponível e não trata o arquivo como validado.

## Requisitos

- Node.js 18 ou superior.
- veraPDF CLI instalado no servidor e disponível no PATH como `verapdf`.

## Instalação

```bash
npm install
npm start
```

Acesse:

```bash
http://localhost:3000
```

## Configuração opcional

```bash
PORT=3000
VERAPDF_BIN=verapdf
MAX_FILE_SIZE=52428800
VERAPDF_TIMEOUT=120000
npm start
```

Se o comando `verapdf` não estiver no PATH, informe o caminho completo:

```bash
VERAPDF_BIN=/opt/verapdf/verapdf npm start
```

## Endpoint

`POST /api/validate-pdfa`

Campo do formulário:

`file`

Retorno resumido:

```json
{
  "engine": "veraPDF",
  "available": true,
  "executed": true,
  "isCompliant": true,
  "profileName": "PDF/A-1b validation profile",
  "passedRules": 102,
  "failedRules": 0,
  "passedChecks": 504,
  "failedChecks": 0
}
```

## Produção

Para uso real, incluir HTTPS, autenticação ou rate limit, antivírus, logs mínimos, exclusão automática, isolamento do processo e política de privacidade. O protótipo já exclui o arquivo temporário após a validação.
