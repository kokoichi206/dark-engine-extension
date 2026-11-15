const shadow = document.querySelector("#shadow").attachShadow({ mode: "open" });
shadow.innerHTML =
  "<style>p { color: #222; background: white; padding: 12px }</style><p>Shadow DOM の中の文字</p>";
document.querySelector("#update").addEventListener("click", () => {
  // API 応答後の追加と同様に、入力イベントの再走査より後で DOM を更新する。
  setTimeout(() => {
    document.querySelector("#dynamic").innerHTML =
      '<p style="background:white;color:black">追加された要素</p>';
  }, 300);
});
function drawCells() {
  const ctx = document.querySelector("#cells").getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 600, 100);
  ctx.fillStyle = "#e5efff";
  ctx.fillRect(200, 0, 200, 100);
  ctx.strokeStyle = "#ccc";
  ctx.strokeRect(0, 0, 200, 100);
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "black";
  ctx.fillText("Google Sheets", 20, 55);
  ctx.fillText("12345", 220, 55);
  ctx.fillText("セルの描画", 420, 55);
}
document.querySelector("#draw-cells").addEventListener("click", drawCells);
// storage の読み込みを待ち、実サイトと同様に後続タスクで描画する。
setTimeout(drawCells, 100);
const art = document.querySelector("#art").getContext("2d");
art.fillStyle = "#fff";
art.fillRect(0, 0, 80, 40);
