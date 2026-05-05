# Bot de Comprovantes de PIX

Bot Telegram que gera recibos de vale automaticamente a partir de comprovantes PIX. O usuário envia a foto ou PDF do comprovante, a IA extrai os dados e o bot devolve um PDF do recibo pronto para imprimir.

## Como funciona

1. O usuário envia a foto ou PDF do comprovante PIX no Telegram
2. O Google Gemini Vision lê o comprovante e extrai valor, data, nome do beneficiário e dados bancários
3. O bot identifica o funcionário no cadastro e solicita o tipo de vale
4. Um PDF do recibo é gerado via Puppeteer e enviado de volta no chat

Também é possível emitir recibos de pagamentos feitos em dinheiro, sem comprovante PIX.

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) e Docker Compose
- Token de um bot Telegram (obtido no [@BotFather](https://t.me/BotFather))
- Chave de API do Google Gemini ([aistudio.google.com](https://aistudio.google.com/app/apikey))
- Seu User ID do Telegram (use o [@userinfobot](https://t.me/userinfobot) para descobrir)

## Instalação e execução

```bash
# 1. Clone o repositório
git clone <url-do-repositorio>
cd "Projeto - Comprovantes de Pix"

# 2. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com seus valores

# 3. Suba o container
docker compose up -d --build
```

### Variáveis de ambiente (`.env`)

| Variável | Descrição |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token do bot obtido no @BotFather |
| `GEMINI_API_KEY` | Chave da API do Google Gemini |
| `ALLOWED_USER_IDS` | IDs Telegram autorizados, separados por vírgula |

## Comandos disponíveis

| Comando | Descrição |
|---|---|
| `/start` | Exibe a lista de comandos |
| `/empresa` | Cadastra ou atualiza os dados da empresa |
| `/novo_recibo` | Emite recibo de pagamento em dinheiro (sem PIX) |
| `/colaboradores` | Gerencia o cadastro de funcionários |
| `/historico [N]` | Lista os últimos N recibos (padrão: 10, máx: 50) |
| `/buscar Nome` | Busca recibos pelo nome do funcionário |
| `/recibo NUMERO` | Baixa novamente o PDF de um recibo pelo número |
| `/extrato` | Gera extrato mensal em PDF de um funcionário |
| `/fechamento` | Calcula saldo e emite recibos de salário do mês |
| `/editar_recibo NUMERO` | Edita e re-emite um recibo (ex: `/editar_recibo 202604-001`) |
| `/cancelar_recibo NUMERO` | Marca um recibo como cancelado |
| `/cancelar` | Cancela a operação em andamento |

## Tipos de vale suportados

- Vale Alimentação
- Vale Transporte
- Vale Refeição
- Vale Combustível
- Férias (com período aquisitivo e de gozo)
- 13º Salário (com parcela e ano de referência)
- Adiantamento Salarial
- Outro (texto livre)

## Banco de dados

O bot usa SQLite via `sql.js`. O arquivo `db/data.sqlite` é persistido em disco e montado como volume no Docker, garantindo que os dados sobrevivam ao reinício do container.

## Estrutura do projeto

```
.
├── src/
│   ├── ai/
│   │   └── extractor.js        # Extração de dados via Google Gemini Vision
│   ├── bot/
│   │   ├── handlers.js         # Comandos e fluxos de conversa do Telegram
│   │   └── conversations.js    # Gerenciamento de estado por usuário
│   ├── database/
│   │   ├── db.js               # Inicialização e helpers do SQLite
│   │   ├── company.js          # CRUD de dados da empresa
│   │   ├── employees.js        # CRUD de funcionários
│   │   └── receipts.js         # CRUD de recibos
│   └── pdf/
│       ├── generator.js        # Geração de PDF com Puppeteer
│       ├── template.js         # Template HTML do recibo de vale
│       └── statement_template.js # Template HTML do extrato mensal
├── db/                         # Banco de dados SQLite (gerado em runtime)
├── temp/                       # Arquivos temporários de imagem e PDF (limpos após uso)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Observações

- Imagens suportadas: JPG, PNG, WEBP e PDF
- O bot processa um comprovante por vez por usuário; para recomeçar use `/cancelar`
- Recibos cancelados não são apagados do banco — ficam marcados como cancelados no histórico e no extrato
- A extração da IA tenta até 3 vezes em caso de erro 503 ou 429 (backoff exponencial)
