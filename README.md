# WEARK — tienda de trajes romanos

La web se sirve con un pequeño servidor (Flask). El catálogo y el carrito son de esta tienda. El cobro lo hace MONEI.

Para instalarla en el VPS, sigue `GUIA-VPS.md`.

## Probar en el ordenador

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:MONEI_MOCK = "1"
$env:ADMIN_PASSWORD = "prueba-local"
$env:PUBLIC_BASE_URL = "http://127.0.0.1:8001"
.\.venv\Scripts\python app.py
```

Abre `http://127.0.0.1:8001`. Con `MONEI_MOCK=1` no se cobra. En el servidor ese valor tiene que ser `0` y hace falta `MONEI_API_KEY`.
