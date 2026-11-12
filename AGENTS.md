# 📜 Livro de Regras do Projeto — StageTimer PFP (`AGENTS.md`)

Este ficheiro define as **regras obrigatórias de arquitetura, desenvolvimento e segurança** para qualquer agente de IA (Antigravity) ou programador que trabalhe no **StageTimer PFP**. Estas regras são carregadas automaticamente em todas as sessões.

---

## 🚨 1. Regras de Ouro (Inquebráveis)

0. **Níveis de Consentimento (Alterações Básicas vs. Estruturais)**:
   - **Alterações Básicas (Autónomas, sem pedir permissão)**: O agente pode aplicar diretamente modificações simples ou solicitadas pelo utilizador — correções de bugs pontuais, ajustes visuais de CSS, textos/labels da UI, cache-busting (`?v=XX`, `sw.js`), documentação e ajustes simples num único ecrã.
   - **Alterações Estruturais / Críticas (Consentimento Prévio Obrigatório)**: NUNCA alterar a arquitetura global, o motor de sincronização ([local-sync.js](public/js/local-sync.js)), apagar ficheiros, alterar o formato do `state` ou fazer refatorações de grande escala que afetem múltiplos ecrãs sem apresentar previamente o plano detalhado e obter autorização explícita do utilizador.
0.1. **Commit Git Automático Obrigatório**: Sempre que qualquer alteração a ficheiros for autorizada e executada, fazer **imediatamente um commit Git autónomo e automático** (sem necessidade de pedir confirmação adicional para commitar), usando mensagens semânticas e claras em Português (ex.: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`). O executável do Git encontra-se em `C:\Users\pedro\AppData\Local\GitHubDesktop\app-3.6.10\resources\app\git\cmd\git.exe` ou no PATH.
0.2. **Apresentação Obrigatória da Versão Pós-Update**: Após a conclusão de qualquer alteração e do respetivo commit, indicar **sempre ao utilizador a versão resultante** da aplicação (versão de cache `vXX` em `sw.js`/HTML), o hash e mensagem do commit Git gerado, e a lista de ficheiros/ecrãs atualizados.
1. **Zero Regressões entre Ecrãs**: O StageTimer é um ecossistema distribuído em tempo real. Qualquer alteração em [local-sync.js](public/js/local-sync.js) ou [common.css](public/css/common.css) afeta **todos os 9 ecrãs** (`index`, `master`, `controller`, `operator`, `dc`, `cue-station`, `regies`, `lineup`, `viewer`). Nunca remova métodos ou propriedades públicas de `UniversalSyncClient` / `StageTimerClient`.
2. **100% Compatível com Deploy Estático (Netlify)**: Em produção, a aplicação corre a partir da pasta `public/` sem depender do `server.js` Node.js. Toda a lógica de estado, sincronização (MQTT over WSS + `BroadcastChannel` + `localStorage`) e importação tem de funcionar 100% no browser.
3. **Zero Bandas Demo / Clean Slate**: Novos eventos e salas começam **sempre vazios (0 artistas/timers)**. Nunca introduza dados fictícios/hardcoded em novas salas. Respeite sempre a lista de eventos apagados (`stagetimer_v63_deleted` tombstones).
4. **Preservação de Sessão e Identidade**: Qualquer limpeza de cache ou reset de estado **tem obrigatoriamente de preservar**:
   - `stagetimer_device_uuid` e `stagetimer_screen_uuid` (identidade do dispositivo)
   - `stagetimer_master_active`, `stagetimer_master_auth_v12` e `stagetimer_auth_unlocked` (sessão de autenticação)
5. **Cache-Busting Obrigatório**: Sempre que modificar qualquer ficheiro `.js` ou `.css` em `public/`:
   - Incremente o parâmetro `?v=XX` nas referências `<script src="...">` e `<link href="...">` dos ficheiros `.html` afetados.
   - Incremente o `CACHE_NAME` em [public/sw.js](public/sw.js) (ex.: `stagetimer-pfp-v93` ➔ `stagetimer-pfp-v94`).

---

## 🏛️ 2. Mapa da Arquitetura e Papéis (Ecrãs)

| Ecrã (HTML) | Script Principal | Estilo Principal | Função e Regras Específicas |
| :--- | :--- | :--- | :--- |
| [public/index.html](public/index.html) | Inline + `local-sync.js` | `common.css` | **Hub Inicial**: Seleção de evento/palco, entrada nos modos, criação de eventos. |
| [public/master.html](public/master.html) | [master.js](public/js/master.js) | [master.css](public/css/master.css) | **Super Régie Master**: Controlo global multi-palco, presença de dispositivos em tempo real, redirecionamento remoto de ecrãs (`_cmd/<uuid>`). |
| [public/controller.html](public/controller.html) | [controller.js](public/js/controller.js) | [controller.css](public/css/controller.css) | **Configurador Completo**: Gestão de lineup multi-dia, importação de horários/teatro, timers, mensagens e configurações avançadas. |
| [public/operator.html](public/operator.html) | [operator.js](public/js/operator.js) | [operator.css](public/css/operator.css) | **Operador Mobile**: Controlo rápido de palco (Play/Pause/Reset, On Air, +1m/-1m, mensagens rápidas) otimizado para toque. |
| [public/dc.html](public/dc.html) | [dc.js](public/js/dc.js) | [dc.css](public/css/dc.css) | **Modo Jess (Diretora de Cena)**: Disparo de Cues (`STANDBY` / `GO`), Guião com auto-scroll, Checklists Pré-Show e Telemetria/Relatórios Pós-Show. |
| [public/cue-station.html](public/cue-station.html) | [cue-station.js](public/js/cue-station.js) | [cue-station.css](public/css/cue-station.css) | **Posto Técnico (Cue Receiver)**: Ecrã de receção de Cues por departamento (Som, Luz, Vídeo, Palco, etc.) com botão gigante de confirmação `ACK` e checklists. |
| [public/regies.html](public/regies.html) | [regies.js](public/js/regies.js) | [regies.css](public/css/regies.css) | **Modo Régies (FOH / Palco / Técnico)**: Comunicação rápida entre régies, alertas de departamento, confirmação de prontidão e monitorização do alinhamento. |
| [public/lineup.html](public/lineup.html) | [lineup.js](public/js/lineup.js) | [lineup.css](public/css/lineup.css) | **Modo Lista (Lineup)**: Visualização limpa do alinhamento, horários previstos vs. reais e estado de cada atuação. |
| [public/viewer.html](public/viewer.html) | [viewer.js](public/js/viewer.js) | [viewer.css](public/css/viewer.css) | **Ecrã de Palco (Fullscreen)**: Countdown/Countup gigante de alto contraste, cores dinâmicas (verde/amarelo/vermelho/flash) e prompter de mensagens. |

---

## 🔄 3. Regras do Motor de Sincronização (`public/js/local-sync.js`)

1. **Tripla Camada de Sincronização**:
   - **Cloud**: MQTT over WSS (`stagetimer_v10/<ROOM>/state`, `stagetimer_v10/<ROOM>/presence`, `stagetimer_v63_events_registry`).
   - **Local Instantâneo**: `BroadcastChannel` (`stagetimer_v10_<ROOM>` para estado e `stagetimer_v10_cmds` para comandos remotos).
   - **Persistência Local**: `localStorage` (`stagetimer_v10_state_<ROOM>`).
2. **Isolamento de Sala (`cleanRoom`)**:
   - O código da sala é normalizado em maiúsculas (`[^A-Z0-9_-]` removidos).
   - A prioridade de resolução da sala ao abrir qualquer página é: `?room=CODIGO` na URL ➔ `sessionStorage.getItem('stagetimer_active_room')` ➔ `localStorage.getItem('stagetimer_device_room')` ➔ `localStorage.getItem('stagetimer_last_room')` ➔ `'PALCO1'`.
3. **Estrutura Multi-Dia (`days` & `activeDayId`)**:
   - Cada sala suporta múltiplos dias (`state.days`), mantendo `state.timers` sincronizado com o dia ativo (`state.activeDayId`) para retrocompatibilidade com todos os ecrãs. Sempre que modificar `state.timers`, assegure que `_syncActiveDayFromTimers()` / `_ensureDaysStructure()` mantém o dia ativo consistente.
4. **Hora Real Sincronizada (`getTrueTime`)**:
   - Nunca use `Date.now()` isolado para cálculos de duração de timers em curso se `UniversalSyncClient.globalTrueTime()` estiver disponível. Isso garante que todos os dispositivos mostram exatamente o mesmo segundo no palco mesmo com relógios locais desfasados.

---

## 🎭 4. Regras de Direção de Cena (DC) e Postos Técnicos (Cue Station)

1. **Ciclo de Vida de uma Cue**:
   - Estados válidos: `'idle'` ➔ `'standby'` ➔ `'go'` ➔ `'acked'`.
   - Ao disparar `STANDBY` ou `GO` em [dc.js](public/js/dc.js), os timestamps (`standbyAt`, `goAt`, `ackedAt`, `ackLatencyMs`) são registados no objeto da cue e no log de telemetria (`state.theatre.telemetry`).
   - O Posto Técnico ([cue-station.js](public/js/cue-station.js)) filtra cues pelo departamento selecionado (`Som`, `Luz`, `Vídeo`, `Palco`, `Pirotecnia`, `Todos`), dispara alerta visual/sonoro em `STANDBY` e `GO`, e envia confirmação `ACK`.
2. **Telemetria e Relatórios Guardados**:
   - Os relatórios pós-show guardados em `state.theatre.savedReports` devem permanecer acessíveis para visualização em modal, cópia para clipboard e download `.txt`.

---

## 🔐 5. Regras de Autenticação (`public/js/auth.js`)

1. **Níveis de Acesso**:
   - **Controlador / Operador / DC / Régies**: Passwords aceites: `'1379'`, `'brito'`, `'1379brito'`.
   - **Super Régie Master (`master.html`)**: Password principal `'1379brito'` (com suporte às chaves configuradas em `VALID_PASSWORDS`).
2. **Desbloqueio Global Master**:
   - Se `window.isStageTimerMaster()` devolver `true` (`stagetimer_master_active === '1'` ou `stagetimer_master_auth_v12 === 'true'`), **nenhum ecrã** deve pedir password novamente ao navegar entre páginas.

---

## 📱 6. Regras de UI/UX, Mobile, iOS e CSS

1. **Proibido Scroll Horizontal**: `html` e `body` devem manter `overflow-x: hidden; max-width: 100vw;`. Nenhum botão, tabela ou barra de topo pode causar overflow lateral em ecrãs de 320px–430px (iPhone).
2. **Prevenção de Auto-Zoom no iOS Safari**: Todos os `<input>`, `<select>` e `<textarea>` em vistas mobile devem ter `font-size: 16px` (ou superior).
3. **Toque Rápido sem Delay**: Todos os elementos interativos (`button`, `a`, `input`, `select`) devem ter `touch-action: manipulation`.
4. **Safe Areas (Notch / Dynamic Island / Home Indicator)**: Usar sempre `var(--safe-top)`, `var(--safe-bottom)`, `var(--safe-left)`, `var(--safe-right)` e `100dvh` para layouts fullscreen.
5. **Idioma**: Toda a interface de utilizador, mensagens de erro, botões e relatórios devem estar em **Português (PT)**.

---

## ✅ 7. Checklist Obrigatória Antes de Concluir Qualquer Tarefa

- [ ] A alteração funciona sem o servidor Node.js (apenas com os ficheiros estáticos de `public/` e `local-sync.js`)?
- [ ] A estrutura de `state` em `local-sync.js` mantém retrocompatibilidade com `master`, `controller`, `operator`, `dc`, `cue-station`, `regies`, `lineup` e `viewer`?
- [ ] As versões `?v=XX` nos `.html` e o `CACHE_NAME` em `public/sw.js` foram atualizados se algum `.js` ou `.css` mudou?
- [ ] O layout continua responsivo em mobile/tablet sem scroll horizontal e sem auto-zoom em inputs no iOS?
