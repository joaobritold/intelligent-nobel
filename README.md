# 🎭 StageTimer

Sistema profissional de timer e cronômetro para palcos, eventos e apresentações, inspirado no [stagetimer.io](https://stagetimer.io).

## 🚀 O que já está pronto

- 🎛️ **Controller (Operador)**:
  - Adicionar, renomear e excluir múltiplos timers.
  - Modos: **Countdown**, **Count-up** e **Clock** (relógio do dia).
  - Play, Pause e Reset individuais e globais.
  - Definição de durações flexíveis (`5:00`, `90`, `1h30m`).
  - Alertas visuais configuráveis (Aviso em amarelo, Perigo em vermelho).
  - Reordenação de timers via Drag & Drop.
  - Seleção do timer **On Air** (ativo no palco).
  - Envio de recados instantâneos ao vivo no palco (prompter).
  - Preview em tempo real da tela do palco.
- 📺 **Viewer (Tela do Palco / Fullscreen)**:
  - Exibição em tela cheia com texto de alto contraste otimizado para palcos.
  - Cores dinâmicas (Verde ➔ Amarelo ➔ Vermelho ➔ Flash em caso de tempo estourado).
  - Barra de progresso visual inferior.
  - Atalhos: tecla `F` ou duplo clique para alternar Tela Cheia (Fullscreen).
  - Reconexão automática em caso de oscilação na rede.
- 🔌 **Servidor Realtime WebSocket**:
  - Servidor Node.js com WebSocket para sincronização instantânea entre múltiplos operadores e múltiplos palcos.

---

## 🛠️ Como rodar

### 1. Pré-requisito
Certifique-se de ter o **Node.js** (v18+) instalado no Windows:
- Baixe em [nodejs.org](https://nodejs.org/) ou via terminal:
  ```powershell
  winget install OpenJS.NodeJS.LTS
  ```

### 2. Instalar dependências
Na raiz do projeto (`intelligent-nobel`):
```powershell
npm install
```

### 3. Iniciar o servidor
```powershell
npm start
```

### 4. Acessar
- **Painel do Operador**: [http://localhost:3000/controller.html](http://localhost:3000/controller.html)
- **Tela do Palco (Viewer)**: [http://localhost:3000/viewer.html](http://localhost:3000/viewer.html)
