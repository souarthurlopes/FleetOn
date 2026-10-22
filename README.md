# FleetOn

Controle de frotas baseado no HTML original: veículos, motoristas, viagens,
abastecimentos, manutenção, multas e relatórios. A versão para publicação usa
**Cloudflare Pages + Supabase Auth/PostgreSQL**. O servidor Python/SQLite anterior
continua disponível para desenvolvimento local e migração, com banco preservado.

## Publicar no Cloudflare Pages + Supabase

Os dois serviços oferecem planos gratuitos com limites sujeitos a mudanças.
Confira os limites e eventual pausa por inatividade antes de usar dados reais.
Nenhum serviço foi criado ou publicado automaticamente por este repositório.

### 1. Criar o banco no Supabase

1. Crie um projeto em https://supabase.com/dashboard e guarde a senha do banco
   com segurança; ela não é usada nas telas do FleetOn.
2. Abra **SQL Editor**, copie o conteúdo completo de
   [`supabase/001_fleeton.sql`](supabase/001_fleeton.sql) e execute.
   Depois execute também [`supabase/002_profiles_roles.sql`](supabase/002_profiles_roles.sql)
   para habilitar os perfis e as permissões. As migrações podem ser reaplicadas
   na ordem 001 → 002 sem apagar os dados. Se já executou 001, basta executar 002.
3. Em **Project Settings → API** (ou **API Keys**), copie a **Project URL** e a
   chave **publishable** (`sb_publishable_...`) ou a chave legada **anon**.
   São configurações públicas. Nunca use `service_role`, `sb_secret_...` ou a
   senha do banco no site, no GitHub ou no chat.
4. Em **Authentication → Providers → Email**, habilite o login por e-mail e a
   confirmação de cadastro. Configure a política de senha para pelo menos 10
   caracteres. O envio de e-mails padrão tem limites; configure SMTP próprio
   se o volume exigir.

### 2. Publicar as telas no Cloudflare

Envie o código deste diretório ao seu repositório no GitHub. No painel Cloudflare,
abra **Workers & Pages → Create → Pages → Connect to Git**, conecte o repositório
e configure:

| Campo | Valor |
| --- | --- |
| Framework | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 22 ou superior |
| `FLEETON_SUPABASE_URL` | Project URL, como `https://seuprojeto.supabase.co` |
| `FLEETON_SUPABASE_PUBLISHABLE_KEY` | Chave pública publishable ou anon |

Essas duas variáveis são usadas no build e ficam públicas no JavaScript gerado,
como exige o SDK. Não coloque credenciais administrativas nelas. Configure-as
também em Preview se quiser usar ambientes de preview; prefira um projeto de
dados separado para testes. O Cloudflare hospeda apenas `dist/`; não execute o
servidor Python na hospedagem estática.

Alternativa sem conectar GitHub: configure as variáveis em seu terminal,
execute `npm ci && npm run build` e faça Direct Upload da pasta `dist` no Pages.
Um build sem configuração gera uma tela informando que a conexão está pendente,
sem tentar usar o banco SQLite nem inventar um banco de produção.

### 3. Configurar o endereço de login

Depois do primeiro deploy, copie o endereço HTTPS fornecido pelo Cloudflare:

1. Em Supabase **Authentication → URL Configuration**, coloque o endereço
   publicado em **Site URL** e a URL completa com `/` em **Redirect URLs**.
2. Inclua apenas os endereços de produção/preview que realmente usa.
3. Acesse o FleetOn publicado, crie uma conta e confirme o e-mail. Com o fluxo
   PKCE, abra o link no mesmo navegador que iniciou o cadastro/recuperação.
4. Cadastre um veículo, entre com a mesma conta em outro dispositivo e use
   **Atualizar dados** para verificar que ele aparece.
5. Crie outra conta para confirmar que ela começa com uma frota vazia.
6. Teste **Esqueci minha senha** e o link de recuperação.

A conexão real, o envio de e-mails e o endereço de produção só podem ser
validados depois de existir um projeto configurado. Testes locais simulados não
comprovam que uma instalação remota está funcionando.

## Desenvolvimento e testes

Requisitos: Node.js 22+ e Python 3.12+ para os servidores/testes locais.

```sh
npm ci
npm run build
npm test
npm run dev
```

O build usa as variáveis acima; também é possível preencher os dois campos
públicos em `public/config.js` para testes locais. Para e-mails de teste,
autorize o endereço local de desenvolvimento nas Redirect URLs do Supabase.
Use um projeto separado de produção. Não há segredo de banco no navegador.

```sh
# API Python/SQLite legada e teste funcional correspondente:
python3 -m unittest discover -s tests -v
python3 tests/browser.py
# Novo frontend com SDK real e respostas HTTPS simuladas:
python3 tests/browser_supabase.py
```

Os testes de navegador precisam de Playwright para Python e
`/usr/bin/chromium`, presentes no ambiente preparado. Eles usam bancos
ou respostas temporárias. `npm test` executa a migração em PostgreSQL via
PGlite, com contexto Auth simulado, e verifica RLS, isolamento, permissões,
validação, conflitos e reaplicação sem perda. Não substitui a validação no
projeto Supabase real.

## Dados, contas e sincronização

Cada conta nova começa como **gestor da própria frota**, sem acesso às demais.
O gestor abre **Minha conta → Equipe** e convida motoristas pelo e-mail.
O motorista cria uma conta com esse mesmo e-mail, confirma o cadastro e aceita
explicitamente o convite exibido ao entrar. O convite fica no aplicativo; não
envia e-mail automaticamente. Nesta versão, uma conta participa de uma frota.
Uma conta com frota própria preenchida/equipe não pode aceitar outra frota: use
uma conta nova ou vazia. Convites pendentes da própria equipe devem ser cancelados
antes de aceitar um convite de outra empresa.

**Gestor:** administra veículos, cadastros, despesas, multas, histórico, backups
e os convites/acessos da equipe. **Motorista:** vê os veículos e registra a
retirada/devolução; o banco determina a identidade do motorista e permite devolver
somente o veículo retirado pela própria conta. Não recebe histórico financeiro,
multas, documentos, peças ou backup completo, e não pode gravar o documento da
frota nem alterar permissões. A remoção de acesso é impedida enquanto houver
veículo com o motorista. Uma edição após revogação é negada no banco mesmo que
outra aba ainda exiba a interface antiga. O gestor ainda pode usar uma prévia da
visão do motorista, que não altera suas permissões.

**Minha conta → Meu perfil** permite salvar nome e foto JPEG compactada de
128×128 por usuário, separados dos dados da frota e protegidos pelas funções de
banco. Essas informações acompanham o login nos dispositivos e não ficam em
metadados de autenticação/tokens. A foto original pode ter até 5 MB; o resultado
salvo tem limite de 64 KiB. Nenhuma conta pode escolher o próprio cargo no perfil.
Os cadastros manuais da aba Motoristas continuam disponíveis ao gestor; convidar
uma conta não associa automaticamente uma CNH desse cadastro. As operações da
conta motorista ficam identificadas com usuário e nome nos registros de viagem.

Para instalações já publicadas, execute **002_profiles_roles.sql** no SQL Editor.
Até a atualização, o aplicativo continua no modelo anterior (conta individual) e
indica em Minha conta que perfis/equipe estão pendentes. Não declare permissões
implantadas antes de aplicar a atualização no banco real.

O SDK oficial gerencia a sessão e a renovação de tokens. No Supabase, os tokens
ficam no armazenamento do navegador: use **Sair** em computadores compartilhados.
A senha é tratada pelo Supabase Auth. O banco usa Row Level Security e funções com identidade autenticada; o acesso
aos dados depende do vínculo e cargo na equipe. As gravações só são permitidas por
uma função que determina a conta pelo usuário autenticado, valida o conteúdo
e exige a versão atual. A chave pública sozinha não dá acesso a dados privados.

As alterações são gravadas ao confirmar uma ação. Em outro dispositivo, use
**Atualizar dados** ou recarregue: não há atualização automática em tempo real.
Uma edição desatualizada é bloqueada sem sobrescrever o primeiro dispositivo.
Exporte as alterações pendentes antes de atualizar e refaça a edição.
Sem conexão, a tela conserva alterações para exportação, sem fila offline.

Os registros e fotos JPEG ficam em um documento JSONB por conta, limitado a
8 MB por gravação. Esta é uma solução inicial para frotas pequenas. Se crescer,
separe entidades em tabelas e mova fotos para Storage. Faça backups periódicos
pelo botão **Exportar backup**; não suponha que um plano gratuito ofereça backup
automático/restauração suficientes. Backups contêm dados pessoais: proteja-os.

## Importar os dados anteriores

O HTML antigo guarda dados no navegador onde foi utilizado, não no arquivo HTML.
Mantenha a origem intacta. Abra o HTML antigo naquele navegador e execute no console:

```js
const blob = new Blob([localStorage.getItem('frota-v1') || '{}'], {type:'application/json'});
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = 'fleeton-antigo.json';
link.click();
```

Na conta nova e vazia, escolha o JSON em **Importar dados do HTML antigo**.
A importação ignora o PIN, preserva a origem e não substitui frota preenchida.
Se já usou a versão Python/SQLite, clique em **Exportar backup** nela e importe
na conta Supabase. Contas/senhas da versão local não são migradas: crie a conta
no Supabase antes de importar os registros.

## Versão local anterior (SQLite)

```sh
python3 server.py
```

Ela serve a interface com `backend: local` e perfis pessoais. As permissões e
equipes são exclusivas da integração Supabase; no modo local cada conta mantém
sua frota isolada como gestor. A versão local guarda dados em
`data/fleeton.sqlite3` (ou `FLEETON_DB`) e não usa o Supabase. O banco existente
é preservado e ignorado pelo Git. Não confunda esse servidor local com o build
estático de produção. Para backup completo, use a API de backup do SQLite;
com WAL ativo, copiar somente o arquivo principal pode perder alterações.
