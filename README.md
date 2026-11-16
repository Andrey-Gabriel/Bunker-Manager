# ABRIGO · Bunker Manager

[Jogar no GitHub Pages](https://andrey-gabriel.github.io/Bunker-Manager/)

Monte um bunker, mantenha água, comida e energia e escolha um legado para a sua colônia. Para jogar localmente, abra `index.html` no navegador.

## Controles

- Arraste o cenário para navegar. Use **−**, **+** e o botão do meio para ajustar a câmera ou ver o bunker inteiro.
- Clique num cômodo ou morador para inspecioná-lo. No celular, use também o seletor de cômodos.
- Em **Construir**, escolha uma planta e confirme um lote compatível. Use **Tarefas** para acompanhar obras e iniciativas.
- **Balanço** mostra produção, reservas e diagnósticos. **Diário** reúne histórias, acordos e legados.
- O menu ☰ tem áudio, movimento reduzido, texto maior e transferência de partidas por arquivo. A dificuldade pode ser escolhida ao iniciar uma colônia.

Para repetir um mapa, use o mesmo cenário e o código mostrado no menu da partida. Os vestígios são opcionais e vêm da colônia anterior deste aparelho.

## Sincronização entre aparelhos

O jogo usa um serviço separado para sincronizar o save ativo. O serviço incluído no projeto usa um código de conta privado e guarda uma versão por conta. Em caso de divergência, o jogo pede qual cópia usar.

1. No jogo, abra **☰ → Sincronização** e gere um código de conta. Guarde o código e use-o em todos os aparelhos.
2. Num servidor Node.js, configure `ABRIGO_SYNC_ACCOUNTS` com esse código. Se houver mais contas, separe os códigos com vírgulas.
3. Configure `ABRIGO_SYNC_ORIGIN` com a origem do jogo, como `https://andrey-gabriel.github.io`, e `ABRIGO_SYNC_DIR` com um diretório persistente para os arquivos. Rode `npm run sync` e publique o serviço atrás de HTTPS. A porta padrão é 8787 e pode ser alterada com `PORT`. Use uma instância por diretório.
4. Informe o endereço HTTPS e o código em **Sincronização**. Ao usar dois aparelhos, volte ao menu para acompanhar o estado do envio antes de trocar de aparelho.

Mantenha o diretório de saves fora dos arquivos públicos do site e inclua-o no backup do servidor. Para testar localmente com `index.html` aberto como arquivo, configure a origem do serviço como `null` e use `http://127.0.0.1:8787`.

## Testes

Com Node.js 20 ou superior, rode `npm install`, `npx playwright install chromium` e `npm test`. Os testes exercitam o jogo no computador e no celular simulado, além do serviço de sincronização.
