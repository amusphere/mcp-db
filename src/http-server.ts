import Fastify from "fastify";
import { registerRoutes } from "./routes.js";
import { closeAllConnections } from "./db.js";
import { logger } from "./logger.js";
import { getSettings } from "./config.js";
import { initializeMetrics, getMetrics, isMetricsEnabled } from "./metrics.js";

const settings = getSettings();
initializeMetrics({ enabled: settings.metricsEnabled });

const app = Fastify({ logger: false });

registerRoutes(app);

app.get("/healthz", () => ({ status: "ok" }));

// Prometheus metrics endpoint
if (isMetricsEnabled()) {
  app.get("/metrics", async (request, reply) => {
    const metrics = await getMetrics();
    await reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(metrics);
  });
}

const port = Number(process.env.PORT ?? "8080");

// Setup graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await app.close();
    await closeAllConnections();
    logger.info("Server and database connections closed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    logger.info("HTTP server started", { port });
  })
  .catch((error) => {
    logger.error("Failed to start HTTP server", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
