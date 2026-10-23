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
   para habilitar os perfis e as permissões. Para o checklist dos motoristas,
   execute também [`supabase/003_inspection.sql`](supabase/003_inspection.sql). Para a
   atualização automática do gestor, execute [`supabase/004_auto_sync.sql`](supabase/004_auto_sync.sql). As migrações podem ser reaplicadas
   na ordem 001 → 002 → 003 → 004 sem apagar os dados. Se já executou 001, 002 e 003, basta executar 004 nesta etapa.
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
O gestor abre **Meu perfil → Equipe** e convida motoristas pelo e-mail.
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

**Meu perfil** permite salvar nome e foto JPEG compactada de
128×128 por usuário, separados dos dados da frota e protegidos pelas funções de
banco. Essas informações acompanham o login nos dispositivos e não ficam em
metadados de autenticação/tokens. A foto original pode ter até 5 MB; o resultado
salvo tem limite de 64 KiB. Nenhuma conta pode escolher o próprio cargo no perfil.
Os cadastros manuais da aba Motoristas continuam disponíveis ao gestor; convidar
uma conta não associa automaticamente uma CNH desse cadastro. As operações da
conta motorista ficam identificadas com usuário e nome nos registros de viagem.

Para instalações já publicadas, execute **002_profiles_roles.sql** no SQL Editor.
Até a atualização, o aplicativo continua no modelo anterior (conta individual) e
indica em Meu perfil que perfis/equipe estão pendentes. Não declare permissões
implantadas antes de aplicar a atualização no banco real.

O SDK oficial gerencia a sessão e a renovação de tokens. No Supabase, os tokens
ficam no armazenamento do navegador: use **Sair** em computadores compartilhados.
A senha é tratada pelo Supabase Auth. O banco usa Row Level Security e funções com identidade autenticada; o acesso
aos dados depende do vínculo e cargo na equipe. As gravações só são permitidas por
uma função que determina a conta pelo usuário autenticado, valida o conteúdo
e exige a versão atual. A chave pública sozinha não dá acesso a dados privados.

As alterações são gravadas ao confirmar uma ação. O gestor recebe mudanças de
outra sessão por verificação automática a cada 20 segundos (com a migração 004
ativada e sem edição em andamento). Para atualizar manualmente, use **Atualizar
dados**. Motoristas continuam usando a atualização manual.
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

## Interface e navegação

No computador, a barra lateral reúne a marca, as seções da frota e o perfil.
**Meu perfil** abre os dados pessoais, backup/importação e a equipe do gestor
em uma área própria. No celular, o botão de menu abre a navegação; toque fora
ou pressione Escape para fechar. A identidade visual combina azul-marinho e azul elétrico. O botão de tema no cabeçalho alterna claro/escuro
e guarda a escolha no dispositivo. As transições respeitam movimento reduzido.
A identidade do usuário e as permissões continuam determinadas pelo banco.
Alterações visuais são publicadas pelo build/deploy do Cloudflare, sem migração
SQL adicional.

## Alertas de vencimento e busca

**Alertas**, na barra lateral, reúne IPVA, licenciamento, seguro, CNH, revisão
por data/quilometragem e peças com vida útil cadastrada. O contador também aparece
no cabeçalho. Documentos entram nos próximos 30 dias; revisões, a 500 km; peças,
a 1.000 km. Vencidos e vencendo hoje são destacados e aparecem primeiro. Datas
seguem o calendário de Brasília, inclusive nos dispositivos em outro fuso.
Alertas são calculados dos registros cadastrados: datas ausentes/inválidas e
revisões sem quilometragem programada não geram vencimentos. A central é do
gestor; o motorista continua limitado aos dados permitidos pelo banco.

Filtre a central por categoria/prioridade e use **Ver veículo** ou **Ver motoristas**
para tratar uma pendência. A validade de CNH pode ser corrigida em Motoristas
com **Atualizar CNH**. Os vencimentos se atualizam ao salvar, carregar os dados,
voltar para a aba ou a cada minuto enquanto a sessão está aberta. Não há envio
automático de e-mails, WhatsApp ou notificações fora do aplicativo.

Em **Veículos**, busque placa, modelo ou motorista atual, com ou sem acentos e
hífens. Combine com situação (disponível, em uso, com vencimentos) e motorista
que está utilizando o veículo. **Com vencimentos** usa os prazos/quilometragens
da central; o aviso de consumo anormal continua nos cartões/painel. Os filtros
mostram a contagem de resultados, preservam formulários em edição e podem ser
limpos. São locais à sessão e não alteram a frota nem ficam na próxima conta.
Esta atualização não exige migração SQL adicional.

## Checklist com fotos e comparação

Na retirada/devolução, informe combustível e estado de lataria/vidros, interior,
pneus, luzes e equipamentos. Cada item pode ficar como **Sem avaria**, **Com
avaria** ou **Não conferido**. Nenhum item é considerado conferido por padrão.
Se houver avaria, descreva-a nas observações. Confirme as informações antes de
registrar a etapa. É possível anexar até quatro fotos: frente, traseira e laterais.
No celular, o seletor favorece a câmera traseira; conforme o navegador, também
é possível escolher uma imagem existente. As fotos são opcionais e têm prévia,
remoção e ampliação. Imagens inválidas não são descartadas silenciosamente: o
registro exige substituir ou remover o arquivo com erro.

Cada imagem original pode ter até 10 MB. O aplicativo reencoda em JPEG de até
64 KiB, reduzindo resolução/qualidade. As imagens ficam no documento da frota,
não no Supabase Storage, e contam para o limite total de 8 MB por conta. A primeira
foto também serve como miniatura legada. Não é um arquivo dos originais em alta
resolução. Mantenha backups; para uso prolongado/intensivo de fotos, será necessário
migrar a mídia para Storage antes de atingir o limite.

**Histórico → Comparar fotos** (ícone de duas colunas na devolução) mostra os itens,
o combustível e as imagens por etapa. Mudanças são destacadas para conferência
humana, sem detecção automática de avarias ou atribuição de responsabilidade.
Novas viagens têm identificador próprio para evitar combinar registros diferentes.
Fotos e observações antigas continuam acessíveis, mesmo sem checklist estruturado.
O gestor pode comparar o histórico completo; o motorista vê, na devolução, o
resumo das condições da retirada, sem acesso ao histórico financeiro da frota.

Execute **003_inspection.sql** no SQL Editor após as migrações anteriores. Ela
valida o checklist e mantém as verificações de identidade, versão e quilometragem,
revogando o endpoint antigo para impedir que o motorista pule a validação. Não
apaga os dados existentes. Se estiver voltando de uma viagem iniciada antes desta
atualização, o novo checklist pode ser usado; a etapa anterior aparece como registro
legado. A nova interface exige essa migração para confirmar viagens de motorista;
o gestor continua salvando pelo fluxo completo da frota. A migração foi testada
localmente; a ativação no projeto real exige executá-la no Supabase.

Validação adicional: `python3 tests/browser_inspection.py` usa banco SQLite
temporário, fotos de teste e navegador real para verificar campos obrigatórios,
compactação, erros de imagem, persistência e comparação no computador/celular.
`npm test` também verifica o fluxo de motorista no PostgreSQL com as três migrações.

## Atualização automática para o gestor

Execute **supabase/004_auto_sync.sql** no SQL Editor após as migrações anteriores.
Ela acrescenta uma consulta autenticada que devolve apenas versão, cargo e
identificador da frota permitida; não expõe fotos, registros nem dados de terceiros.
Nenhuma tabela ou registro existente é removido. Reaplicar a consulta é seguro.

Na conta de gestor, o aplicativo verifica mudanças a cada **20 segundos** enquanto
a aba está visível e também verifica ao retornar ao aplicativo. Quando há nova
versão, atualiza Veículos, Em uso agora, histórico e alertas. O cabeçalho informa
quando a frota foi verificada/atualizada. Não é um rastreamento GPS: o estado muda
quando alguém confirma a retirada/devolução ou salva alterações.

Sem mudanças, só a consulta leve é feita. A frota inteira (que pode incluir fotos)
é baixada apenas quando necessário. Em falhas, os dados anteriores são mantidos,
o indicador mostra a falha e as novas tentativas ficam mais espaçadas (até dois
minutos). Verificações param ao sair da conta. A sincronização automática é do
gestor; motoristas mantêm o fluxo manual e suas permissões existentes.

Formulários, checklists com fotos, edições e comparações em aberto não são
substituídos. Quando chegam novidades durante uma edição, uma mensagem avisa o
gestor: termine/cancele a edição ou use **Atualizar dados**, confirmando o descarte
do formulário quando aplicável. Os filtros de busca são preservados. Uma mudança
de acesso interrompe a atualização e pede recarregar os dados da conta. As versões
continuam impedindo que uma gravação desatualizada sobrescreva outra edição.

Se a migração 004 ainda não foi aplicada, o indicador informa o requisito e não
faz repetidas consultas completas. Depois de executar o SQL, clique em
**Atualizar dados**. Os testes locais validam a função em PostgreSQL e usam duas
sessões reais em `python3 tests/browser_sync.py` para verificar o temporizador,
as mudanças de ocupação, rascunhos, respostas atrasadas, falha de rede e saída.
