-- INV CRIPTO IA - Promover primeiro administrador
-- 1) Crie/cadastre seu usuário no site primeiro.
-- 2) Depois execute este SQL no Supabase SQL Editor.

update public.profiles
set role = 'admin', status = 'active', updated_at = now()
where email = 'douglasnoticias@gmail.com';

-- Conferir se ficou admin:
select id, email, full_name, phone, role, status
from public.profiles
where email = 'douglasnoticias@gmail.com';
