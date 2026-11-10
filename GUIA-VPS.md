# Poner la tienda en el VPS (Ubuntu 24.04)

La web deja de usar Shopify. El catálogo, el carrito y los pedidos viven en este servidor. El cobro lo hace MONEI, en su página de pago (tarjeta, PayPal o Bizum, los que tengas activos en la cuenta).

Esta tienda ocupa solo esta carpeta:

```text
/var/www/trajesromanos/modaromana
```

El otro proyecto irá en otra carpeta, por ejemplo `/var/www/telasaturollo`, con su propio servicio y su propio puerto. No lo metas dentro de esta.

Puedes usar la misma cuenta de MONEI que telasaturollo. Crea dentro una tienda llamada «Trajes romanos» y no toques el webhook que ya tenga el otro proyecto: cada pago de esta web avisa a su propia dirección.

## 1. Probar antes en el PC

En PowerShell, dentro de `modaromana`:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:MONEI_MOCK = "1"
$env:ADMIN_PASSWORD = "prueba-local"
$env:PUBLIC_BASE_URL = "http://127.0.0.1:8001"
.\.venv\Scripts\python app.py
```

Abre `http://127.0.0.1:8001`. Añade un artículo, rellena el carrito y pulsa pagar. Con `MONEI_MOCK=1` no se cobra: el pedido queda marcado como pagado para que veas el recorrido. El listado está en `http://127.0.0.1:8001/admin` (usuario `weark`, contraseña `prueba-local`).

En el servidor `MONEI_MOCK` tiene que ser `0`. Si hay clave de MONEI, el modo de prueba local se ignora.

## 2. Preparar Ubuntu

Entra por SSH y ejecuta:

```bash
sudo apt update
sudo apt install -y nginx python3-venv certbot python3-certbot-nginx
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo mkdir -p /var/www/trajesromanos/modaromana
sudo chown -R $USER:www-data /var/www/trajesromanos/modaromana
```

Apunta `trajesromanos.com` y `www.trajesromanos.com` al IP del VPS (registro A) antes de pedir el certificado. Hasta que el DNS propague, el HTTPS no se puede emitir.

## 3. Subir el proyecto

Desde PowerShell, en la carpeta `modaromana` (cambia usuario e IP). Este comando no sube `.venv`:

```powershell
scp -r app.py catalog.json requirements.txt .env.example .gitignore *.html fav.png og-image.jpg robots.txt sitemap.xml CNAME static data deploy GUIA-VPS.md README.md SHOPIFY_INTEGRACION.md usuario@IP:/var/www/trajesromanos/modaromana/
```

Si se ha colado algo que no toca, en el servidor:

```bash
rm -rf /var/www/trajesromanos/modaromana/.venv /var/www/trajesromanos/modaromana/__pycache__
```

En el servidor:

```bash
cd /var/www/trajesromanos/modaromana
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
nano .env
```

Rellena `.env` así, sin comillas y sin la palabra `export`:

```text
MONEI_API_KEY=la_clave_de_tu_panel
MONEI_STORE_ID=el_id_de_la_tienda_Trajes_romanos
PUBLIC_BASE_URL=https://www.trajesromanos.com
ADMIN_PASSWORD=una_contraseña_larga_sin_espacios
MONEI_MOCK=0
SHOP_NOTIFY_EMAIL=weark@weark.es
```

La clave está en MONEI → Ajustes → Acceso a API. Empieza con la clave de prueba. Cuando un pago de prueba aparezca en `/admin`, cámbiala por la real y reinicia el servicio.

`MONEI_STORE_ID` es el id de la tienda «Trajes romanos» dentro de la misma cuenta. Así en el panel filtras estos cobros y no se mezclan con telasaturollo. Si lo dejas vacío, el dinero entra igual.

El correo (SMTP_*) es opcional. Si lo dejas vacío, los pedidos solo se ven en `/admin`.

Permisos:

```bash
sudo chgrp -R www-data /var/www/trajesromanos/modaromana
sudo chmod -R g+rX /var/www/trajesromanos/modaromana
sudo chown www-data:www-data /var/www/trajesromanos/modaromana/data
sudo chmod 775 /var/www/trajesromanos/modaromana/data
sudo chgrp www-data /var/www/trajesromanos/modaromana/.env
sudo chmod 640 /var/www/trajesromanos/modaromana/.env
```

## 4. Arrancar la aplicación

```bash
sudo cp /var/www/trajesromanos/modaromana/deploy/trajesromanos.service /etc/systemd/system/trajesromanos.service
sudo systemctl daemon-reload
sudo systemctl enable --now trajesromanos
sudo systemctl status trajesromanos
curl -s http://127.0.0.1:8001/api/productos | head
```

Tiene que salir JSON con los artículos. Si no:

```bash
journalctl -u trajesromanos -n 50 --no-pager
```

## 5. Nginx y HTTPS

```bash
sudo cp /var/www/trajesromanos/modaromana/deploy/trajesromanos.nginx /etc/nginx/sites-available/trajesromanos
sudo ln -s /etc/nginx/sites-available/trajesromanos /etc/nginx/sites-enabled/trajesromanos
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d trajesromanos.com -d www.trajesromanos.com
```

Certbot pregunta el email y reescribe el sitio para el HTTPS.

Después, para que la tienda y el carrito vivan en una sola dirección (`www`), añade un bloque que mande el dominio sin www hacia www. Puedes pegarlo al final de `/etc/nginx/sites-available/trajesromanos` y recargar nginx. Usa las mismas rutas de certificado que certbot haya dejado en el bloque de `www`:

```nginx
server {
    listen 80;
    server_name trajesromanos.com;
    return 301 https://www.trajesromanos.com$request_uri;
}

server {
    listen 443 ssl;
    server_name trajesromanos.com;
    ssl_certificate /etc/letsencrypt/live/trajesromanos.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/trajesromanos.com/privkey.pem;
    return 301 https://www.trajesromanos.com$request_uri;
}
```

Quita `trajesromanos.com` del `server_name` del bloque principal, deja solo `www.trajesromanos.com`, y recarga:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`PUBLIC_BASE_URL` tiene que ser exactamente `https://www.trajesromanos.com`, porque es la dirección a la que MONEI devuelve al cliente.

## 6. Comprobar el cobro

1. Abre `https://www.trajesromanos.com`.
2. Añade un artículo, paga con la clave de prueba de MONEI.
3. Entra en `https://www.trajesromanos.com/admin` con usuario `weark` y la contraseña de `ADMIN_PASSWORD`.
4. El pedido tiene que estar en estado `pagado`.
5. Cambia `MONEI_API_KEY` a la clave real y ejecuta `sudo systemctl restart trajesromanos`.

Los pedidos pagados se confirman cuando MONEI llama a `https://www.trajesromanos.com/api/monei/aviso`. Esa dirección tiene que ser pública y HTTPS. No hace falta dar de alta otro webhook de cuenta. Si telasaturollo ya tiene un webhook de cuenta, también recibirá estos pagos: debe ignorar los números de pedido que no sean suyos. Los de esta tienda empiezan por `WR`.

## 7. El día a día

Cambiar un precio o un texto: edita `catalog.json` y reinicia.

```bash
sudo systemctl restart trajesromanos
```

Los precios del archivo son céntimos: `7500` son 75,00 €. El envío está arriba del archivo: 900 céntimos, gratis desde 6000 (60 €).

Ver la tienda en marcha:

```bash
journalctl -u trajesromanos -f
```

Marcar un pedido enviado: en `/admin`, abre el pedido y pulsa «Marcar como enviado».

## 8. Meter el otro proyecto después

Repite la idea, sin reutilizar puerto ni carpeta:

```text
/var/www/otro-proyecto
servicio systemd propio
gunicorn en 127.0.0.1:8002
otro archivo en /etc/nginx/sites-available, con su dominio
```

Nginx elige el sitio por el dominio. Los dos pueden estar en el mismo VPS. No compartas el `.env` ni la base de pedidos: cada uno tiene los suyos. La cuenta de MONEI puede ser la misma si es la misma empresa; usa otra tienda (otro `MONEI_STORE_ID`) para separar los cobros.
