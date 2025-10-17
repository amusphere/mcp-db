import Fastify from "fastify";
import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: false });

registerRoutes(app);

app.get("/healthz", () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? "8080");

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(JSON.stringify({ event: "server_started", port }));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
