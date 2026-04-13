# WEARK - Web corporativa estatica

Landing page corporativa para **WEARK**, inspirada en la antigua Roma y preparada para integrar Shopify Buy Button en la seccion de articulos.

## Ejecucion local

No requiere backend ni base de datos.

### Opcion 1: abrir directamente

Abre `index.html` con tu navegador.

### Opcion 2: servidor local simple (recomendado)

Desde la carpeta del proyecto:

```powershell
python -m http.server 5500
```

Luego abre:

`http://127.0.0.1:5500`

## Estructura del proyecto

```text
modaromana/
├── index.html
├── README.md
├── SHOPIFY_INTEGRACION.md
└── static/
    ├── css/
    │   └── style.css
    ├── js/
    │   └── main.js
    └── img/
```

## Despliegue

Al ser una web estatica, puedes desplegarla en cualquier hosting de archivos estaticos (Render Static Site, Netlify, Vercel, GitHub Pages, etc.).
