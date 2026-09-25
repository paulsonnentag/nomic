/** Makes `dom` a drawing surface and puts `surface`, the live state of the pointers on it. */
export default function canvas(env) {
  const dom = env.get("dom").value
  Object.assign(dom.style, {
    position: "relative",
    width: "640px",
    height: "480px",
    background: "white",
    border: "2px solid #4a8cf7",
    borderRadius: "4px",
    overflow: "hidden",
    touchAction: "none",
    userSelect: "none",
  })
  env.put("surface", { pointers: {} })
}
