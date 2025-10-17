import Fastify from "fastify";
import { registerRoutes } from "./routes.js";
import { closeAllConnections } from "./db.js";

const app = Fastify({ logger: false });

registerRoutes(app);

app.get("/healthz", () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? "8080");

// Setup graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  try {
    await app.close();
    await closeAllConnections();
    console.log("Server and database connections closed");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(JSON.stringify({ event: "server_started", port }));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
