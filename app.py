import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import smtplib
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from email.message import EmailMessage
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from flask import Flask, Response, abort, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "pedidos.db"
CATALOG_PATH = ROOT / "catalog.json"
MADRID = ZoneInfo("Europe/Madrid")
ORDER_RE = re.compile(r"^WR\d{12}[0-9a-f]{6}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PAGES = {
    "carrito.html",
    "pago-resultado.html",
    "pago-cancelado.html",
    "emerita-ludica.html",
    "arde-lugo.html",
    "robots.txt",
    "sitemap.xml",
    "fav.png",
    "og-image.jpg",
}

log = logging.getLogger("weark")
db_lock = threading.Lock()
rate_lock = threading.Lock()
rate_hits = {}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200_000


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(ROOT / ".env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def load_catalog() -> dict:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    products = {}
    for product in catalog["products"]:
        variants = {variant["id"]: variant for variant in product["variants"]}
        products[product["id"]] = {**product, "variants_by_id": variants}
    catalog["by_id"] = products
    return catalog


CATALOG = load_catalog()


def public_base() -> str:
    return os.environ.get("PUBLIC_BASE_URL", "http://127.0.0.1:8001").rstrip("/")


def payments_are_mock() -> bool:
    return os.environ.get("MONEI_MOCK", "").strip() == "1" and not os.environ.get("MONEI_API_KEY", "").strip()


def now_iso() -> str:
    return datetime.now(MADRID).isoformat(timespec="seconds")


def euros(cents: int) -> str:
    whole, frac = divmod(int(cents), 100)
    grouped = f"{whole:,}".replace(",", ".")
    return f"{grouped},{frac:02d} €"


def client_ip() -> str:
    real = request.headers.get("X-Real-IP", "").strip()
    if real:
        return real
    return request.remote_addr or ""


def too_many_requests(ip: str) -> bool:
    now = datetime.now().timestamp()
    with rate_lock:
        recent = [stamp for stamp in rate_hits.get(ip, []) if now - stamp < 900]
        if len(recent) >= 8:
            rate_hits[ip] = recent
            return True
        recent.append(now)
        rate_hits[ip] = recent
        return False


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    with database() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS pedidos (
                id TEXT PRIMARY KEY,
                creado TEXT NOT NULL,
                actualizado TEXT NOT NULL,
                estado TEXT NOT NULL,
                envio TEXT NOT NULL,
                nombre TEXT NOT NULL,
                email TEXT NOT NULL,
                telefono TEXT NOT NULL,
                direccion TEXT NOT NULL,
                ciudad TEXT NOT NULL,
                cp TEXT NOT NULL,
                provincia TEXT NOT NULL,
                notas TEXT NOT NULL,
                lineas TEXT NOT NULL,
                subtotal_centimos INTEGER NOT NULL,
                envio_centimos INTEGER NOT NULL,
                total_centimos INTEGER NOT NULL,
                monei_id TEXT,
                monei_estado TEXT,
                correo_enviado INTEGER NOT NULL DEFAULT 0
            )
            """
        )


init_db()


def clean_text(value, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def phone_e164(value: str) -> str:
    raw = re.sub(r"[^\d+]", "", value or "")
    if raw.startswith("00"):
        raw = "+" + raw[2:]
    if raw.startswith("+"):
        digits = raw[1:]
        if digits.isdigit() and 10 <= len(digits) <= 15:
            return "+" + digits
        raise ValueError("Teléfono no válido")
    if raw.isdigit() and len(raw) == 9:
        return "+34" + raw
    if raw.isdigit() and len(raw) == 11 and raw.startswith("34"):
        return "+" + raw
    raise ValueError("Teléfono no válido")


def quote_items(items) -> dict:
    if not isinstance(items, list) or not items or len(items) > 30:
        raise ValueError("El carrito está vacío o tiene demasiadas líneas")
    lines = []
    units = 0
    subtotal = 0
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Línea de carrito no válida")
        product = CATALOG["by_id"].get(str(item.get("productId") or ""))
        if not product:
            raise ValueError("Hay un artículo que ya no está en la tienda")
        variant = product["variants_by_id"].get(str(item.get("variantId") or ""))
        if not variant or not variant["available"]:
            raise ValueError(f"{product['title']} no está disponible en esa opción")
        try:
            qty = int(item.get("qty"))
        except (TypeError, ValueError):
            raise ValueError("Cantidad no válida")
        if qty < 1 or qty > 20:
            raise ValueError("La cantidad tiene que estar entre 1 y 20")
        units += qty
        line_total = variant["price_cents"] * qty
        subtotal += line_total
        lines.append(
            {
                "producto": product["id"],
                "variante": variant["id"],
                "titulo": product["title"],
                "opcion": variant["label"],
                "cantidad": qty,
                "precio_centimos": variant["price_cents"],
                "total_centimos": line_total,
            }
        )
    if units > 40:
        raise ValueError("El pedido tiene demasiadas unidades")
    shipping = 0 if subtotal >= CATALOG["free_shipping_from_cents"] else CATALOG["shipping_cents"]
    return {
        "lineas": lines,
        "subtotal_centimos": subtotal,
        "envio_centimos": shipping,
        "total_centimos": subtotal + shipping,
    }


def customer_from(payload: dict) -> dict:
    data = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
    name = clean_text(data.get("name"), 80)
    email = clean_text(data.get("email"), 120).lower()
    address = clean_text(data.get("address"), 140)
    city = clean_text(data.get("city"), 60)
    province = clean_text(data.get("province"), 40)
    postal = re.sub(r"\s+", "", clean_text(data.get("postalCode"), 10))
    notes = clean_text(data.get("notes"), 500)
    if len(name) < 3:
        raise ValueError("Escribe tu nombre y apellidos")
    if not EMAIL_RE.match(email):
        raise ValueError("El email no es válido")
    phone = phone_e164(clean_text(data.get("phone"), 20))
    if len(address) < 5 or len(city) < 2 or len(province) < 2:
        raise ValueError("Completa la dirección de envío")
    if not re.fullmatch(r"\d{5}", postal):
        raise ValueError("El código postal tiene que tener 5 cifras")
    return {
        "nombre": name,
        "email": email,
        "telefono": phone,
        "direccion": address,
        "ciudad": city,
        "cp": postal,
        "provincia": province,
        "notas": notes,
    }


def new_order_id() -> str:
    stamp = datetime.now(MADRID).strftime("%y%m%d%H%M%S")
    return f"WR{stamp}{secrets.token_hex(3)}"


def insert_order(order_id: str, customer: dict, quote: dict) -> None:
    stamp = now_iso()
    with db_lock:
        with database() as connection:
            connection.execute(
                """
                INSERT INTO pedidos (
                    id, creado, actualizado, estado, envio, nombre, email, telefono,
                    direccion, ciudad, cp, provincia, notas, lineas,
                    subtotal_centimos, envio_centimos, total_centimos
                ) VALUES (?, ?, ?, 'pendiente', 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_id,
                    stamp,
                    stamp,
                    customer["nombre"],
                    customer["email"],
                    customer["telefono"],
                    customer["direccion"],
                    customer["ciudad"],
                    customer["cp"],
                    customer["provincia"],
                    customer["notas"],
                    json.dumps(quote["lineas"], ensure_ascii=False),
                    quote["subtotal_centimos"],
                    quote["envio_centimos"],
                    quote["total_centimos"],
                ),
            )


def get_order(order_id: str):
    with database() as connection:
        row = connection.execute("SELECT * FROM pedidos WHERE id = ?", (order_id,)).fetchone()
    return dict(row) if row else None


def monei_request(method: str, path: str, body: dict | None = None) -> dict:
    key = os.environ.get("MONEI_API_KEY", "").strip()
    response = requests.request(
        method,
        "https://api.monei.com/v1" + path,
        headers={"Authorization": key, "Content-Type": "application/json"},
        json=body,
        timeout=25,
    )
    try:
        data = response.json()
    except ValueError:
        data = {}
    if response.status_code >= 400:
        message = data.get("message") if isinstance(data, dict) else ""
        log.error("MONEI %s %s -> %s %s", method, path, response.status_code, message)
        raise RuntimeError(message or "MONEI ha rechazado el pago")
    return data


def create_monei_payment(order_id: str, customer: dict, total: int) -> str:
    base = public_base()
    payload = {
        "amount": total,
        "currency": "EUR",
        "orderId": order_id,
        "description": f"Trajes romanos {order_id}",
        "transactionType": "SALE",
        "callbackUrl": f"{base}/api/monei/aviso",
        "completeUrl": f"{base}/pago-resultado.html?pedido={order_id}",
        "failUrl": f"{base}/pago-resultado.html?pedido={order_id}",
        "cancelUrl": f"{base}/pago-cancelado.html?pedido={order_id}",
        "customer": {
            "name": customer["nombre"],
            "email": customer["email"],
            "phone": customer["telefono"],
        },
        "billingDetails": {
            "name": customer["nombre"],
            "email": customer["email"],
            "phone": customer["telefono"],
            "address": {
                "country": "ES",
                "city": customer["ciudad"],
                "line1": customer["direccion"],
                "zip": customer["cp"],
                "state": customer["provincia"],
            },
        },
        "shippingDetails": {
            "name": customer["nombre"],
            "phone": customer["telefono"],
            "address": {
                "country": "ES",
                "city": customer["ciudad"],
                "line1": customer["direccion"],
                "zip": customer["cp"],
                "state": customer["provincia"],
            },
        },
        "metadata": {"tienda": "trajesromanos"},
        "sessionDetails": {"lang": "es", **({"ip": client_ip()} if client_ip() else {})},
    }
    store_id = os.environ.get("MONEI_STORE_ID", "").strip()
    if store_id:
        payload["storeId"] = store_id
    payment = monei_request("POST", "/payments", payload)
    action = payment.get("nextAction") or {}
    redirect = action.get("redirectUrl")
    monei_id = str(payment.get("id") or "")
    if monei_id:
        with db_lock:
            with database() as connection:
                connection.execute(
                    "UPDATE pedidos SET monei_id = ?, actualizado = ? WHERE id = ?",
                    (monei_id, now_iso(), order_id),
                )
    if not redirect:
        raise RuntimeError("MONEI no ha devuelto la página de pago")
    return redirect


def verify_signature(raw: bytes, header: str, api_key: str) -> dict:
    timestamp = ""
    signatures = []
    for part in header.split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)
    if not timestamp or not signatures:
        raise ValueError("Firma incompleta")
    signed = timestamp.encode("utf-8") + b"." + raw
    expected = hmac.new(api_key.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, item) for item in signatures):
        raise ValueError("Firma no válida")
    return json.loads(raw.decode("utf-8"))


def apply_payment(order_id: str, payment: dict) -> bool:
    status = str(payment.get("status") or "")
    monei_id = str(payment.get("id") or "")
    stamp = now_iso()
    send_email = False
    with db_lock:
        with database() as connection:
            row = connection.execute("SELECT * FROM pedidos WHERE id = ?", (order_id,)).fetchone()
            if row is None:
                raise LookupError(order_id)
            order_ok = str(payment.get("orderId") or "") == order_id
            try:
                amount_ok = int(payment.get("amount")) == row["total_centimos"]
            except (TypeError, ValueError):
                amount_ok = False
            final = status in {"SUCCEEDED", "FAILED", "CANCELED", "CANCELLED", "EXPIRED"}
            if final and (not order_ok or not amount_ok or payment.get("currency") not in (None, "EUR")):
                connection.execute(
                    """
                    UPDATE pedidos
                    SET estado = 'revisar', monei_id = COALESCE(NULLIF(?, ''), monei_id),
                        monei_estado = ?, actualizado = ?
                    WHERE id = ? AND estado != 'pagado'
                    """,
                    (monei_id, status, stamp, order_id),
                )
            elif status == "SUCCEEDED":
                cursor = connection.execute(
                    """
                    UPDATE pedidos
                    SET estado = 'pagado', monei_id = ?, monei_estado = ?, actualizado = ?, correo_enviado = 1
                    WHERE id = ? AND estado != 'pagado'
                    """,
                    (monei_id, status, stamp, order_id),
                )
                send_email = cursor.rowcount == 1
            elif status in {"FAILED", "EXPIRED"} and row["estado"] == "pendiente":
                connection.execute(
                    """
                    UPDATE pedidos SET estado = 'fallido', monei_id = ?, monei_estado = ?, actualizado = ?
                    WHERE id = ? AND estado = 'pendiente'
                    """,
                    (monei_id, status, stamp, order_id),
                )
            elif status in {"CANCELED", "CANCELLED"} and row["estado"] == "pendiente":
                connection.execute(
                    """
                    UPDATE pedidos SET estado = 'cancelado', monei_id = ?, monei_estado = ?, actualizado = ?
                    WHERE id = ? AND estado = 'pendiente'
                    """,
                    (monei_id, status, stamp, order_id),
                )
            else:
                connection.execute(
                    """
                    UPDATE pedidos
                    SET monei_id = COALESCE(NULLIF(?, ''), monei_id), monei_estado = ?, actualizado = ?
                    WHERE id = ?
                    """,
                    (monei_id, status, stamp, order_id),
                )
    if send_email:
        order = get_order(order_id)
        if order:
            try:
                send_order_emails(order)
            except Exception:
                log.exception("No se pudo enviar el correo del pedido %s", order_id)
    return send_email


def refresh_order(order: dict) -> dict:
    if order["estado"] == "pagado":
        return order
    if payments_are_mock():
        apply_payment(
            order["id"],
            {
                "id": order.get("monei_id") or "mock",
                "status": "SUCCEEDED",
                "amount": order["total_centimos"],
                "currency": "EUR",
                "orderId": order["id"],
            },
        )
        return get_order(order["id"]) or order
    if not order.get("monei_id") or not os.environ.get("MONEI_API_KEY", "").strip():
        return order
    try:
        payment = monei_request("GET", "/payments/" + order["monei_id"])
    except Exception:
        log.exception("No se pudo consultar el pago %s", order["id"])
        return order
    apply_payment(order["id"], payment)
    return get_order(order["id"]) or order


def send_order_emails(order: dict) -> None:
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        log.info("Pedido %s pagado. SMTP no configurado: el aviso queda solo en /admin", order["id"])
        return
    lines = json.loads(order["lineas"])
    detail = "\n".join(
        f"- {line['cantidad']} x {line['titulo']} ({line['opcion']}): {euros(line['total_centimos'])}"
        for line in lines
    )
    body = (
        f"Pedido {order['id']} pagado.\n\n"
        f"{detail}\n\n"
        f"Artículos: {euros(order['subtotal_centimos'])}\n"
        f"Envío: {euros(order['envio_centimos'])}\n"
        f"Total: {euros(order['total_centimos'])}\n\n"
        f"{order['nombre']}\n{order['email']}\n{order['telefono']}\n"
        f"{order['direccion']}\n{order['cp']} {order['ciudad']} ({order['provincia']})\n"
    )
    if order["notas"]:
        body += f"\nNotas: {order['notas']}\n"
    message = EmailMessage()
    message["Subject"] = f"Pedido {order['id']} pagado"
    message["From"] = os.environ.get("SMTP_FROM", "").strip() or os.environ.get("SMTP_USER", "")
    shop = os.environ.get("SHOP_NOTIFY_EMAIL", "").strip()
    recipients = [address for address in (order["email"], shop) if address]
    message["To"] = ", ".join(recipients)
    message.set_content(
        "Hemos recibido el pago de tu pedido de trajes romanos.\n\n" + body
        + "\nWeark Custom Tovar S.L.\nweark@weark.es\n"
    )
    port = int(os.environ.get("SMTP_PORT", "587") or "587")
    with smtplib.SMTP(host, port, timeout=20) as smtp:
        smtp.starttls()
        user = os.environ.get("SMTP_USER", "").strip()
        password = os.environ.get("SMTP_PASSWORD", "")
        if user:
            smtp.login(user, password)
        smtp.send_message(message)


def public_order(order: dict) -> dict:
    lines = json.loads(order["lineas"])
    return {
        "id": order["id"],
        "estado": order["estado"],
        "subtotal_centimos": order["subtotal_centimos"],
        "envio_centimos": order["envio_centimos"],
        "total_centimos": order["total_centimos"],
        "lineas": [
            {
                "titulo": line["titulo"],
                "opcion": line["opcion"],
                "cantidad": line["cantidad"],
                "total_centimos": line["total_centimos"],
            }
            for line in lines
        ],
    }


def require_admin():
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not password:
        abort(404)
    auth = request.authorization
    user_ok = auth is not None and auth.username == "weark"
    pass_ok = auth is not None and hmac.compare_digest(auth.password or "", password)
    if not (user_ok and pass_ok):
        return Response(
            "Acceso restringido",
            401,
            {"WWW-Authenticate": 'Basic realm="Pedidos WEARK"'},
        )
    return None


def admin_layout(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <style>
    body {{ font-family: Georgia, serif; margin: 2rem; color: #2c2a27; background: #f8f4ec; }}
    a {{ color: #5a1f1f; }}
    table {{ border-collapse: collapse; width: 100%; background: #fff; }}
    th, td {{ border-bottom: 1px solid #e6dccb; text-align: left; padding: 0.55rem; vertical-align: top; }}
    .panel {{ background: #fff; padding: 1rem; border-radius: 10px; }}
  </style>
</head>
<body>
  <p><a href="/admin">Pedidos</a></p>
  <h1>{escape(title)}</h1>
  {body}
</body>
</html>"""


@app.after_request
def no_store(response):
    if request.path.startswith("/api/") or request.path.startswith("/admin"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/productos")
def productos():
    return jsonify(
        {
            "currency": CATALOG["currency"],
            "shipping_cents": CATALOG["shipping_cents"],
            "free_shipping_from_cents": CATALOG["free_shipping_from_cents"],
            "products": CATALOG["products"],
        }
    )


@app.post("/api/checkout")
def checkout():
    if not request.is_json:
        return jsonify(error="El pedido no es válido"), 400
    payload = request.get_json(silent=True) or {}
    if clean_text(payload.get("empresa"), 80):
        return jsonify(error="No se ha podido iniciar el pago"), 400
    if too_many_requests(client_ip() or "desconocida"):
        return jsonify(error="Demasiados intentos. Espera unos minutos."), 429
    if not payments_are_mock() and not os.environ.get("MONEI_API_KEY", "").strip():
        return jsonify(error="El pago todavía no está configurado. Escríbenos por WhatsApp."), 503
    try:
        customer = customer_from(payload)
        quote = quote_items(payload.get("items"))
    except ValueError as error:
        return jsonify(error=str(error)), 400
    order_id = new_order_id()
    insert_order(order_id, customer, quote)
    if payments_are_mock():
        with db_lock:
            with database() as connection:
                connection.execute(
                    "UPDATE pedidos SET monei_id = 'mock', actualizado = ? WHERE id = ?",
                    (now_iso(), order_id),
                )
        return jsonify(redirect=f"/pago-resultado.html?pedido={order_id}", pedido=order_id)
    try:
        redirect = create_monei_payment(order_id, customer, quote["total_centimos"])
    except Exception as error:
        log.exception("No se pudo crear el pago %s", order_id)
        with db_lock:
            with database() as connection:
                connection.execute(
                    "UPDATE pedidos SET estado = 'fallido', actualizado = ? WHERE id = ? AND estado = 'pendiente'",
                    (now_iso(), order_id),
                )
        message = "No se ha podido abrir el pago. Inténtalo de nuevo."
        if str(error):
            log.error("Detalle MONEI: %s", error)
        return jsonify(error=message), 502
    return jsonify(redirect=redirect, pedido=order_id)


@app.get("/api/pedidos/<order_id>")
def pedido(order_id: str):
    if not ORDER_RE.fullmatch(order_id):
        abort(404)
    order = get_order(order_id)
    if not order:
        abort(404)
    order = refresh_order(order)
    return jsonify(public_order(order))


@app.post("/api/monei/aviso")
def aviso_monei():
    key = os.environ.get("MONEI_API_KEY", "").strip()
    if not key:
        return jsonify(error="Sin clave"), 500
    raw = request.get_data(cache=True) or b""
    try:
        payload = verify_signature(raw, request.headers.get("MONEI-Signature", ""), key)
    except (ValueError, json.JSONDecodeError):
        return jsonify(error="Firma no válida"), 401
    payment = payload.get("object") if isinstance(payload.get("object"), dict) else payload
    order_id = str(payment.get("orderId") or "")
    if not ORDER_RE.fullmatch(order_id):
        return jsonify(received=True)
    try:
        apply_payment(order_id, payment)
    except LookupError:
        log.warning("Aviso de un pedido que no es de esta tienda: %s", order_id)
    return jsonify(received=True)


@app.get("/admin")
def admin():
    denied = require_admin()
    if denied:
        return denied
    with database() as connection:
        rows = connection.execute("SELECT * FROM pedidos ORDER BY creado DESC LIMIT 200").fetchall()
    body = ["<table><tr><th>Pedido</th><th>Fecha</th><th>Estado</th><th>Envío</th><th>Total</th><th>Cliente</th></tr>"]
    for row in rows:
        body.append(
            "<tr>"
            f"<td><a href=\"/admin/pedido/{escape(row['id'])}\">{escape(row['id'])}</a></td>"
            f"<td>{escape(row['creado'])}</td>"
            f"<td>{escape(row['estado'])}</td>"
            f"<td>{escape(row['envio'])}</td>"
            f"<td>{euros(row['total_centimos'])}</td>"
            f"<td>{escape(row['nombre'])}<br>{escape(row['email'])}</td>"
            "</tr>"
        )
    if not rows:
        body.append("<tr><td colspan='6'>Todavía no hay pedidos.</td></tr>")
    body.append("</table>")
    return admin_layout("Pedidos", "".join(body))


@app.get("/admin/pedido/<order_id>")
def admin_pedido(order_id: str):
    denied = require_admin()
    if denied:
        return denied
    order = get_order(order_id)
    if not order:
        abort(404)
    lines = json.loads(order["lineas"])
    items = "".join(
        f"<li>{line['cantidad']} × {escape(line['titulo'])} ({escape(line['opcion'])}) — {euros(line['total_centimos'])}</li>"
        for line in lines
    )
    shipped = ""
    if order["estado"] == "pagado" and order["envio"] != "enviado":
        shipped = f"<form method='post' action='/admin/pedido/{escape(order_id)}/enviado'><button type='submit'>Marcar como enviado</button></form>"
    body = f"""
    <div class="panel">
      <p>Estado del pago: <strong>{escape(order['estado'])}</strong> ({escape(order['monei_estado'] or 'sin aviso')})</p>
      <p>Preparación: <strong>{escape(order['envio'])}</strong></p>
      <p>MONEI: {escape(order['monei_id'] or '')}</p>
      <ul>{items}</ul>
      <p>Artículos {euros(order['subtotal_centimos'])} · Envío {euros(order['envio_centimos'])} · Total {euros(order['total_centimos'])}</p>
      <p>{escape(order['nombre'])}<br>{escape(order['email'])}<br>{escape(order['telefono'])}<br>
      {escape(order['direccion'])}<br>{escape(order['cp'])} {escape(order['ciudad'])} ({escape(order['provincia'])})</p>
      <p>Notas: {escape(order['notas'] or '—')}</p>
      {shipped}
    </div>
    """
    return admin_layout(order_id, body)


@app.post("/admin/pedido/<order_id>/enviado")
def admin_enviado(order_id: str):
    denied = require_admin()
    if denied:
        return denied
    with db_lock:
        with database() as connection:
            connection.execute(
                "UPDATE pedidos SET envio = 'enviado', actualizado = ? WHERE id = ? AND estado = 'pagado'",
                (now_iso(), order_id),
            )
    return Response(status=303, headers={"Location": f"/admin/pedido/{order_id}"})


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:name>")
def files(name: str):
    candidate = (ROOT / name).resolve()
    if not candidate.is_relative_to(ROOT) or not candidate.is_file():
        abort(404)
    if name.startswith("static/") or name in PAGES:
        return send_from_directory(ROOT, name)
    abort(404)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8001")), debug=False)
