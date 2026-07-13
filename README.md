# Barba Duck - API do plano personalizado

API intermediaria para receber o formulario da landing page e enviar a solicitacao ao WhatsApp por meio do WAHA.

## Arquitetura

Landing page -> API publica -> WAHA pela rede privada do Railway -> WhatsApp

A landing page nunca recebe a chave do WAHA. O WAHA pode ficar sem dominio publico depois da leitura do QR Code.

## 1. Criar o projeto no Railway

Crie um projeto chamado `barbaduck-whatsapp`.

## 2. Criar o servico WAHA

No projeto, adicione um servico usando a imagem Docker:

```text
devlikeapro/waha
```

Nomeie o servico exatamente como:

```text
waha
```

Adicione estas variaveis ao servico WAHA:

```text
WHATSAPP_API_PORT=3000
WHATSAPP_DEFAULT_ENGINE=NOWEB
WAHA_API_KEY=<CHAVE_FORTE>
WAHA_DASHBOARD_ENABLED=true
WAHA_DASHBOARD_USERNAME=<USUARIO_FORTE>
WAHA_DASHBOARD_PASSWORD=<SENHA_FORTE>
WAHA_WORKER_RESTART_SESSIONS=true
```

Adicione um volume persistente montado em:

```text
/app/.sessions
```

Gere temporariamente um dominio publico para o WAHA, abra o Dashboard, crie/inicie a sessao `default` e leia o QR Code. Depois de confirmar que a sessao esta conectada, remova o dominio publico do WAHA. A API continuara acessando o WAHA por:

```text
http://waha.railway.internal:3000
```

## 3. Publicar esta API

Envie esta pasta para um repositorio GitHub. No mesmo projeto Railway, escolha `New -> GitHub Repo` e selecione o repositorio.

Configure no servico da API:

```text
WAHA_URL=http://waha.railway.internal:3000
WAHA_API_KEY=<A_MESMA_CHAVE_DO_WAHA>
WAHA_SESSION=default
WHATSAPP_DESTINATION=55DDDNUMERO
ALLOWED_ORIGINS=https://barbaduck.com.br,https://www.barbaduck.com.br
```

Nao e necessario cadastrar `PORT`; o Railway fornece essa variavel.

Em `Settings -> Networking -> Public Networking`, clique em `Generate Domain` para a API.

A URL final do formulario sera semelhante a:

```text
https://barbaduck-api-production.up.railway.app/api/plano-personalizado
```

## 4. Atualizar a landing page

No HTML da landing page, altere:

```js
const PERSONALIZED_PLAN_API_URL = 'COLE_AQUI_A_URL_DA_API';
```

para:

```js
const PERSONALIZED_PLAN_API_URL = 'https://SEU-DOMINIO-DA-API/api/plano-personalizado';
```

Publique novamente a landing page.

## 5. Testes

### Testar a API

```bash
curl -X POST "https://SEU-DOMINIO-DA-API/api/plano-personalizado" \
  -H "Content-Type: application/json" \
  -H "Origin: https://barbaduck.com.br" \
  -d '{
    "tipo": "solicitacao_plano_personalizado",
    "origem": "Landing Page Barba Duck",
    "nome": "Cliente Teste",
    "whatsapp": "(27) 99999-9999",
    "conhecimentoClube": "Sim, já conheço",
    "frequencia": "2 vezes por mês",
    "diasPreferencia": "Não tenho preferência",
    "tipoPlano": "Cabelo + barba",
    "relacaoBarbearia": "Já conheço a barbearia",
    "consentimento": true,
    "pagina": "https://barbaduck.com.br/",
    "enviadoEm": "2026-07-13T12:00:00.000Z"
  }'
```

### Verificar saude

```text
GET /health
GET /health/waha
```

## Seguranca implementada

- CORS limitado ao dominio da Barba Duck.
- Chave do WAHA apenas nas variaveis do Railway.
- Limite de seis envios por IP a cada quinze minutos.
- Validacao fechada das respostas do formulario.
- Honeypot contra bots.
- Limite de 20 KB por requisicao.
- Timeout na comunicacao com o WAHA.
- Logs sem exibir o telefone completo do cliente.

## Operacao 24 horas

Mantenha o servico da API e o WAHA como servicos persistentes, sem modo serverless. O volume do WAHA deve permanecer anexado em `/app/.sessions` para preservar o login do WhatsApp.
