# INVCRIPTO 1.2 — Modalidades e Trading Control

## Alterações visuais

- Mantido o layout premium verde/dourado.
- Trading Control reorganizado para alinhar todos os botões em largura total.
- Auto Trading passou a ter bloco próprio e melhor leitura.
- Adicionado seletor 2x2 para as quatro modalidades de operação.

## Modalidades disponíveis

- Conservador: proteção a cada 1,00%, uma moeda, análise principal M5.
- Moderado: proteção a cada 0,50%, uma moeda, análise principal M5.
- Arrojado: proteção a cada 0,30%, uma moeda, execução M1.
- Alavancagem: proteção a cada 0,15%, até cinco moedas, execução M1.

## Persistência

A modalidade escolhida é salva em `bot_instances.profile_name` e em `bot_instances.config` pela função Netlify `bot-profile-settings`.

O envio de ordem protegida também transporta a modalidade selecionada para impedir que uma ordem use configuração antiga durante a troca de perfil.

## Regras preservadas

- Entrada inicial de 10 USDT.
- Meta de 0,5% líquido por cesta.
- 80% para recuperação normal.
- 20% para reserva extraordinária.
- Robô inicia pausado.
