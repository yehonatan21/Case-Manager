// Container entry point: make the data volume writable (platform disks are often mounted
// root-owned), drop root privileges, then start the Next.js standalone server.
const fs = require("node:fs");
const path = require("node:path");

process.env.HOSTNAME = process.env.BIND_HOST || "0.0.0.0"; // platforms often set HOSTNAME to the container name
const RUN_AS = Number(process.env.RUN_AS_UID || 1000); // the "node" user in the official image
const DATA_DIR = path.resolve(process.env.DATA_DIR || "/var/data");

function chownTree(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.uid !== RUN_AS) fs.lchownSync(p, RUN_AS, RUN_AS);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) chownTree(path.join(p, f));
  } catch (err) {
    console.warn(`[start] could not chown ${p}: ${err.message}`);
  }
}

if (typeof process.getuid === "function" && process.getuid() === 0 && RUN_AS !== 0) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.statSync(DATA_DIR).uid !== RUN_AS) chownTree(DATA_DIR);
  process.setgid(RUN_AS);
  process.setuid(RUN_AS);
}

require("./server.js");
