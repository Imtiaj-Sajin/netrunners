import { startServer } from "./server/http.js";

const port = Number(process.env.PORT || 7077);
const app = startServer(port);

console.log(`
  ███╗   ██╗███████╗████████╗██████╗ ██╗   ██╗███╗   ██╗███╗   ██╗███████╗██████╗ ███████╗
  ████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║   ██║████╗  ██║████╗  ██║██╔════╝██╔══██╗██╔════╝
  ██╔██╗ ██║█████╗     ██║   ██████╔╝██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██████╔╝███████╗
  ██║╚██╗██║██╔══╝     ██║   ██╔══██╗██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██╔══██╗╚════██║
  ██║ ╚████║███████╗   ██║   ██║  ██║╚██████╔╝██║ ╚████║██║ ╚████║███████╗██║  ██║███████║
  ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚══════╝

  The viewer is live at  http://localhost:${port}
  Ctrl+C freezes the world and exits. Everything is already on disk; resume it later.
`);

let closing = false;
process.on("SIGINT", () => {
  if (closing) process.exit(0);
  closing = true;
  const e = app.engine;
  if (e && e.status === "running") {
    e.pause("operator", "process stopped (Ctrl+C)");
    console.log("  World frozen. In-flight answers will be held. Bye.");
  }
  setTimeout(() => process.exit(0), 400);
});
