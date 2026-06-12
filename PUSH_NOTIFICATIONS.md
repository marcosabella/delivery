# Web Push en Supabase

## 1. Generar claves VAPID

```bash
npx web-push generate-vapid-keys
```

Agregar la clave publica al frontend:

```env
VITE_VAPID_PUBLIC_KEY=...
```

## 2. Configurar secretos de la Edge Function

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:admin@example.com PUSH_WEBHOOK_SECRET=...
```

`PUSH_WEBHOOK_SECRET` debe ser un valor aleatorio largo.

## 3. Aplicar y desplegar

```bash
npx supabase db push
npx supabase functions deploy push-notifications --no-verify-jwt
```

## 4. Crear el Database Webhook

En Supabase Dashboard, abrir `Database > Webhooks` y crear uno con:

- Tabla: `public.orders`
- Eventos: `INSERT` y `UPDATE`
- Tipo: `Supabase Edge Functions`
- Function: `push-notifications`
- Header: `x-webhook-secret: <PUSH_WEBHOOK_SECRET>`

El header HTTP debe llamarse exactamente `x-webhook-secret`. No colocar el secreto
como valor de `Content-Type`; esa cabecera debe conservar el valor `application/json`.

El webhook avisa al restaurante cuando entra un pedido y al cliente cuando cambia su estado.

## iPhone/iPad

En iOS/iPadOS la web debe agregarse a la pantalla de inicio antes de solicitar el permiso push. El sitio publicado debe usar HTTPS.
