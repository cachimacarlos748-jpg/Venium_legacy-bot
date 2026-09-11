// Heartbeat health probe for the WhatsApp browser session.
//
// whatsapp-web.js can enter a "zombie" state: the client reports `open`, the
// process is alive, but the underlying WhatsApp Web page/socket is dead and
// NO events (messages, disconnects) ever fire again. Customers write and
// nothing happens — the worst failure mode for a sales bot.
//
// The probe asks the live browser page for its connection state every 60s.
// If the page is unresponsive (evaluation times out) or WhatsApp Web itself
// reports a dead socket, it invokes the recovery callback which relaunches
// the browser while keeping the persisted session.

import type whatsappWeb from "whatsapp-web.js";
import pino from "pino";

const logger = pino({ level: process.env.NODE_ENV === "production" ? "info" : "warn" });

export interface HealthProbe {
  start(client: InstanceType<typeof whatsappWeb.Client>, onDead: () => void): void;
  stop(): void;
}

export function createHealthProbe(): HealthProbe {
  let timer: NodeJS.Timeout | null = null;
  let consecutiveFailures = 0;
  let probing = false;

  async function checkOnce(client: InstanceType<typeof whatsappWeb.Client>, onDead: () => void): Promise<void> {
    if (probing) return;
    probing = true;
    try {
      // Ask WhatsApp Web's own page about its socket. This only works when
      // the CDP connection AND the page's JS are both alive.
      const state = (await Promise.race([
        client.pupPage?.evaluate(() => {
          const w = window as unknown as { store?: { Conn?: { connected?: boolean } } };
          return Boolean(w.store?.Conn?.connected);
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("probe timeout")), 20_000)),
      ])) as boolean | undefined;

      if (state === false) {
        consecutiveFailures += 1;
        logger.warn({ consecutiveFailures }, "WhatsApp Web page reports a dead socket");
      } else {
        consecutiveFailures = 0;
      }
    } catch {
      // The page did not answer at all: the browser is frozen.
      consecutiveFailures += 1;
      logger.warn({ consecutiveFailures }, "WhatsApp health probe unresponsive (frozen page)");
    } finally {
      probing = false;
    }

    // Two consecutive failed probes = the session is a zombie. Recover.
    if (consecutiveFailures >= 2) {
      logger.error("WhatsApp session is a zombie (no heartbeat); forcing recovery");
      consecutiveFailures = 0;
      onDead();
    }
  }

  return {
    start(client, onDead) {
      stop();
      consecutiveFailures = 0;
      timer = setInterval(() => {
        void checkOnce(client, onDead);
      }, 60_000);
      // Don't keep the process alive just for the probe.
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      consecutiveFailures = 0;
      probing = false;
    },
  };
}
