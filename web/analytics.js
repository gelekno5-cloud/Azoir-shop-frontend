/* Azoir & Co. — GA4 with consent (Google Consent Mode v2 + a small banner).
   Analytics only loads AFTER the visitor accepts. Set GA_ID below. */
(function () {
  var GA_ID = "G-DJVC5Y7EPF"; // <-- replace with your GA4 Measurement ID
  var KEY = "azoir_consent";

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  // Default: deny everything until the visitor chooses.
  gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  function loadGA() {
    if (!GA_ID || GA_ID.indexOf("XXXX") !== -1 || window.__gaLoaded) return;
    window.__gaLoaded = true;
    gtag("consent", "update", { analytics_storage: "granted" });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    gtag("js", new Date());
    gtag("config", GA_ID, { anonymize_ip: true });
  }

  var choice = null;
  try { choice = localStorage.getItem(KEY); } catch (e) {}
  if (choice === "granted") { loadGA(); return; }
  if (choice === "denied") return;

  // First visit — show the banner.
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function build() {
    var bar = document.createElement("div");
    bar.className = "consent";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookie consent");
    bar.innerHTML =
      '<p>We use cookies to understand how this site is used. You can accept or decline analytics.' +
      ' See our <a href="/privacy.html">Privacy Policy</a>.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn-outline sm" data-c="decline">Decline</button>' +
      '<button type="button" class="btn-fill sm" data-c="accept">Accept</button>' +
      "</div>";
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-c]");
      if (!b) return;
      if (b.getAttribute("data-c") === "accept") { save("granted"); loadGA(); }
      else { save("denied"); }
      bar.remove();
    });
    document.body.appendChild(bar);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
