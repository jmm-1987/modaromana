const menuToggle = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");

if (menuToggle && navLinks) {
    menuToggle.addEventListener("click", () => {
        navLinks.classList.toggle("open");
    });

    navLinks.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => navLinks.classList.remove("open"));
    });
}

const modalTriggers = document.querySelectorAll("[data-modal-open]");
const modalClosers = document.querySelectorAll("[data-modal-close]");

function closeModal(modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
}

function openModal(modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
}

modalTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
        const modalId = trigger.getAttribute("data-modal-open");
        const modal = document.getElementById(modalId);
        if (modal) {
            openModal(modal);
        }
    });
});

modalClosers.forEach((closer) => {
    closer.addEventListener("click", () => {
        const modal = closer.closest(".modal-overlay");
        if (modal) {
            closeModal(modal);
        }
    });
});

document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeModal(modal);
        }
    });
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        document.querySelectorAll(".modal-overlay.open").forEach((modal) => closeModal(modal));
    }
});

const cookieBanner = document.getElementById("cookie-banner");
const cookieAccept = document.getElementById("cookie-accept");
const cookieReject = document.getElementById("cookie-reject");
const cookieStorageKey = "weark_cookie_consent";

function hideCookieBanner() {
    if (cookieBanner) {
        cookieBanner.classList.add("hidden");
    }
}

if (cookieBanner) {
    const storedCookieChoice = localStorage.getItem(cookieStorageKey);
    if (storedCookieChoice === "accepted" || storedCookieChoice === "rejected") {
        hideCookieBanner();
    }
}

if (cookieAccept) {
    cookieAccept.addEventListener("click", () => {
        localStorage.setItem(cookieStorageKey, "accepted");
        hideCookieBanner();
    });
}

if (cookieReject) {
    cookieReject.addEventListener("click", () => {
        localStorage.setItem(cookieStorageKey, "rejected");
        hideCookieBanner();
    });
}

document.addEventListener("click", (event) => {
    const productImage = event.target.closest(".shopify-buy__product-img-wrapper, .shopify-buy__product-img");
    if (!productImage) {
        return;
    }

    const productCard = productImage.closest(".product-card");
    if (!productCard) {
        return;
    }

    const viewButton = productCard.querySelector(".shopify-buy__btn");
    if (viewButton) {
        viewButton.click();
    }
});

const testimonialsTrack = document.querySelector(".testimonials-track");
const testimonialPrev = document.querySelector(".testimonial-prev");
const testimonialNext = document.querySelector(".testimonial-next");

function moveTestimonials(direction) {
    if (!testimonialsTrack) {
        return;
    }

    const firstCard = testimonialsTrack.querySelector(".testimonial-card");
    if (!firstCard) {
        return;
    }

    const cardWidth = firstCard.getBoundingClientRect().width;
    const trackStyles = window.getComputedStyle(testimonialsTrack);
    const cardGap = parseFloat(trackStyles.columnGap) || 16;
    const scrollStep = cardWidth + cardGap;

    testimonialsTrack.scrollBy({
        left: direction * scrollStep,
        behavior: "smooth"
    });
}

if (testimonialPrev) {
    testimonialPrev.addEventListener("click", () => moveTestimonials(-1));
}

if (testimonialNext) {
    testimonialNext.addEventListener("click", () => moveTestimonials(1));
}

function getCheckoutSubtotalFromDom() {
    const subtotalNode = document.querySelector(
        ".shopify-buy__cart__subtotal__price, .shopify-buy__cart__subtotal, .shopify-buy__cart__footer .shopify-buy__cart__subtotal__price"
    );
    if (!subtotalNode) {
        return null;
    }

    const text = (subtotalNode.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) {
        return null;
    }

    // Normaliza formatos tipo "1.234,56 €" o "1234.56 EUR" a número.
    const numeric = text
        .replace(/[^\d,.\-]/g, "")
        .replace(/\.(?=.*\.)/g, "")
        .replace(",", ".");
    const value = Number.parseFloat(numeric);
    return Number.isFinite(value) ? value : null;
}

function getCheckoutAttemptId() {
    const key = "weark_checkout_attempt_seq";
    const current = Number.parseInt(localStorage.getItem(key) || "0", 10) || 0;
    const next = current + 1;
    localStorage.setItem(key, String(next));
    return `attempt-${Date.now()}-${next}`;
}

function pushCheckoutTrackingData() {
    const transactionTotal = getCheckoutSubtotalFromDom();
    const transactionId = getCheckoutAttemptId();
    const value = transactionTotal ?? 0;

    window.dataLayer = window.dataLayer || [];

    // Compatibilidad con el snippet antiguo (mismas claves que el Liquid de Shopify).
    window.dataLayer.push({
        transactionTotal: value,
        transactionId
    });

    // Evento GA4 recomendado vía dataLayer (GTM puede mapearlo a GA4: begin_checkout).
    // Limpia ecommerce previo (patrón habitual en GTM para evitar “herencia” de datos).
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({
        event: "begin_checkout",
        transactionId,
        ecommerce: {
            currency: "EUR",
            value,
            // items: [] se puede rellenar más adelante si se leen líneas del carrito en el DOM.
            items: []
        }
    });
}

document.addEventListener("click", (event) => {
    const checkoutButton = event.target.closest(
        ".shopify-buy__btn--cart-checkout, .shopify-buy__cart__checkout, .shopify-buy__cart__footer .shopify-buy__btn"
    );

    if (!checkoutButton) {
        return;
    }

    pushCheckoutTrackingData();
});
