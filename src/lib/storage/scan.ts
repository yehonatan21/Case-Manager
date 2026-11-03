import net from "node:net";
import { env } from "../env";

export type ScanResult = "clean" | "infected" | "skipped" | "error";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/**
 * Malware scan. Uses ClamAV (clamd INSTREAM) when CLAMAV_HOST is configured.
 * Without a scanner, the EICAR test signature is still detected so the blocking path can be verified.
 */
export async function scanBuffer(buf: Buffer): Promise<ScanResult> {
  if (!env.clamavHost) {
    return buf.includes(Buffer.from(EICAR)) ? "infected" : "skipped";
  }
  return new Promise<ScanResult>((resolve) => {
    const socket = net.createConnection({ host: env.clamavHost, port: env.clamavPort });
    let response = "";
    const done = (r: ScanResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(30000, () => done("error"));
    socket.on("error", () => done("error"));
    socket.on("data", (d) => (response += d.toString()));
    socket.on("end", () => {
      if (response.includes("FOUND")) done("infected");
      else if (response.includes("OK")) done("clean");
      else done("error");
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunk = 64 * 1024;
      for (let i = 0; i < buf.length; i += chunk) {
        const part = buf.subarray(i, i + chunk);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
