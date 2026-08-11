const labsInterestForm = document.querySelector("[data-labs-interest-form]");
const labsInterestStatus = document.querySelector("[data-labs-interest-status]");

if (labsInterestForm && labsInterestStatus) {
  labsInterestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const endpoint = String(labsInterestForm.dataset.formEndpoint || "").trim();
    const submitButton = labsInterestForm.querySelector('button[type="submit"]');

    if (!endpoint) {
      labsInterestStatus.textContent =
        "This draft form is not connected yet. Add the Formspree endpoint before publishing.";
      labsInterestStatus.dataset.state = "draft";
      return;
    }

    labsInterestStatus.textContent = "";
    labsInterestStatus.dataset.state = "";
    if (submitButton) submitButton.disabled = true;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { accept: "application/json" },
        body: new FormData(labsInterestForm),
      });

      if (!response.ok) throw new Error("Lab inquiry submission failed.");

      labsInterestStatus.textContent = "Thanks! We'll be in touch by email.";
      labsInterestStatus.dataset.state = "success";
      labsInterestForm.reset();
    } catch {
      labsInterestStatus.textContent =
        "Your inquiry could not be sent. Please try again in a moment.";
      labsInterestStatus.dataset.state = "error";
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
