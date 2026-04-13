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
