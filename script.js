const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const menuToggle = document.querySelector("[data-menu-toggle]");
const siteNav = document.querySelector("[data-site-nav]");
const siteHeader = document.querySelector(".site-header");

if (menuToggle && siteNav && siteHeader) {
  const closeMenu = () => {
    siteHeader.classList.remove("is-menu-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open menu");
  };

  menuToggle.addEventListener("click", () => {
    const isOpen = siteHeader.classList.toggle("is-menu-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  });

  siteNav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!siteHeader.contains(event.target)) closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 941px)").matches) closeMenu();
  });
}

const updatesForm = document.querySelector("[data-updates-form]");
const updatesStatus = document.querySelector("[data-updates-status]");
const updatesMessages = {
  invalid_email: "Enter a valid email address.",
  subscription_unavailable: "Updates signup is not configured yet.",
  mailer_auth_failed: "Updates signup is not configured yet.",
  mailer_forbidden: "Updates signup is not configured yet.",
  mailer_invalid_group: "Updates signup is not configured yet.",
  mailer_validation_failed: "Updates signup is not configured yet.",
  mailer_rate_limited: "Signup is busy. Please try again in a minute.",
  subscription_failed: "Signup failed. Please try again in a moment.",
  success: "Just added you to the updates list. Thanks.",
};

if (updatesForm && updatesStatus) {
  updatesForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = updatesForm.querySelector('button[type="submit"]');

    if (window.location.protocol === "file:") {
      updatesStatus.textContent = updatesMessages.subscription_unavailable;
      updatesStatus.dataset.state = "error";
      return;
    }

    const formData = new FormData(updatesForm);
    const payload = {
      email: String(formData.get("email") || ""),
      name: String(formData.get("name") || ""),
      website: String(formData.get("website") || ""),
    };

    updatesStatus.textContent = "";
    updatesStatus.dataset.state = "";
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok && result.ok) {
        updatesStatus.textContent = updatesMessages.success;
        updatesStatus.dataset.state = "success";
        updatesForm.reset();
        return;
      }

      const message = updatesMessages[result.error] || updatesMessages.subscription_failed;
      updatesStatus.textContent = message;
      updatesStatus.dataset.state = "error";
    } catch {
      updatesStatus.textContent = updatesMessages.subscription_failed;
      updatesStatus.dataset.state = "error";
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

const feedbackForm = document.querySelector("[data-feedback-form]");
const feedbackStatus = document.querySelector("[data-feedback-status]");

if (feedbackForm && feedbackStatus) {
  feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = feedbackForm.querySelector('button[type="submit"]');
    const defaultButtonText = "Send feedback";

    feedbackStatus.textContent = "";
    feedbackStatus.dataset.state = "";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending…";
    }

    try {
      const response = await fetch("https://formspree.io/f/mlgzbqdk", {
        method: "POST",
        headers: { accept: "application/json" },
        body: new FormData(feedbackForm),
      });

      if (response.ok) {
        feedbackStatus.textContent = "Thanks for your feedback.";
        feedbackStatus.dataset.state = "success";
        feedbackForm.reset();
        return;
      }

      feedbackStatus.textContent = "Feedback failed. Please try again in a moment.";
      feedbackStatus.dataset.state = "error";
    } catch {
      feedbackStatus.textContent = "Feedback failed. Please try again in a moment.";
      feedbackStatus.dataset.state = "error";
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = defaultButtonText;
      }
    }
  });
}
