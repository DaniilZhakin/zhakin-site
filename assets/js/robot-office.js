(() => {
  "use strict";
  const grid = document.querySelector("[data-robot-grid]");
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll(".robot-card"));
  const filters = Array.from(document.querySelectorAll("[data-robot-filter]"));
  const search = document.querySelector("[data-robot-search]");
  const results = document.querySelector("[data-robot-results]");
  const empty = document.querySelector("[data-robot-empty]");
  let activeFilter = "all";

  function applyFilters() {
    const query = (search?.value || "").trim().toLocaleLowerCase("ru");
    let visible = 0;
    cards.forEach((card) => {
      const categoryMatch = activeFilter === "all" || card.dataset.category === activeFilter;
      const searchMatch = !query || card.textContent.toLocaleLowerCase("ru").includes(query);
      const show = categoryMatch && searchMatch;
      card.hidden = !show;
      if (show) visible += 1;
    });
    if (results) results.textContent = `Показано специалистов: ${visible} из ${cards.length}`;
    if (empty) empty.hidden = visible !== 0;
  }

  filters.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.robotFilter;
      filters.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      applyFilters();
    });
  });
  search?.addEventListener("input", applyFilters);
  applyFilters();
})();
