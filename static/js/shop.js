const CART_KEY = "weark_cart_v1";

function money(cents) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function readCart() {
    try {
        const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((line) => line && line.productId && line.variantId && line.qty > 0);
    } catch (error) {
        return [];
    }
}

function writeCart(lines) {
    localStorage.setItem(CART_KEY, JSON.stringify(lines));
    updateCartCount();
}

function updateCartCount() {
    const count = readCart().reduce((sum, line) => sum + Number(line.qty || 0), 0);
    document.querySelectorAll("#cart-count").forEach((node) => {
        node.textContent = String(count);
    });
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text != null) {
        node.textContent = text;
    }
    return node;
}

async function loadCatalog() {
    if (window.__wearkCatalog) {
        return window.__wearkCatalog;
    }
    const response = await fetch("/api/productos");
    if (!response.ok) {
        throw new Error("catálogo");
    }
    window.__wearkCatalog = await response.json();
    return window.__wearkCatalog;
}

function firstAvailable(product) {
    return product.variants.find((variant) => variant.available) || product.variants[0];
}

const SWATCHES = {
    "AMARILLO": ["#e2b423"],
    "AZUL - BEIGE": ["#2f6fbe", "#e4d2b0"],
    "AZUL - MARINO": ["#1b2a4a"],
    "BEIGE - LILA": ["#e4d2b0", "#b497c6"],
    "BEIGE - PÚRPURA": ["#e4d2b0", "#6b3a6b"],
    "BORGOÑA - ROSA": ["#6e2430", "#e7a3b0"],
    "BURDEOS": ["#6e1e2e"],
    "CALDERA": ["#c45c26"],
    "CELESTE": ["#8ecae6"],
    "CELESTE Y AZUL": ["#8ecae6", "#2f6fbe"],
    "GRIS": ["#8a8a8a"],
    "MARRON - ROSA EMPOLVADO": ["#7a5230", "#d7a7a0"],
    "MARRÓN": ["#7a5230"],
    "MARRÓN CLARO": ["#c4a484"],
    "MARRÓN OSCURO": ["#4a2f22"],
    "Mostaza": ["#c4a035"],
    "NARANJA": ["#e07a2f"],
    "PISTACHO": ["#a8c07a"],
    "PÚRPURA": ["#6b3a6b"],
    "ROJO - NEGRO": ["#9b2331", "#1c1c1c"],
    "ROSA - CELESTE": ["#e7a3b0", "#8ecae6"],
    "TIERRA": ["#8b5a3c"],
    "VEIGE Y NEGRO": ["#e4d2b0", "#1c1c1c"],
    "VERDE": ["#3d7a45"],
    "VERDE - BURDEO": ["#3d7a45", "#6e1e2e"],
    "VERDE - MENTA": ["#3d7a45", "#98d4c0"],
    "VERDE AGUA": ["#5eaea0"],
    "VERDE MUSGO": ["#5c6b3a"],
    "VERDE OSCURO": ["#1f4a32"],
    "VINO TINTO": ["#6b1d32"]
};

function isColorOption(option) {
    return option.name.trim().toLowerCase() === "color";
}

function swatchBackground(name) {
    const stops = SWATCHES[name] || ["#cfc8bc"];
    if (stops.length === 1) {
        return stops[0];
    }
    return `linear-gradient(135deg, ${stops[0]} 50%, ${stops[1]} 50%)`;
}

function selectedOptions(card, product) {
    const selected = {};
    card.querySelectorAll("select[data-option]").forEach((select) => {
        selected[select.dataset.option] = select.value;
    });
    card.querySelectorAll("input[type=radio][data-option]:checked").forEach((input) => {
        selected[input.dataset.option] = input.value;
    });
    product.options.forEach((option) => {
        if (!(option.name in selected) && option.values.length) {
            selected[option.name] = option.values[0];
        }
    });
    return selected;
}

function currentVariant(card, product) {
    const selected = selectedOptions(card, product);
    return product.variants.find((variant) =>
        Object.entries(selected).every(([key, value]) => variant.options[key] === value)
    );
}

function syncCard(card, product) {
    const price = card.querySelector(".product-price");
    const button = card.querySelector(".add-to-cart");
    const variant = currentVariant(card, product);
    if (!variant) {
        price.textContent = "No disponible";
        button.disabled = true;
        button.textContent = "No disponible";
        return;
    }
    price.textContent = money(variant.price_cents);
    button.disabled = !variant.available;
    button.textContent = variant.available ? "Añadir al carrito" : "Agotado";
    const selected = selectedOptions(card, product);
    const colorName = Object.keys(selected).find((key) => key.trim().toLowerCase() === "color");
    const nameNode = card.querySelector(".swatch-name");
    if (nameNode && colorName) {
        nameNode.textContent = selected[colorName];
    }
    card.querySelectorAll("input[type=radio][data-option]").forEach((input) => {
        const trial = Object.assign({}, selected, { [input.dataset.option]: input.value });
        const match = product.variants.find((item) =>
            Object.entries(trial).every(([key, value]) => item.options[key] === value)
        );
        input.closest(".swatch").classList.toggle("is-off", !match || !match.available);
    });
}

function renderSwatches(card, product, option, initial) {
    const group = el("div", "product-option");
    const heading = el("span", "option-heading");
    heading.append(el("span", null, "Color"));
    heading.append(el("span", "swatch-name", initial.options[option.name] || option.values[0]));
    group.append(heading);

    const swatches = el("div", "swatches");
    swatches.setAttribute("role", "radiogroup");
    swatches.setAttribute("aria-label", "Color");
    option.values.forEach((value) => {
        const item = el("label", "swatch");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `color-${product.id}`;
        input.value = value;
        input.dataset.option = option.name;
        input.setAttribute("aria-label", value);
        if (initial.options[option.name] === value) {
            input.checked = true;
        }
        input.addEventListener("change", () => syncCard(card, product));
        const chip = el("span");
        chip.style.background = swatchBackground(value);
        item.append(input, chip);
        swatches.append(item);
    });
    group.append(swatches);
    return group;
}

function renderProduct(product) {
    const card = el("article", "product-card");
    const image = el("img");
    image.src = product.image;
    image.alt = product.title;
    card.append(image);

    const info = el("div", "product-info");
    info.append(el("h3", null, product.title));
    info.append(el("p", "product-desc", product.description));
    info.append(el("p", "product-price", ""));

    const initial = firstAvailable(product);
    product.options.forEach((option) => {
        if (option.values.length < 2) {
            return;
        }
        if (isColorOption(option)) {
            info.append(renderSwatches(card, product, option, initial));
            return;
        }
        const label = el("label", "product-option");
        label.append(el("span", null, option.name));
        const select = document.createElement("select");
        select.dataset.option = option.name;
        option.values.forEach((value) => {
            const choice = el("option", null, value);
            choice.value = value;
            if (initial.options[option.name] === value) {
                choice.selected = true;
            }
            select.append(choice);
        });
        select.addEventListener("change", () => syncCard(card, product));
        label.append(select);
        info.append(label);
    });

    const qty = document.createElement("input");
    qty.className = "qty-input";
    qty.type = "number";
    qty.min = "1";
    qty.max = "20";
    qty.value = "1";
    qty.setAttribute("aria-label", "Cantidad");

    const button = el("button", "btn btn-primary add-to-cart", "Añadir al carrito");
    button.type = "button";
    button.addEventListener("click", () => {
        const variant = currentVariant(card, product);
        const amount = Math.min(20, Math.max(1, Number.parseInt(qty.value, 10) || 1));
        if (!variant || !variant.available) {
            return;
        }
        const cart = readCart();
        const existing = cart.find((line) => line.productId === product.id && line.variantId === variant.id);
        if (existing) {
            existing.qty = Math.min(20, existing.qty + amount);
        } else {
            cart.push({ productId: product.id, variantId: variant.id, qty: amount });
        }
        writeCart(cart);
        button.textContent = "Añadido";
        window.setTimeout(() => syncCard(card, product), 900);
    });

    info.append(qty, button);
    card.append(info);
    syncCard(card, product);
    return card;
}

async function loadProducts() {
    const grid = document.getElementById("product-grid");
    const status = grid.querySelector(".product-grid-status");
    try {
        const catalog = await loadCatalog();
        grid.replaceChildren();
        catalog.products.forEach((product) => grid.append(renderProduct(product)));
    } catch (error) {
        if (status) {
            status.textContent = "No se han podido cargar los artículos. Recarga la página.";
        }
    }
}

function resolvedCart(catalog) {
    return readCart().map((line) => {
        const product = catalog.products.find((item) => item.id === line.productId);
        const variant = product && product.variants.find((item) => item.id === line.variantId);
        if (!product || !variant) {
            return null;
        }
        return {
            product,
            variant,
            qty: Math.min(20, Math.max(1, Number(line.qty) || 1))
        };
    }).filter(Boolean);
}

function renderCart(catalog) {
    const linesNode = document.getElementById("cart-lines");
    const empty = document.getElementById("cart-empty");
    const form = document.getElementById("checkout-form");
    const totals = document.getElementById("cart-totals");
    if (!linesNode) {
        return;
    }
    const lines = resolvedCart(catalog);
    writeCart(lines.map((line) => ({
        productId: line.product.id,
        variantId: line.variant.id,
        qty: line.qty
    })));
    linesNode.replaceChildren();
    if (!lines.length) {
        empty.hidden = false;
        form.hidden = true;
        return;
    }
    empty.hidden = true;
    form.hidden = false;
    let subtotal = 0;
    lines.forEach((line) => {
        subtotal += line.variant.price_cents * line.qty;
        const row = el("article", "cart-line");
        const image = el("img");
        image.src = line.product.image;
        image.alt = "";
        const info = el("div");
        info.append(el("h2", null, line.product.title));
        info.append(el("p", null, line.variant.label));
        info.append(el("p", null, money(line.variant.price_cents)));
        if (!line.variant.available) {
            info.append(el("p", null, "Esta opción ya no está disponible. Quítala para poder pagar."));
        }
        const actions = el("div", "line-actions");
        const qty = document.createElement("input");
        qty.type = "number";
        qty.min = "1";
        qty.max = "20";
        qty.value = String(line.qty);
        qty.setAttribute("aria-label", "Cantidad");
        qty.addEventListener("change", () => {
            const cart = readCart();
            const match = cart.find((item) => item.productId === line.product.id && item.variantId === line.variant.id);
            if (match) {
                match.qty = Math.min(20, Math.max(1, Number.parseInt(qty.value, 10) || 1));
                writeCart(cart);
                renderCart(catalog);
            }
        });
        const remove = el("button", "link-button", "Quitar");
        remove.type = "button";
        remove.addEventListener("click", () => {
            writeCart(readCart().filter((item) => !(item.productId === line.product.id && item.variantId === line.variant.id)));
            renderCart(catalog);
        });
        actions.append(qty, remove);
        info.append(actions);
        row.append(image, info, el("strong", null, money(line.variant.price_cents * line.qty)));
        linesNode.append(row);
    });
    const shipping = subtotal >= catalog.free_shipping_from_cents || subtotal === 0
        ? 0
        : catalog.shipping_cents;
    totals.replaceChildren();
    totals.append(el("p", null, `Artículos: ${money(subtotal)}`));
    totals.append(el("p", null, shipping === 0 ? "Envío: gratis" : `Envío: ${money(shipping)}`));
    totals.append(el("p", null, `Total: ${money(subtotal + shipping)}`));
    const freeFrom = money(catalog.free_shipping_from_cents);
    totals.append(el("p", null, `Envío a España: ${money(catalog.shipping_cents)}. Gratis desde ${freeFrom}.`));
}

async function loadCartPage() {
    const form = document.getElementById("checkout-form");
    try {
        const catalog = await loadCatalog();
        renderCart(catalog);
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const error = document.getElementById("checkout-error");
            const button = form.querySelector("button[type=submit]");
            error.textContent = "";
            button.disabled = true;
            const payload = {
                items: readCart(),
                empresa: form.empresa.value,
                customer: {
                    name: form.nombre.value,
                    email: form.email.value,
                    phone: form.telefono.value,
                    address: form.direccion.value,
                    city: form.ciudad.value,
                    postalCode: form.cp.value,
                    province: form.provincia.value,
                    notes: form.notas.value
                }
            };
            try {
                const response = await fetch("/api/checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || "No se ha podido iniciar el pago");
                }
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push({ ecommerce: null });
                window.dataLayer.push({
                    event: "begin_checkout",
                    ecommerce: { currency: "EUR" }
                });
                window.location.href = data.redirect;
            } catch (checkoutError) {
                error.textContent = checkoutError.message;
                button.disabled = false;
            }
        });
    } catch (error) {
        document.getElementById("cart-empty").hidden = false;
        document.getElementById("cart-empty").textContent = "No se ha podido abrir el carrito. Recarga la página.";
    }
}

function renderStatus(box, order) {
    const messages = {
        pagado: "Pago recibido. Estamos preparando el pedido y te escribiremos al email que indicaste.",
        pendiente: "Estamos esperando la confirmación del pago.",
        fallido: "El pago no se ha completado. Tu carrito sigue guardado: puedes intentarlo otra vez.",
        cancelado: "El pago se ha cancelado. Tu carrito sigue guardado.",
        revisar: "Hemos recibido un aviso que no cuadra con el pedido. Escríbenos a weark@weark.es con este número."
    };
    box.replaceChildren();
    box.append(el("h1", null, order.estado === "pagado" ? "Pedido confirmado" : "Estado del pago"));
    box.append(el("p", null, messages[order.estado] || "Estamos comprobando el pago."));
    box.append(el("p", null, `Número de pedido: ${order.id}`));
    const list = el("ul");
    order.lineas.forEach((line) => {
        list.append(el("li", null, `${line.cantidad} × ${line.titulo} (${line.opcion}) — ${money(line.total_centimos)}`));
    });
    box.append(list);
    box.append(el("p", null, `Total: ${money(order.total_centimos)}`));
    const back = el("a", "btn btn-primary", order.estado === "pagado" ? "Volver a la tienda" : "Volver al carrito");
    back.href = order.estado === "pagado" ? "index.html" : "carrito.html";
    box.append(back);
}

async function loadPaymentStatus() {
    const box = document.getElementById("payment-status");
    const pedido = new URLSearchParams(window.location.search).get("pedido");
    if (!pedido) {
        box.textContent = "No encontramos el número de pedido.";
        return;
    }
    let announced = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
        const response = await fetch(`/api/pedidos/${encodeURIComponent(pedido)}`);
        if (response.status === 404) {
            box.textContent = "No encontramos ese pedido.";
            return;
        }
        const order = await response.json();
        renderStatus(box, order);
        if (order.estado === "pagado") {
            writeCart([]);
            if (!announced) {
                announced = true;
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push({ ecommerce: null });
                window.dataLayer.push({
                    event: "purchase",
                    ecommerce: {
                        transaction_id: order.id,
                        currency: "EUR",
                        value: order.total_centimos / 100
                    }
                });
            }
            return;
        }
        if (order.estado === "fallido" || order.estado === "cancelado" || order.estado === "revisar") {
            return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    box.append(el("p", null, "Si ya has pagado, guarda el número de pedido. Si en unos minutos no aparece como pagado, escríbenos a weark@weark.es."));
}

updateCartCount();
if (document.getElementById("product-grid")) {
    loadProducts();
}
if (document.getElementById("cart-root")) {
    loadCartPage();
}
if (document.getElementById("payment-status")) {
    loadPaymentStatus();
}
