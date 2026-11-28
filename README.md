# Biblioteca — evolução SaaS, fase 02

Tópicos Especiais em Engenharia de Software II · Ifes 2026.2

A branch `saas-evolution/fase02` parte da `saas-evolution/fase01`, que implementou a
[aula de PostgreSQL, Docker e React](.docs/saas-evolution/saas-fase01.html)
e os 23 casos de uso da turma. O monólito modular usa PostgreSQL 18 e uma
interface React 19 com acervo, autores, leitores, exemplares, reservas e empréstimos.

## Atividade #152 — índice semântico com pgvector

O índice da UC24 passa a usar PostgreSQL com pgvector, preservando a API
`GET /api/busca-semantica/livros?q=` e a tela `/livros/semantica`.
O Redis continua atendendo o cache de autores.

O `bookIndex.ts` existente cria `livros_vetores` com `vector(N)`, chave estrangeira
com `ON DELETE CASCADE` e índice HNSW para distância cosseno. A tabela
`acervo_modelo_vetorial` identifica o modelo e a dimensão; trocar qualquer um
recria os vetores e reindexa os livros. Cadastro, edição e renomeação de autor
sincronizam depois do COMMIT. Texto igual não chama o embedder novamente, e uma
falha do provedor não desfaz o cadastro. A subida e o seed reconciliam os dados
independentemente do Redis. Os testes próprios ficam em `book-vectors.test.ts`.

Para executar, crie ou edite `infra/.env` com `GEMINI_API_KEY=sua-chave` e rode:

```bash
docker compose -f infra/compose.yaml up -d --build
```

O Compose passa a usar `pgvector/pgvector:pg18`, preservando o volume `pgdata`.
A aplicação cria a extensão automaticamente em cada banco. Abra
<http://localhost:3000/livros/seed> para a carga inicial e depois
<http://localhost:3000/livros/semantica>. Aguarde a reconciliação nos logs de `app`.
Para demonstrar a independência do Redis, pare-o com
`docker compose -f infra/compose.yaml stop redis` e repita a busca; depois use
`docker compose -f infra/compose.yaml start redis`.

Se houver um índice legado no Redis, confira com `redis-cli FT._LIST` dentro do
contêiner. Remova `biblioteca:acervo:livros` com `FT.DROPINDEX biblioteca:acervo:livros DD`
e sua chave de modelo com `DEL biblioteca:acervo:livros:modelo`.

Para inspecionar o armazenamento, abra o `psql` com
`docker compose -f infra/compose.yaml exec db psql -U biblioteca -d biblioteca`:

```sql
\dx
\d livros_vetores
TABLE acervo_modelo_vetorial;
SELECT livro_id, texto, vector_dims(embedding) FROM livros_vetores LIMIT 5;
```

Discussão do enunciado:

1. **Redis ou pgvector:** pgvector permite FK, CASCADE, JOIN e backup conjunto,
   além de persistir os vetores após reinícios do Redis. Em contrapartida, busca
   vetorial disputa memória, disco e CPU com o banco principal. Uma separação
   deve ser decidida por medições de tráfego, latência e volume do acervo.
2. **Depois do COMMIT:** chamadas ao Gemini dentro da transação segurariam o lock
   das escritas e uma falha poderia desfazer o cadastro. Uma outbox transacional
   com worker e retentativas pode tornar a atualização eventual durável.
3. **Reconexão do Redis:** invalida somente o cache de autores. A reconciliação
   dos vetores acontece na subida e depois do seed, sem depender da conexão.
4. **HNSW:** com 50 livros a busca exata é barata; com milhões, aproximação reduz
   o custo. Aumentar `hnsw.ef_search` aumenta os candidatos e tende a melhorar o
   recall, com maior latência. O ajuste deve ser medido com consultas reais.
5. **Disponibilidade:** no PostgreSQL, a integração pode combinar vetores e
   exemplares com `EXISTS`, excluindo empréstimos abertos e reservas vigentes.
   No Redis seria preciso replicar disponibilidade ou filtrar candidatos usando
   o PostgreSQL. No HNSW, filtros podem exigir mais candidatos ou busca iterativa.

O PR da atividade deve ter `saas-evolution/fase02` como base.

## Executar a aplicação

Com Docker Desktop aberto, na raiz do projeto:

```bash
docker compose -f infra/compose.yaml up -d --build
```

Abra <http://localhost:3000>. O `infra/Dockerfile` compila o frontend, e o backend serve
a interface e a API no mesmo endereço. O PostgreSQL atende somente na rede do
Compose, sem publicar a porta 5432. Os dados ficam no volume `pgdata`.

Para parar e preservar os dados:

```bash
docker compose -f infra/compose.yaml down
```

## Testes e verificações

Na primeira execução, crie o banco exclusivo da suíte, com o serviço `db` no ar:

```bash
docker compose -f infra/compose.yaml exec db createdb -U biblioteca biblioteca_test
```

Execute a suíte completa dentro da rede do Docker:

```bash
docker compose -f infra/compose.yaml run --rm --build test
```

Os testes de integração usam `biblioteca_test`; a aplicação usa `biblioteca`.
Se remover o volume com `docker compose -f infra/compose.yaml down -v`, crie novamente o banco de testes.

As verificações que dispensam PostgreSQL podem rodar localmente com Bun 1.4 ou
mais novo. Em `backend/`:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run check-boundaries
bun test src/modules/catalog/domain
```

## Desenvolver o frontend

Mantenha a aplicação no Docker. Em `frontend/`:

```bash
bun install --frozen-lockfile
bun run dev
```

Abra <http://localhost:5173>. O proxy do Vite encaminha `/api` para a aplicação
na porta 3000. O menu agrupa as páginas por área:

| Área | Páginas |
|---|---|
| Livros | `/livros`, `/livros/cadastrar`, `/livros/editar`, `/livros/excluir`, `/livros/seed` |
| Autores | `/autores`, `/autores/cadastrar`, `/autores/editar`, `/autores/excluir` |
| Leitores | `/leitores`, `/leitores/cadastrar`, `/leitores/editar`, `/leitores/excluir` |
| Exemplares | `/exemplares`, `/exemplares/cadastrar`, `/exemplares/editar`, `/exemplares/excluir` |
| Reservas | `/reservas`, `/reservas/criar`, `/reservas/cancelar` |
| Empréstimos | `/emprestimos`, `/emprestimos/registrar`, `/emprestimos/devolver` |

Os endereços antigos `/` e `/cadastrar` redirecionam para `/livros` e
`/livros/cadastrar`.

Para validar o frontend:

```bash
bun run lint
bun run build
```

Após alterações no backend, recrie o serviço com
`docker compose -f infra/compose.yaml up -d --build app`. Para atualizar também a interface servida
pela porta 3000, refaça esse build depois de alterar o frontend.

## API e carga inicial

Todas as rotas ficam sob `/api`; `GET /api` identifica a API.

| Recurso | Consultar | Cadastrar ou agir | Atualizar | Excluir |
|---|---|---|---|---|
| Livros | `GET /livros?q=`, `GET /livros/id/:id` | `POST /livros` | `PUT /livros/:id` | `DELETE /livros/:id` |
| Autores | `GET /autores?q=`, `GET /autores/:id` | `POST /autores` | `PUT /autores/:id` | `DELETE /autores/:id` |
| Leitores | `GET /leitores?q=`, `GET /leitores/:id` | `POST /leitores` | `PUT /leitores/:id` | `DELETE /leitores/:id` |
| Exemplares | `GET /exemplares?q=&livroId=&situacao=`, `GET /exemplares/:id` | `POST /exemplares` | `PUT /exemplares/:id` | `DELETE /exemplares/:id` |
| Reservas | `GET /reservas?leitorId=&exemplarId=&situacao=`, `GET /reservas/:id` | `POST /reservas`, `POST /reservas/:id/cancelamento` | — | — |
| Empréstimos | `GET /emprestimos?leitorId=&exemplarId=&situacao=`, `GET /emprestimos/:id` | `POST /emprestimos`, `POST /emprestimos/:id/devolucao` | — | — |
| Seed | `GET /seed` | `POST /seed` | — | — |

A busca legada `GET /api/livros/:q` continua disponível. O cadastro de livro
recebe `isbn`, `titulo` e `autorId`; o de exemplar recebe `livroId`, `localizacao`
e `estadoConservacao`. Os autores da carga inicial são 1 — Eric Evans,
2 — Robert C. Martin, 3 — Harper Lee e 4 — Jane Austen.

## Estrutura e tutorial original

- `backend/`: aplicação Bun/Hono, organizada como monólito modular com fatias verticais (detalhes abaixo).
- `frontend/`: React, React Router, Vite e CSS.
- `infra/`: Compose, Dockerfile e `Dockerfile.dockerignore`.
- `.docs/saas-evolution/`: aulas da evolução SaaS.

O tutorial original do monólito modular está nas branches
`modular-monolith/fase01` a `modular-monolith/fase53`.

O Compose usa a raiz do repositório como contexto de build para incluir
`backend/` e `frontend/`. O ignore específico `infra/Dockerfile.dockerignore`
filtra esse contexto. O nome do projeto continua sendo `biblioteca-tutorial`.

## Casos de uso da fase 01

Os 23 casos de uso foram implementados pela turma em `saas-evolution/fase01`.
Os tutoriais, o painel de andamento e o script de preparação das atividades
continuam disponíveis nessa branch, em `.docs/use-cases/`.

Cada caso é uma fatia dentro do seu módulo, tanto no backend quanto no frontend
(próximas seções), e cada caso de teste cita a UC no título.
Somente `maroquio` pode atualizar ou integrar PRs nas branches centrais.

O UC23 implementa um seed manual e idempotente. Abra
`/livros/seed` ou execute `docker compose -f infra/compose.yaml exec -T app bun src/seed.ts`.
O catálogo tem fontes bibliográficas; os leitores são fictícios.

## Organização do backend

O código do backend (pastas, arquivos e identificadores) está em inglês. Continuam
em português o contrato externo (rotas, query params, campos e valores JSON), o
banco (tabelas, colunas e valores persistidos), as mensagens ao usuário e os comentários.

```
backend/src/
├── main.ts · seed.ts · import-books.ts   pontos de entrada
├── server.ts · composition.ts            app Hono, preparo do banco e descoberta das fatias
├── infrastructure/                       conexão PostgreSQL e transação
├── shared/                               erros, validação, HTTP e datas
├── integration/                          SQL entre módulos e o seed (UC23)
└── modules/<módulo>/
    ├── index.ts                          API pública do módulo
    ├── domain/                           regras, tipos e portas, sem SQL
    ├── infrastructure/                   schema, SQL compartilhado e JSON da API
    └── features/<fatia>/                 route.ts + caso de uso + teste
```

Os módulos são `catalog` (livros e exemplares), `authorship` (autores), `readers`
(leitores) e `circulation` (reservas e empréstimos). O `composition.ts` descobre
cada `features/<fatia>/route.ts`, então adicionar uma fatia não altera nenhum
registro central. `bun run check-boundaries` barra import entre fatias, import de
arquivos internos de outro módulo e SQL em tabela de outro módulo. As mesmas
regras de import valem para o frontend.

Os testes de cada fatia ficam ao lado dela (`<fatia>.test.ts`); `backend/tests/`
guarda o suporte compartilhado (importado como `#tests/...`) e os testes que sobem
a aplicação inteira.

| UC | Fatia | Rotas |
|---|---|---|
| UC01 | `catalog/features/create-book` | `POST /livros` |
| UC02 | `catalog/features/search-books` | `GET /livros?q=`, `GET /livros/id/:id`, `GET /livros/:q` |
| UC03 | `catalog/features/update-book` | `PUT /livros/:id` |
| UC04 | `catalog/features/delete-book` | `DELETE /livros/:id` |
| UC05 | `authorship/features/create-author` | `POST /autores` |
| UC06 | `authorship/features/search-authors` | `GET /autores?q=`, `GET /autores/:id` |
| UC07 | `authorship/features/update-author` | `PUT /autores/:id` |
| UC08 | `authorship/features/delete-author` | `DELETE /autores/:id` |
| UC09 | `readers/features/create-reader` | `POST /leitores` |
| UC10 | `readers/features/search-readers` | `GET /leitores?q=`, `GET /leitores/:id` |
| UC11 | `readers/features/update-reader` | `PUT /leitores/:id` |
| UC12 | `readers/features/delete-reader` | `DELETE /leitores/:id` |
| UC13 | `catalog/features/create-copy` | `POST /exemplares` |
| UC14 | `catalog/features/search-copies` | `GET /exemplares`, `GET /exemplares/:id` |
| UC15 | `catalog/features/update-copy` | `PUT /exemplares/:id` |
| UC16 | `catalog/features/delete-copy` | `DELETE /exemplares/:id` |
| UC17 | `circulation/features/reserve-copy` | `POST /reservas` |
| UC18 | `circulation/features/cancel-reservation` | `POST /reservas/:id/cancelamento` |
| UC19 | `circulation/features/register-loan` | `POST /emprestimos` |
| UC20 | `circulation/features/register-return` | `POST /emprestimos/:id/devolucao` |
| UC21 | `circulation/features/list-loans` | `GET /emprestimos`, `GET /emprestimos/:id` |
| UC22 | `circulation/features/list-reservations` | `GET /reservas`, `GET /reservas/:id` |
| UC23 | `integration/seed` | `GET /seed`, `POST /seed` |

## Organização do frontend

O frontend segue os mesmos módulos e a mesma regra de idioma: código em inglês;
URLs das telas, campos JSON da API, textos da interface e comentários em português.

```
frontend/src/
├── main.tsx · App.tsx · index.css     entrada, casca (menu e rotas) e estilos
├── shared/                            api, formatação, useFetch e componentes de UI
├── integration/seed/page.tsx          tela de dados de exemplo (UC23)
└── modules/<módulo>/
    ├── index.ts                       tipos públicos para os outros módulos
    ├── types.ts                       tipos do JSON da API
    ├── components/                    campos compartilhados entre as telas do módulo
    └── features/<fatia>/page.tsx      uma tela por caso de uso
```

Cada `page.tsx` exporta `{ useCase, title, path, Component }`. O `App.tsx` descobre
as telas por `import.meta.glob`, ordena o menu pela UC e agrupa as atividades pela
área da URL. As fatias têm os mesmos nomes do backend: a tela do UC01 fica em
`modules/catalog/features/create-book/page.tsx`, a do UC17 em
`modules/circulation/features/reserve-copy/page.tsx`.

A importação em lote de livros por CSV continua disponível com
`bun run import-books <arquivo.csv>` (cabeçalho `isbn,titulo,autorId`).
