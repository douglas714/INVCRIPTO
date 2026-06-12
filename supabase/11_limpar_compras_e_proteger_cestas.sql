-- INVCRIPTO IA - limpeza segura de compras repetidas
-- Execute no Supabase SQL Editor se quiser limpar a fila/historico visual.
-- Nao cancela ordens abertas na Binance e nao vende a mercado.

-- 1) Cancela comandos de compra real ainda pendentes/rodando.
update public.connector_commands
set
  status = 'cancelled',
  error_message = 'Cancelado por limpeza: migracao para cesta martingale protegida.',
  completed_at = now(),
  updated_at = now()
where command_type = 'EXECUTE_PROTECTED_SPOT_BUY'
  and status in ('pending','running');

-- 2) Opcional: limpa apenas BUY do historico visual do Supabase.
-- Mantem SELL porque vendas abertas/protegidas precisam continuar auditadas.
-- Descomente para executar:
-- delete from public.real_orders
-- where side = 'BUY';

notify pgrst, 'reload schema';
