const template = document.querySelector("#surface-template");
const shadow = document
  .querySelector("#shadow-root")
  .attachShadow({ mode: "open" });
for (const root of [document.querySelector("#light-root"), shadow]) {
  root.append(template.content.cloneNode(true));
  const surface = root.querySelector("#feedback");
  const completion = root.querySelector("#completion");
  surface.addEventListener("transitionend", (event) => {
    completion.textContent =
      event.propertyName === "opacity" ? "操作完了" : "未操作の色変更";
  });
  root.querySelector("#fade").addEventListener("click", () => {
    surface.classList.add("faded");
  });
  root.querySelector("#recolor").addEventListener("click", () => {
    root.querySelector("#first").classList.toggle("warm");
  });
}
