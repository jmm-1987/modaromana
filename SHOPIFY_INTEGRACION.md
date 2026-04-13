# Integracion de Shopify Buy Button en WEARK

## Estado actual del proyecto

La web de WEARK esta preparada para Shopify, pero actualmente usa placeholders visuales.
No hay ecommerce propio, no hay base de datos de productos y no hay botones de compra activos.

## Flujo correcto antes de integrar botones

1. Crear la tienda en Shopify.
2. Crear y publicar los productos en Shopify.
3. Activar/cargar el canal **Buy Button** en Shopify.
4. Generar los codigos embebidos (producto individual o coleccion).
5. Pegar esos codigos en `index.html` en los contenedores preparados.

## Que es Shopify Buy Button

Shopify Buy Button permite incrustar productos o colecciones de Shopify dentro de una web externa (como esta landing Flask), sin construir un backend de ecommerce propio.

## Donde pegar el codigo en este proyecto

Archivo principal de integracion:

- `index.html`

Seccion:

- `section#articulos`

### Contenedores por producto individual

Cada tarjeta tiene un contenedor con id unico:

- `shopify-product-1`
- `shopify-product-2`
- `shopify-product-3`
- ...
- `shopify-product-10`

Ejemplo real en el HTML:

```html
<div class="shopify-button-placeholder" id="shopify-product-1">
    <!-- Aqui se insertara el codigo embebido de Shopify Buy Button para este producto -->
    <button type="button" class="btn btn-secondary" disabled>Boton de compra proximamente</button>
</div>
```

Para integrar, reemplaza el boton placeholder por el codigo embebido del producto correspondiente.

### Contenedor alternativo para coleccion completa

Debajo de la grid existe un contenedor listo para insertar un Buy Button de coleccion:

```html
<!-- Alternativa: aqui se puede insertar un Buy Button de coleccion completa desde Shopify -->
<div id="shopify-collection-container" hidden></div>
```

Si usas coleccion completa, puedes:

- Mostrar este contenedor quitando `hidden`.
- Insertar alli el codigo de coleccion generado por Shopify.
- Mantener o retirar la grid de placeholders segun tu estrategia visual.

## Como generar un boton de producto individual

1. En Shopify, abre **Buy Button**.
2. Selecciona **Create a Buy Button** para un producto.
3. Configura estilo, texto y variantes.
4. Copia el embed code.
5. Pegalo dentro del `div` `shopify-product-X` correspondiente en `index.html`.

## Como generar una coleccion completa

1. En Shopify, abre **Buy Button**.
2. Selecciona **Create a Buy Button** para una coleccion.
3. Configura distribucion, cantidad de productos y estilo.
4. Copia el embed code.
5. Pegalo en `#shopify-collection-container` dentro de `index.html`.

## Como reemplazar los placeholders actuales

1. Identifica la tarjeta objetivo por su id `shopify-product-X`.
2. Borra el boton deshabilitado "Boton de compra proximamente".
3. Pega el embed de Shopify en ese mismo bloque.
4. Repite para cada producto que quieras activar.

## Checklist final

- [ ] Tienda creada en Shopify
- [ ] Productos creados y publicados
- [ ] Canal Buy Button habilitado
- [ ] Buy Button generado (producto individual o coleccion)
- [ ] Codigo pegado en `index.html`
- [ ] Placeholders reemplazados correctamente
- [ ] Revision visual responsive en movil y escritorio
