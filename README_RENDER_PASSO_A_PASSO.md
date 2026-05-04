# Publicação no Render

Este pacote já contém Dockerfile e render.yaml.

## Arquivos importantes

- `public/index.html`: página da ferramenta.
- `server.js`: backend Node.js que recebe o PDF e chama o veraPDF.
- `package.json`: dependências do backend.
- `Dockerfile`: cria o ambiente com Node.js e veraPDF.
- `render.yaml`: configuração opcional para o Render.

## Configuração recomendada no Render

- New: Web Service
- Build and deploy from: Git repository
- Language: Docker
- Branch: main
- Dockerfile Path: ./Dockerfile
- Plan: Free para teste

## Variáveis de ambiente

- NODE_ENV = production
- PORT = 3000
- VERAPDF_BIN = /opt/verapdf/verapdf
- MAX_FILE_SIZE = 52428800
- VERAPDF_TIMEOUT = 120000

## Teste após publicação

1. Abra a URL gerada pelo Render.
2. Acesse `/api/health` na mesma URL.
3. Se aparecer JSON com `ok: true`, o backend está ativo.
4. Volte para a página inicial e envie um PDF.

## Observação

O plano gratuito pode ficar inativo após período sem uso. Para uso profissional, considere plano pago ou servidor próprio.
