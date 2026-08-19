// Iceni — accent rengi seçici
//
// Temel: catppuccin/spicetify theme.js
// Iceni'de değişenler:
//   - assets/ düz yapıya alındı (tek flavor), marketplace/local yol ayrımı kaldırıldı
//   - 1ms'lik setInterval polling → MutationObserver
//   - Boşa React render'ı yapan "hotload" hack'i yerine doğrudan applyAccent() çağrısı
//   - localStorage anahtarı iceni:accent (catppuccin ayarından otomatik taşınır)

(function iceni() {
  if (!(Spicetify?.React && Spicetify?.ReactDOM && Spicetify?.Platform?.History)) {
    setTimeout(iceni, 100);
    return;
  }

  const STORAGE_KEY = "iceni:accent";
  const LEGACY_KEY = "catppuccin-accentColor";

  const ACCENTS = [
    "none", "rosewater", "flamingo", "pink", "maroon", "red", "peach",
    "yellow", "green", "teal", "sapphire", "blue", "sky", "mauve", "lavender",
  ];

  // Daha önce catppuccin kullanıldıysa seçili accent'i devral
  if (!localStorage.getItem(STORAGE_KEY)) {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && ACCENTS.includes(legacy)) localStorage.setItem(STORAGE_KEY, legacy);
  }

  const readAccent = () => localStorage.getItem(STORAGE_KEY) ?? "none";

  // Accent'i belgeye uygula. "none" → color.ini'deki varsayılanlara düş.
  function applyAccent(accent) {
    const root = document.documentElement;
    const equalizer = accent === "none" ? "text" : accent;

    root.style.setProperty(
      "--spice-equalizer",
      `url('equalizer-animated-${equalizer}.gif')`
    );

    for (const prop of ["--spice-text", "--spice-button-active"]) {
      if (accent === "none") root.style.removeProperty(prop);
      else root.style.setProperty(prop, `var(--spice-${accent})`);
    }
  }

  applyAccent(readAccent());

  // ─── Ayarlar sayfasındaki bölüm ────────────────────────────────────
  const Section = Spicetify.React.memo(() => {
    const [accent, setAccent] = Spicetify.React.useState(readAccent);

    Spicetify.React.useEffect(() => {
      applyAccent(accent);
      localStorage.setItem(STORAGE_KEY, accent);
    }, [accent]);

    const { createElement: h } = Spicetify.React;

    return h("div", { className: "x-settings-section" }, [
      h("h2", {
        key: "title",
        "data-encore-id": "type",
        className: "TextElement-bodyMediumBold-textBase-text encore-text-body-medium-bold",
      }, "Iceni"),
      h("div", { key: "row", className: "x-settings-row" }, [
        h("div", { key: "c1", className: "x-settings-firstColumn" },
          h("label", {
            htmlFor: "iceni.accent",
            className: "TextElement-bodySmall-textSubdued-text encore-text-body-small",
            "data-encore-id": "type",
          }, "Accent rengi")
        ),
        h("div", { key: "c2", className: "x-settings-secondColumn" },
          h("span", null,
            h("select", {
              className: "main-dropDown-dropDown",
              id: "iceni.accent",
              dir: "auto",
              value: accent,
              onChange: (e) => setAccent(e.target.value),
            }, ACCENTS.map((a) => h("option", { key: a, value: a }, a)))
          )
        ),
      ]),
    ]);
  });

  // Ayarlar sayfası DOM'a girdiğinde bölümü enjekte et
  const HEADER_SELECTOR =
    "[data-testid='settings-page'] > div:first-of-type, .x-settings-headerContainer";

  function mountInto(header) {
    if (!header || header.parentNode.querySelector(".iceni-settings")) return;
    const container = document.createElement("div");
    container.className = "iceni-settings";
    Spicetify.ReactDOM.render(Spicetify.React.createElement(Section), container);
    header.parentNode.insertBefore(container, header.nextSibling);
  }

  let observer = null;

  function insertOption(pathname) {
    observer?.disconnect();
    if (pathname !== "/preferences") return;

    const existing = document.querySelector(HEADER_SELECTOR);
    if (existing) return mountInto(existing);

    observer = new MutationObserver(() => {
      const header = document.querySelector(HEADER_SELECTOR);
      if (header) {
        observer.disconnect();
        mountInto(header);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  insertOption(Spicetify.Platform.History.location?.pathname);
  Spicetify.Platform.History.listen((e) => insertOption(e.pathname));
})();
