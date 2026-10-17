// Vue plugin: one shared tooltip for the page; any element with data-hint="..." gets it.
/** One shared tooltip for every [data-hint] element: on hover, on keyboard focus, and on tap. */
function initHints() {
  const tip = document.createElement("div");
  tip.className = "tip"; tip.id = "hintTip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.body.append(tip);
  let cur = null, timer = 0, touch = false;
  // a tap on a review tile selects it, and the drawer then shows what its hint says
  const tapSelects = (el) => touch && el.closest(".tile");
  const place = (el) => {
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 8;
    const left = Math.max(m, Math.min(window.innerWidth - w - m, r.left));
    const top = r.bottom + m + h > window.innerHeight ? r.top - h - m : r.bottom + m;
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(m, top)}px`;
  };
  const show = (el) => {
    const text = el.dataset.hint; if (!text) return;
    cur = el; tip.textContent = text; tip.hidden = false; place(el);
    el.setAttribute("aria-describedby", "hintTip");
  };
  const hide = () => { clearTimeout(timer); if (cur) cur.removeAttribute("aria-describedby"); cur = null; tip.hidden = true; };
  document.addEventListener("pointerdown", (e) => { touch = e.pointerType !== "mouse"; }, { capture: true });
  document.addEventListener("pointerover", (e) => {
    touch = e.pointerType !== "mouse";
    const el = e.target.closest?.("[data-hint]");
    if (el === cur) return;
    hide();
    if (el && el.dataset.hint && !tapSelects(el)) timer = setTimeout(() => show(el), e.pointerType === "mouse" ? 350 : 0);
  });
  document.addEventListener("pointerleave", hide);
  document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-hint]"); hide(); if (el && !tapSelects(el)) show(el); });
  document.addEventListener("keydown", () => { touch = false; }, { capture: true });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, { passive: true, capture: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}

export default { install() { initHints(); } };
