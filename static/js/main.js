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
