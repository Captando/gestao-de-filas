# Gestao de Filas

Sistema integrado de gestao de filas e atendimento para servicos publicos e grandes instituicoes. Vai alem de "chamar senhas" — resolve gargalos reais da operacao, reduz atrito para o cidadao, alivia a carga dos atendentes e entrega dados confiaveis para a gestao.

> **Projeto original:** [iuryroque/gestao-de-filas](https://github.com/iuryroque/gestao-de-filas)
> **Fork mantido por:** [Captando](https://github.com/Captando/gestao-de-filas)

---

## Arquitetura

```
┌─────────────┐       ┌──────────────────┐       ┌──────────────┐
│  Totem       │──────▶│  Backend (API)   │◀─────▶│  PostgreSQL  │
│  (HTML)      │  HTTP │  Express + WS    │       │  15-alpine   │
└─────────────┘       └──────┬───────────┘       └──────────────┘
                             │ WebSocket
┌─────────────┐              │
│  Guiche      │◀────────────┤
│  (HTML)      │             │
└─────────────┘              │
┌─────────────┐              │
│  Painel TV   │◀────────────┤
│  (HTML)      │             │
└─────────────┘              │
┌─────────────┐              │
│  CSAT        │─────────────┘
│  (HTML)      │  HTTP
└─────────────┘
```

- **Backend:** Node.js 18 + Express + WebSocket (`ws`) — API REST com broadcast em tempo real
- **Banco de Dados:** PostgreSQL 15 (producao) / SQLite (desenvolvimento local)
- **Prototipos:** HTML/CSS/JS puro servido via Nginx — sem framework frontend
- **Containerizacao:** Docker Compose com 3 servicos (db, backend, prototypes)

---

## Funcionalidades

### Jornada do Cidadao (Totem)
- Emissao de senha com selecao de servico (Cobranca, Documentos, Atendimento Geral, Suporte Tecnico)
- Filas separadas por servico — cada servico tem sua propria fila
- Atendimento prioritario (Idoso, PCD, Gestante) com ordenacao automatica
- Tela de confirmacao com tipo de atendimento e tempo estimado
- Impressao automatica via WebUSB ESC/POS para impressoras termicas
- Pareamento USB unico com auto-reconexao

### Operacao do Atendente (Guiche)
- Chamar proximo de TODAS as filas — prioridade primeiro, depois ordem de chegada
- Iniciar / Finalizar atendimento com controle de tempo real
- Transferencia de ticket entre filas via modal com chamada a API
- Marcacao de no-show com registro no backend
- Historico de senhas atendidas com recall (clicar para rechamar)
- Contador de tempo de espera em tempo real
- Badge de prioridade no ticket em atendimento
- Atualizacoes via WebSocket — sem polling

### Painel de Chamada (TV)
- Tela fullscreen para monitor/TV na sala de espera
- Mostra as ultimas 5 senhas chamadas com guiche
- Destaque visual na chamada mais recente
- Aviso sonoro automatico (Web Audio API) a cada nova chamada
- Contagem de aguardando por servico em tempo real
- Atualizado via WebSocket — sem refresh

### Avaliacao de Satisfacao (CSAT)
- Formulario pos-atendimento com escala 1-5
- Labels: Pessimo, Ruim, Regular, Bom, Otimo
- Campo de comentario opcional
- Opcao de pular a avaliacao
- Redirect automatico para o totem apos envio
- Acessado via `csat.html?ticketId=xxx`

### Metricas e Qualidade
- Estatisticas por fila e agregadas (todas as filas)
- Tempo Medio de Espera (TME) calculado automaticamente
- CSAT por ticket com escala 1-5 e comentarios
- NPS calculado por servico (minimo 10 respostas)
- Deteccao automatica de linguagem ofensiva em comentarios
- Filtros por atendente, servico e periodo

---

## Stack Tecnica

| Camada | Tecnologia |
|---|---|
| API | Express 4.18 + cors |
| Tempo real | ws 8.13 (WebSocket nativo) |
| Banco (prod) | PostgreSQL 15 via `pg` |
| Banco (dev) | SQLite via `better-sqlite3` |
| Prototipos | HTML/CSS/JS vanilla |
| Servidor web | Nginx Alpine |
| Container | Docker + Docker Compose |
| Testes | Jest + Supertest |

---

## Inicio Rapido

### Com Docker (recomendado)

```bash
git clone git@github.com:Captando/gestao-de-filas.git
cd gestao-de-filas
docker compose up --build -d
```

| Servico | URL |
|---|---|
| Totem (cidadao) | http://localhost:8080/totem.html |
| Guiche (atendente) | http://localhost:8080/guiche.html |
| Painel TV (sala de espera) | http://localhost:8080/painel.html |
| CSAT (avaliacao) | http://localhost:8080/csat.html?ticketId=xxx |
| API Backend | http://localhost:3000 |
| PostgreSQL | localhost:5432 |

### Sem Docker (desenvolvimento local)

```bash
cd backend
npm install
npm run dev        # SQLite — porta 3000
```

Para usar PostgreSQL local:

```bash
DB_CLIENT=pg DATABASE_URL=postgres://user:pass@localhost:5432/gestao_filas npm start
```

Os prototipos podem ser abertos diretamente no navegador ou servidos com qualquer servidor HTTP:

```bash
npx serve prototypes -l 8080
```

---

## API Endpoints

### Geral

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/` | Health check — retorna `{ service, status }` |

### Tickets

| Metodo | Rota | Descricao |
|---|---|---|
| `POST` | `/tickets` | Emitir nova senha (`{ queueId, meta }`) |
| `GET` | `/tickets` | Listar tickets (`?queueId=&status=`) |
| `POST` | `/tickets/:id/call` | Chamar senha (`{ guiche }`) |
| `POST` | `/tickets/:id/attend` | Iniciar atendimento (`{ attendant }`) |
| `POST` | `/tickets/:id/finalize` | Finalizar (`{ result }`) |
| `POST` | `/tickets/:id/transfer` | Transferir fila (`{ toQueueId, reason }`) |
| `POST` | `/tickets/:id/noshow` | Marcar no-show (`{ reason }`) |

### Filas

| Metodo | Rota | Descricao |
|---|---|---|
| `GET` | `/queues/all/stats` | Stats agregados de todas as filas (`{ waiting, called, attending }`) |
| `GET` | `/queues/:id/stats` | Estatisticas da fila (contagem, TME) |

### CSAT / NPS

| Metodo | Rota | Descricao |
|---|---|---|
| `POST` | `/tickets/:id/csat` | Submeter avaliacao (`{ rating, comment, skipped }`) |
| `GET` | `/csat/stats` | Estatisticas CSAT (`?attendant=&serviceId=&from=&to=`) |
| `GET` | `/csat/nps` | NPS por servico (`?serviceId=&from=&to=`) |

### WebSocket

Conectar em `ws://localhost:3000`. Eventos broadcast:

- `ticket.created` — nova senha emitida
- `ticket.called` — senha chamada no guiche
- `ticket.attending` — atendimento iniciado
- `ticket.finalized` — atendimento finalizado
- `ticket.noshow` — no-show registrado
- `ticket.transferred` — ticket transferido de fila

---

## Ciclo de Vida do Ticket

```
waiting ──▶ called ──▶ attending ──▶ finalized
              │                         │
              └──▶ noshow               └──▶ CSAT (opcional)
              │
              └──▶ transferred (volta para waiting em outra fila)
```

---

## Estrutura do Projeto

```
gestao-de-filas/
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── migrations/          # Scripts SQL (PostgreSQL)
│   ├── src/
│   │   ├── index.js         # Express + WebSocket server
│   │   ├── store.js         # Adapter: seleciona db.js ou db-pg.js
│   │   ├── db.js            # Implementacao SQLite
│   │   └── db-pg.js         # Implementacao PostgreSQL
│   └── test/                # Testes Jest
├── prototypes/
│   ├── totem.html           # Interface do cidadao (totem touch)
│   ├── guiche.html          # Interface do atendente
│   ├── painel.html          # Painel de chamada (TV sala de espera)
│   ├── csat.html            # Formulario de avaliacao pos-atendimento
│   ├── style.css            # Estilos compartilhados
│   └── nginx.conf           # Config Nginx para servir prototipos
├── docs/                    # User Stories, UX flows, Sprint Plan
├── docker-compose.yml       # Orquestracao: db + backend + prototypes
└── README.md
```

---

## Variáveis de Ambiente

| Variavel | Padrao | Descricao |
|---|---|---|
| `PORT` | `3000` | Porta do backend |
| `DB_CLIENT` | _(vazio = SQLite)_ | Usar `pg` para PostgreSQL |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/gestao_filas` | Connection string PostgreSQL |

---

## Testes

```bash
cd backend
npm test
```

Os testes rodam com SQLite in-memory por padrao (sem necessidade de PostgreSQL).

---

## Contribuidores

- **iuryroque** — autor original
- **Captando** — contribuicoes e melhorias (Docker, correcoes PostgreSQL, UI/UX)

---

## Licenca

Consulte o repositorio original para informacoes de licenca.
